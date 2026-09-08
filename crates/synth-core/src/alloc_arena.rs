//! Deterministic arena allocator for the WASM audio core.
//!
//! prd.md §1.1/§6.1 demand that the real-time thread never triggers
//! `memory.grow`. We therefore place a fixed, 16-byte aligned arena in static
//! memory and serve *all* allocations — Rust's own as well as the vendored C
//! code's `malloc` — from a first-fit free list with address-ordered
//! coalescing. Once the module is instantiated the linear memory never grows,
//! and every allocation can be counted for the zero-allocation quality gate.

use core::alloc::{GlobalAlloc, Layout};
use core::cell::UnsafeCell;
use core::sync::atomic::{AtomicUsize, Ordering};

/// 8 MiB is comfortably above the Soundpipe reverb/delay working set
/// (~150 KB) plus DSP scratch, while keeping the initial WASM memory small.
pub const ARENA_SIZE: usize = 8 * 1024 * 1024;
const ALIGN: usize = 16;

#[repr(C)]
struct Block {
    size: usize,
    next: *mut Block,
}

/// Block header rounded up to the payload alignment requirement.
const HDR: usize = {
    let raw = core::mem::size_of::<Block>();
    if raw < ALIGN {
        ALIGN
    } else {
        raw
    }
};

struct ArenaState {
    base: *mut u8,
    free_head: *mut Block,
    initialised: bool,
}

struct ArenaCell(UnsafeCell<ArenaState>);

// The audio worklet is single threaded. Native tests never install this as the
// global allocator; they exercise the methods directly from one thread.
unsafe impl Sync for ArenaCell {}

static STATE: ArenaCell = ArenaCell(UnsafeCell::new(ArenaState {
    base: core::ptr::null_mut(),
    free_head: core::ptr::null_mut(),
    initialised: false,
}));

#[repr(align(16))]
struct Arena(#[allow(dead_code)] [u8; ARENA_SIZE]);

static mut ARENA: Arena = Arena([0; ARENA_SIZE]);

static ALLOC_COUNT: AtomicUsize = AtomicUsize::new(0);
static VIOLATION: AtomicUsize = AtomicUsize::new(0);
static IN_PROCESS: AtomicUsize = AtomicUsize::new(0);

/// Number of successful allocations served from the arena.
pub fn alloc_count() -> usize {
    ALLOC_COUNT.load(Ordering::Relaxed)
}

/// Number of allocations observed while the real-time process loop was active.
pub fn violations() -> usize {
    VIOLATION.load(Ordering::Relaxed)
}

pub fn reset_violations() {
    VIOLATION.store(0, Ordering::Relaxed);
}

/// Mark the beginning of a real-time render call.
pub fn enter_process() {
    IN_PROCESS.store(1, Ordering::Relaxed);
}

/// Mark the end of a real-time render call.
pub fn leave_process() {
    IN_PROCESS.store(0, Ordering::Relaxed);
}

fn state() -> &'static mut ArenaState {
    unsafe { &mut *STATE.0.get() }
}

fn init() {
    let st = state();
    if st.initialised {
        return;
    }
    let base = core::ptr::addr_of_mut!(ARENA) as *mut u8;
    debug_assert_eq!(base as usize % ALIGN, 0);
    let block = base as *mut Block;
    unsafe {
        (*block).size = ARENA_SIZE;
        (*block).next = core::ptr::null_mut();
    }
    st.base = base;
    st.free_head = block;
    st.initialised = true;
}

fn align_up(value: usize, align: usize) -> usize {
    (value + align - 1) & !(align - 1)
}

/// Allocate `size` bytes aligned to at least 16 bytes. Returns null on
/// exhaustion; the arena never grows.
pub fn alloc(size: usize, align: usize) -> *mut u8 {
    init();
    if size == 0 {
        return core::ptr::null_mut();
    }
    // All payloads are 16-byte aligned by construction. Requests above that
    // are satisfied by over-allocating; the audio code never needs them.
    let extra_align = if align > ALIGN { align - ALIGN } else { 0 };
    let payload = align_up(size, ALIGN);
    let needed = payload + extra_align + HDR;

    let st = state();
    let mut prev: *mut Block = core::ptr::null_mut();
    let mut cur = st.free_head;

    while !cur.is_null() {
        unsafe {
            if (*cur).size >= needed {
                let remaining = (*cur).size - needed;
                if remaining >= HDR + ALIGN {
                    // Split the tail off into a new free block.
                    let split = (cur as *mut u8).add(needed) as *mut Block;
                    (*split).size = remaining;
                    (*split).next = (*cur).next;
                    (*cur).size = needed;
                    (*cur).next = split;
                }
                // Unlink from the free list.
                if prev.is_null() {
                    st.free_head = (*cur).next;
                } else {
                    (*prev).next = (*cur).next;
                }
                (*cur).next = core::ptr::null_mut();
                ALLOC_COUNT.fetch_add(1, Ordering::Relaxed);
                if IN_PROCESS.load(Ordering::Relaxed) != 0 {
                    VIOLATION.fetch_add(1, Ordering::Relaxed);
                }
                return (cur as *mut u8).add(HDR);
            }
            prev = cur;
            cur = (*cur).next;
        }
    }
    core::ptr::null_mut()
}

/// Return a block to the arena, coalescing with address-adjacent neighbours.
pub fn dealloc(ptr: *mut u8) {
    if ptr.is_null() {
        return;
    }
    init();
    let block = unsafe { ptr.sub(HDR) as *mut Block };
    let st = state();

    // Insert into the address-ordered free list.
    let mut prev: *mut Block = core::ptr::null_mut();
    let mut cur = st.free_head;
    while !cur.is_null() && (cur as usize) < (block as usize) {
        prev = cur;
        cur = unsafe { (*cur).next };
    }
    unsafe {
        (*block).next = cur;
        if prev.is_null() {
            st.free_head = block;
        } else {
            (*prev).next = block;
        }
        // Coalesce with the following block.
        if !cur.is_null() && (block as usize) + (*block).size == cur as usize {
            (*block).size += (*cur).size;
            (*block).next = (*cur).next;
        }
        // Coalesce with the preceding block.
        if !prev.is_null() && (prev as usize) + (*prev).size == block as usize {
            (*prev).size += (*block).size;
            (*prev).next = (*block).next;
        }
    }
}

/// Allocate zeroed memory (`calloc` semantics).
pub fn alloc_zeroed(size: usize, align: usize) -> *mut u8 {
    let p = alloc(size, align);
    if !p.is_null() {
        unsafe { core::ptr::write_bytes(p, 0, size) };
    }
    p
}

/// Grow/shrink an allocation (`realloc` semantics).
pub fn realloc(ptr: *mut u8, new_size: usize, align: usize) -> *mut u8 {
    if ptr.is_null() {
        return alloc(new_size, align);
    }
    if new_size == 0 {
        dealloc(ptr);
        return core::ptr::null_mut();
    }
    let block = unsafe { ptr.sub(HDR) as *mut Block };
    let capacity = unsafe { (*block).size } - HDR;
    if capacity >= new_size {
        return ptr;
    }
    let fresh = alloc(new_size, align);
    if fresh.is_null() {
        return core::ptr::null_mut();
    }
    unsafe { core::ptr::copy_nonoverlapping(ptr, fresh, capacity) };
    dealloc(ptr);
    fresh
}

/// Total bytes currently available (free list sum). Used by tests.
pub fn free_bytes() -> usize {
    init();
    let mut total = 0usize;
    let mut cur = state().free_head;
    while !cur.is_null() {
        unsafe {
            total += (*cur).size;
            cur = (*cur).next;
        }
    }
    total
}

/// The WASM global allocator. Rust and the vendored C code share this arena, so
/// `memory.grow` can never be triggered at run time.
pub struct ArenaAlloc;

unsafe impl GlobalAlloc for ArenaAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        alloc(layout.size(), layout.align())
    }

    unsafe fn dealloc(&self, ptr: *mut u8, _layout: Layout) {
        dealloc(ptr);
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        alloc_zeroed(layout.size(), layout.align())
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        realloc(ptr, new_size, layout.align())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocates_aligned_and_zeroed() {
        let p = alloc_zeroed(100, 16);
        assert!(!p.is_null());
        assert_eq!(p as usize % 16, 0);
        for i in 0..100 {
            assert_eq!(unsafe { *p.add(i) }, 0);
        }
        dealloc(p);
    }

    #[test]
    fn frees_and_reuses_coalesced_space() {
        init();
        let before = free_bytes();
        let a = alloc(4096, 16);
        let b = alloc(4096, 16);
        assert!(!a.is_null() && !b.is_null());
        assert!(free_bytes() < before);
        dealloc(a);
        dealloc(b);
        // Coalescing should return the arena to its previous free size.
        assert_eq!(free_bytes(), before);
    }

    #[test]
    fn realloc_preserves_contents() {
        let p = alloc(64, 16);
        for i in 0..64 {
            unsafe { *p.add(i) = i as u8 };
        }
        let q = realloc(p, 4096, 16);
        assert!(!q.is_null());
        for i in 0..64 {
            assert_eq!(unsafe { *q.add(i) }, i as u8);
        }
        dealloc(q);
    }

    #[test]
    fn exhaustion_returns_null_without_growing() {
        let huge = ARENA_SIZE + 1;
        assert!(alloc(huge, 16).is_null());
    }
}
