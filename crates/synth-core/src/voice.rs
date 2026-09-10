//! Voice allocation with smooth stealing and elastic polyphony.
//!
//! Each [`Voice`] owns a slot index into the static DSP pool on the C side.
//! When every slot is busy the manager picks the quietest/oldest victim, forces
//! it into a short release and parks the new note in a small pending queue;
//! `Engine::process` retriggers it as soon as the slot reaches idle, so stealing
//! never produces a hard click (prd.md §1.1, §7.1).

use crate::params::MAX_VOICES;

pub const PENDING_CAPACITY: usize = 8;

#[derive(Clone, Copy, Debug)]
pub struct Voice {
    pub active: bool,
    pub note: u8,
    pub velocity: f32,
    pub gate: bool,
    pub released: bool,
    /// Monotonic allocation counter, used for age-based stealing.
    pub age: u32,
    /// Frequency the voice is gliding towards (Hz).
    pub target_freq: f32,
    /// Frequency actually used last block (Hz).
    pub current_freq: f32,
    /// Last envelope output, feeding the filter envelope amount.
    pub env_value: f32,
    /// Per-note random value (0..1), sampled once at note-on for the RANDOM
    /// modulation source so a held note does not wobble.
    pub random: f32,
    /// True while this slot is fading out to make room for a pending note.
    pub stealing: bool,
}

impl Voice {
    pub const fn new() -> Self {
        Self {
            active: false,
            note: 0,
            velocity: 1.0,
            gate: false,
            released: false,
            age: 0,
            target_freq: 440.0,
            current_freq: 440.0,
            env_value: 0.0,
            random: 0.5,
            stealing: false,
        }
    }

    pub fn is_free(&self) -> bool {
        !self.active
    }
}

impl Default for Voice {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy)]
struct Pending {
    note: u8,
    velocity: f32,
    /// Which instance the note was played for, so a promoted note keeps its
    /// timbre (layer/split).
    instance: u8,
}

#[derive(Clone, Copy)]
pub struct VoiceManager {
    pub voices: [Voice; MAX_VOICES],
    pub max_polyphony: usize,
    counter: u32,
    pending: [Pending; PENDING_CAPACITY],
    pending_len: usize,
}

/// Outcome of a note-on request.
pub enum NoteOnResult {
    /// A free slot was claimed immediately.
    Allocated(usize),
    /// No slot available; the victim at this index is fading out and the note
    /// was queued. The engine must apply the short release to the victim.
    Queued(usize),
    /// Polyphony limit reached and the queue is full.
    Dropped,
}

impl VoiceManager {
    pub const fn new() -> Self {
        Self {
            voices: [Voice::new(); MAX_VOICES],
            max_polyphony: 16,
            counter: 0,
            pending: [Pending {
                note: 0,
                velocity: 0.0,
                instance: 0,
            }; PENDING_CAPACITY],
            pending_len: 0,
        }
    }

    pub fn reset(&mut self) {
        for v in self.voices.iter_mut() {
            *v = Voice::new();
        }
        self.pending_len = 0;
        self.counter = 0;
    }

    pub fn max_polyphony(&self) -> usize {
        self.max_polyphony
    }

    pub fn set_max_polyphony(&mut self, n: usize) {
        self.max_polyphony = n.clamp(1, MAX_VOICES);
    }

    pub fn active_count(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count()
    }

    fn next_age(&mut self) -> u32 {
        self.counter = self.counter.wrapping_add(1);
        self.counter
    }

    fn claim(&mut self, index: usize, note: u8, velocity: f32, freq: f32) -> usize {
        let age = self.next_age();
        let v = &mut self.voices[index];
        *v = Voice {
            active: true,
            note,
            velocity,
            gate: true,
            released: false,
            age,
            target_freq: freq,
            current_freq: freq,
            env_value: 0.0,
            random: 0.5,
            stealing: false,
        };
        index
    }

    /// Find a free slot among the currently allowed polyphony window.
    fn find_free(&self) -> Option<usize> {
        let limit = self.max_polyphony.min(MAX_VOICES);
        (0..limit).find(|&i| self.voices[i].is_free())
    }

    /// Choose the least valuable voice: released and quiet first, then oldest.
    fn find_victim(&self) -> usize {
        let limit = self.max_polyphony.min(MAX_VOICES).max(1);
        let mut best = 0usize;
        let mut best_score = f32::MAX;
        for i in 0..limit {
            let v = &self.voices[i];
            // Lower score = better candidate for stealing.
            let quiet = v.env_value.max(0.0);
            let released_bonus = if v.released { -1.0 } else { 0.0 };
            let age_penalty = v.age as f32 * 1e-6;
            let score = quiet + released_bonus + age_penalty;
            if score < best_score {
                best_score = score;
                best = i;
            }
        }
        best
    }

    pub fn note_on(&mut self, note: u8, velocity: f32, freq: f32) -> NoteOnResult {
        self.note_on_inst(note, velocity, freq, 0)
    }

    /// As [`VoiceManager::note_on`], for a note played on instance `instance`.
    ///
    /// A note is one voice per instance: in layer mode the engine calls this
    /// twice for the same note, which allocates two voices because voices are
    /// found by *free slot*, not by note number.
    pub fn note_on_inst(&mut self, note: u8, velocity: f32, freq: f32, instance: u8) -> NoteOnResult {
        if let Some(index) = self.find_free() {
            return NoteOnResult::Allocated(self.claim(index, note, velocity, freq));
        }
        if self.pending_len < PENDING_CAPACITY {
            let victim = self.find_victim();
            // Retune an already-fading victim so repeated steals do not queue
            // several notes onto the same slot.
            if !self.voices[victim].stealing {
                self.pending[self.pending_len] = Pending { note, velocity, instance };
                self.pending_len += 1;
                self.voices[victim].stealing = true;
                self.voices[victim].gate = false;
                self.voices[victim].released = true;
                return NoteOnResult::Queued(victim);
            }
        }
        NoteOnResult::Dropped
    }

    /// Promote the oldest pending note into a now-idle slot. Returns the slot and
    /// note so the engine can reset the DSP state and retrigger.
    pub fn flush_pending<F>(&mut self, mut freq_of: F) -> Option<(usize, u8, f32, u8)>
    where
        F: FnMut(u8) -> f32,
    {
        if self.pending_len == 0 {
            return None;
        }
        let limit = self.max_polyphony.min(MAX_VOICES);
        let index = (0..limit).find(|&i| !self.voices[i].active)?;
        let Pending { note, velocity, instance } = self.pending[0];
        // Shift the queue down (tiny, fixed-size copy).
        for i in 1..self.pending_len {
            self.pending[i - 1] = self.pending[i];
        }
        self.pending_len -= 1;
        let freq = freq_of(note);
        self.claim(index, note, velocity, freq);
        Some((index, note, velocity, instance))
    }

    pub fn note_off(&mut self, note: u8) {
        for v in self.voices.iter_mut() {
            if v.active && v.note == note && !v.released {
                v.gate = false;
                v.released = true;
            }
        }
    }

    pub fn all_notes_off(&mut self) {
        for v in self.voices.iter_mut() {
            if v.active {
                v.gate = false;
                v.released = true;
            }
        }
        self.pending_len = 0;
    }

    /// Mark a voice as finished (envelope reached idle).
    pub fn release_slot(&mut self, index: usize) {
        if index < MAX_VOICES {
            self.voices[index].active = false;
            self.voices[index].gate = false;
            self.voices[index].released = false;
            self.voices[index].stealing = false;
            self.voices[index].env_value = 0.0;
        }
    }

    /// prd.md §7.1: reduce polyphony and force the excess voices into release
    /// instead of hard-cutting them. The `limit` newest voices are kept.
    pub fn force_release_excess(&mut self, limit: usize) -> usize {
        let limit = limit.clamp(1, MAX_VOICES);
        let mut ages = [0u32; MAX_VOICES];
        let mut n = 0usize;
        for v in self.voices.iter() {
            if v.active && !v.released {
                ages[n] = v.age;
                n += 1;
            }
        }
        if n <= limit {
            return 0;
        }
        // Insertion sort (n <= 32, no allocation).
        for i in 1..n {
            let a = ages[i];
            let mut j = i;
            while j > 0 && ages[j - 1] > a {
                ages[j] = ages[j - 1];
                j -= 1;
            }
            ages[j] = a;
        }
        let threshold = ages[n - limit];
        let mut forced = 0;
        for v in self.voices.iter_mut() {
            if v.active && !v.released && v.age < threshold {
                v.gate = false;
                v.released = true;
                forced += 1;
            }
        }
        forced
    }
}

impl Default for VoiceManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn freq(note: u8) -> f32 {
        crate::dsp::util::note_to_hz(note as f32)
    }

    #[test]
    fn allocates_free_voices_before_stealing() {
        let mut vm = VoiceManager::new();
        vm.set_max_polyphony(4);
        for n in 0..4u8 {
            assert!(matches!(
                vm.note_on(60 + n, 1.0, freq(60 + n)),
                NoteOnResult::Allocated(_)
            ));
        }
        assert_eq!(vm.active_count(), 4);
        assert!(matches!(
            vm.note_on(70, 1.0, freq(70)),
            NoteOnResult::Queued(_)
        ));
    }

    /// The stealing policy decides what a player hears when the pool is full:
    /// a released, quiet voice must go before a held or loud one, and age only
    /// breaks ties.
    #[test]
    fn stealing_prefers_released_and_quiet_voices() {
        let mut vm = VoiceManager::new();
        vm.set_max_polyphony(4);
        for (index, note) in [60u8, 62, 64, 65].into_iter().enumerate() {
            vm.note_on(note, 1.0, freq(note));
            // Give every voice a distinct envelope level so "quiet" is testable.
            vm.voices[index].env_value = 0.2 + index as f32 * 0.2;
        }

        // Nothing is released: the quietest voice (72, the oldest at 0.2) goes.
        let victim = vm.find_victim();
        assert_eq!(vm.voices[victim].note, 60, "quietest voice should be stolen");

        // A held voice is never preferred over a released one, even a loud one.
        vm.voices[3].released = true;
        vm.voices[3].env_value = 0.95;
        let victim = vm.find_victim();
        assert_eq!(
            vm.voices[victim].note, 65,
            "a released voice should be stolen before a held one"
        );

        // With everything released and equally loud, the *oldest* goes first:
        // `age` counts allocations, so the smallest number is the oldest.
        for (index, voice) in vm.voices.iter_mut().enumerate() {
            voice.released = true;
            voice.env_value = 1.0;
            voice.age = 5 + index as u32;
        }
        vm.voices[1].age = 0;
        let victim = vm.find_victim();
        assert_eq!(vm.voices[victim].note, 62, "the oldest voice should be stolen first");
    }

    #[test]
    fn pending_note_is_promoted_when_slot_frees() {
        let mut vm = VoiceManager::new();
        vm.set_max_polyphony(1);
        vm.note_on(60, 1.0, freq(60));
        vm.note_on(64, 1.0, freq(64));
        let slot = 0;
        vm.release_slot(slot);
        let promoted = vm.flush_pending(freq);
        assert!(promoted.is_some());
        let (_, note, _, instance) = promoted.unwrap();
        // Notes are queued with their instance so a promoted note keeps its timbre.
        assert_eq!(instance, 0);
        assert_eq!(note, 64);
    }

    #[test]
    fn note_off_only_releases_matching_voice() {
        let mut vm = VoiceManager::new();
        vm.set_max_polyphony(4);
        vm.note_on(60, 1.0, freq(60));
        vm.note_on(64, 1.0, freq(64));
        vm.note_off(60);
        assert!(vm.voices.iter().any(|v| v.note == 64 && v.gate));
        assert!(vm.voices.iter().any(|v| v.note == 60 && v.released));
    }

    #[test]
    fn polyphony_limit_is_respected() {
        let mut vm = VoiceManager::new();
        vm.set_max_polyphony(2);
        vm.note_on(60, 1.0, freq(60));
        vm.note_on(62, 1.0, freq(62));
        // Third note must not silently allocate a third slot.
        vm.note_on(64, 1.0, freq(64));
        assert!(vm.active_count() <= 2);
    }

    #[test]
    fn all_notes_off_releases_everything() {
        let mut vm = VoiceManager::new();
        vm.set_max_polyphony(4);
        vm.note_on(60, 1.0, freq(60));
        vm.note_on(64, 1.0, freq(64));
        vm.all_notes_off();
        assert!(vm.voices.iter().all(|v| !v.active || v.released));
    }
}
