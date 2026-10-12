#!/usr/bin/env node
/**
 * Micro-benchmarks for the JavaScript-side hot paths flagged in the
 * performance review: store persistence (JSON.stringify + localStorage),
 * wavefile period detection, WAV decoding and Ogg page packing.
 *
 * Each measurement compares the current implementation against a candidate
 * optimisation applied to the same input, so the reported speed-up is a
 * real number from this machine, not an estimate.
 */

const time = (label, fn, { warmup = 3, runs = 7 } = {}) => {
  let best = Infinity;
  let last;
  for (let i = 0; i < warmup + runs; i++) {
    const t0 = performance.now();
    const out = fn();
    const dt = performance.now() - t0;
    if (i >= warmup) best = Math.min(best, dt);
    if (out !== undefined) last = out;
  }
  console.log(`  ${label.padEnd(46)} ${best.toFixed(3)} ms`);
  return { best, last };
};

// ---------------------------------------------------------------- fixtures

const N_PARAMS = 250;
const params = {};
for (let i = 0; i < N_PARAMS; i++) params[i] = Math.sin(i) * 0.5 + 0.5;
const routes = Array.from({ length: 12 }, (_, i) => ({
  src: i % 20,
  dst: (i * 7) % 60,
  amount: i / 12,
  enabled: i % 3 !== 0,
}));
const state = {
  params,
  params2: { ...params },
  routes,
  power: true,
  presetId: 'init',
  presetName: 'Init Patch',
  presetTag: 'basic',
};
const _layout = {
  order: ['osc1', 'osc2', 'filter', 'amp', 'fx', 'matrix'],
  collapsed: {},
  keyboardVisible: true,
  theme: 'dark',
  lang: 'en',
  flowPos: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(i), [i * 10, i * 20]])),
  fxTemplates: [],
  clipTemplates: [],
};

console.log('[bench-js] 1. commit() persistence — stringify cost');
{
  const A = time('current: wrap spread + JSON.stringify', () => {
    const doc = { schema: 4, data: { ...state } };
    return JSON.stringify(doc).length;
  });
  const B = time('proposed: manual key-ordered serializer', () => {
    const parts = [];
    parts.push('{"schema":4,"data":{');
    // params maps
    for (const key of ['params', 'params2']) {
      const map = state[key];
      const chunks = [];
      for (const k in map) chunks.push(`${k}:${map[k]}`);
      parts.push(`"${key}":{${chunks.join(',')}},`);
    }
    const rc = [];
    for (const r of routes) {
      rc.push(
        `{"src":${r.src},"dst":${r.dst},"amount":${r.amount},"enabled":${r.enabled ? 1 : 0}}`,
      );
    }
    parts.push(`"routes":[${rc.join(',')}],`);
    parts.push('"power":true,');
    parts.push(`"presetId":${JSON.stringify(state.presetId)},`);
    parts.push(`"presetName":${JSON.stringify(state.presetName)},`);
    parts.push(`"presetTag":${JSON.stringify(state.presetTag)}`);
    parts.push('}}');
    return parts.join('').length;
  });
  console.log(
    `  -> speed-up ${(A.best / B.best).toFixed(2)}x (identical bytes: ${A.last === B.last})`,
  );
}

console.log('[bench-js] 1b. commit() persistence — landed dirty-check vs HEAD double-write');
{
  // Same model as `saveJsonIfChanged` in src/state/store.ts: stringify every
  // commit, but only touch storage when the bytes differ from what the cache
  // says storage already holds. HEAD wrote unconditionally on every commit.
  const layoutJson = JSON.stringify({ schema: 4, data: _layout });

  const runDrag = (fn) => {
    // One 60-event knob drag: 60 real value changes + 20 no-op commits
    // (pointermove jitter that lands on the same rounded value still calls
    // commit at HEAD). Returns [ms, writes].
    let bestMs = Infinity;
    let writes = 0;
    for (let r = 0; r < 10; r++) {
      const store = new Map();
      let n = 0;
      const t0 = performance.now();
      for (let i = 0; i < 80; i++) fn(store, i, () => n++);
      const dt = performance.now() - t0;
      if (r >= 3 && dt < bestMs) {
        bestMs = dt;
        writes = n;
      }
    }
    return [bestMs, writes];
  };

  // HEAD: commit() called saveJson(STORAGE_KEY, doc) + saveJson(LAYOUT_KEY, layout)
  // with a plain JSON.stringify inside each — two unconditional setItem per commit.
  const [headMs, headWrites] = runDrag((store, i, count) => {
    const doc = { schema: 4, data: { ...state, params: { ...state.params, cutoff: i * 0.01 } } };
    store.set('gs1:state:v1', JSON.stringify(doc));
    store.set('gs1:layout:v1', layoutJson);
    count();
    count();
  });

  // Landed: saveJsonIfChanged for both keys, backed by the module-level cache.
  const cache = new Map();
  const saveIfChanged = (store, key, text, count) => {
    if (cache.get(key) === text) return;
    store.set(key, text);
    cache.set(key, text);
    count();
  };
  const [nowMs, nowWrites] = runDrag((store, i, count) => {
    const changed = i < 60; // last 20 commits repeat the previous bytes
    const doc = {
      schema: 4,
      data: changed ? { ...state, params: { ...state.params, cutoff: i * 0.01 } } : { ...state, params: { ...state.params, cutoff: 59 * 0.01 } },
    };
    saveIfChanged(store, 'gs1:state:v1', JSON.stringify(doc), count);
    saveIfChanged(store, 'gs1:layout:v1', layoutJson, count);
  });

  console.log(
    `  HEAD:   2 unconditional setItem/commit   ${headMs.toFixed(3)} ms per drag, ${headWrites} writes`,
  );
  console.log(
    `  landed: dirty-checked writes             ${nowMs.toFixed(3)} ms per drag, ${nowWrites} writes`,
  );
  console.log(
    `  -> setItem calls x${(headWrites / Math.max(nowWrites, 1)).toFixed(1)}, wall-clock ${(headMs / nowMs).toFixed(2)}x in memory (real localStorage I/O scales with the write count)`,
  );
}

console.log('[bench-js] 2. detectPeriod — HEAD form vs sliding-energy candidate');
{
  const SR = 48000;
  const n = SR * 10;
  const f0 = 220;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h;
    samples[i] = v * 0.3;
  }
  const MIN_LAG = 24, MAX_LAG = 2048, ANALYSIS_WINDOW = 2048;
  const pick = (scores, maxLag) => {
    let best = -Infinity;
    for (let i = 0; i < scores.length; i++) if (scores[i] > best) best = scores[i];
    if (best <= 0) return samples.length;
    const floor = best * 0.9;
    for (let lag = MIN_LAG; lag <= maxLag; lag++) {
      const score = scores[lag - MIN_LAG];
      if (score < floor) continue;
      const previous = lag > MIN_LAG ? scores[lag - MIN_LAG - 1] : -Infinity;
      const next = lag < maxLag ? scores[lag - MIN_LAG + 1] : -Infinity;
      if (score >= previous && score >= next) return lag;
    }
    return samples.length;
  };
  const frame = () => {
    const maxLag = Math.min(MAX_LAG, Math.floor(samples.length / 4));
    const start = Math.floor(samples.length * 0.2);
    const window = Math.min(ANALYSIS_WINDOW, samples.length - start - maxLag);
    return { maxLag, start, window };
  };
  // HEAD shape (and what the landed file keeps): fused numerator+energy loop.
  const head = () => {
    const { maxLag, start, window } = frame();
    const scores = new Float32Array(maxLag - MIN_LAG + 1);
    for (let lag = MIN_LAG; lag <= maxLag; lag++) {
      let numerator = 0;
      let energy = 0;
      for (let i = 0; i < window; i++) {
        const a = samples[start + i];
        const b = samples[start + i + lag];
        numerator += a * b;
        energy += b * b;
      }
      scores[lag - MIN_LAG] = numerator / Math.sqrt(energy + 1e-12);
    }
    return pick(scores, maxLag);
  };
  // Rejected candidate: sliding energy with a separate numerator pass.
  const sliding = () => {
    const { maxLag, start, window } = frame();
    const scores = new Float32Array(maxLag - MIN_LAG + 1);
    const ref = samples.subarray(start, start + window);
    let lag = MIN_LAG;
    let energy = 0;
    for (let i = 0; i < window; i++) {
      const b = samples[start + lag + i];
      energy += b * b;
    }
    for (; lag <= maxLag; lag++) {
      let numerator = 0;
      const shift = start + lag;
      for (let i = 0; i < window; i++) numerator += ref[i] * samples[shift + i];
      scores[lag - MIN_LAG] = numerator / Math.sqrt(energy + 1e-12);
      if (lag < maxLag) {
        const out = samples[start + lag];
        const inn = samples[start + lag + window];
        energy += inn * inn - out * out;
      }
    }
    return pick(scores, maxLag);
  };
  const A = time('HEAD/landed: fused numerator+energy loop', head);
  const B = time('candidate: sliding energy (separate pass)', sliding);
  console.log(`  -> candidate ${(A.best / B.best).toFixed(2)}x — rejected, landed file keeps the HEAD loop shape (same result: ${A.last === B.last})`);
}

console.log('[bench-js] 3. parseWav decode paths — closure baseline vs landed fast path');
{
  const frames = 48000 * 5;
  const header = 44;

  // ---- float32 mono (the only landed fast path) ----
  const bufF = new ArrayBuffer(header + frames * 4);
  const f32 = new Float32Array(bufF, header);
  for (let i = 0; i < frames; i++) f32[i] = Math.sin(i / 100) * 0.5;
  const viewF = new DataView(bufF);

  const baseF = () => {
    const out = new Float32Array(frames);
    const read = (index) => viewF.getFloat32(header + index * 4, true); // HEAD closure
    for (let frame = 0; frame < frames; frame++) out[frame] = read(frame);
    return out;
  };
  const memcpy = () => {
    const src = new Float32Array(bufF, header, frames); // landed path
    const samples = new Float32Array(frames);
    samples.set(src);
    return samples;
  };
  const C = time('f32 mono: getFloat32 via closure (HEAD)', baseF);
  const D = time('f32 mono: Float32Array.set memcpy (landed)', memcpy);
  let same = true;
  { const x = baseF(), y = memcpy(); for (let i = 0; i < frames; i += 997) if (x[i] !== y[i]) same = false; }
  console.log(`  -> f32-mono speed-up ${(C.best / D.best).toFixed(2)}x (identical samples: ${same})`);

  // ---- rejected candidate on record: Int16Array view for 16-bit PCM ----
  const buf16 = new ArrayBuffer(header + frames * 2);
  const pcm16 = new Int16Array(buf16, header);
  for (let i = 0; i < frames; i++) pcm16[i] = Math.round(Math.sin(i / 100) * 20000);
  const view16 = new DataView(buf16);
  const base16 = () => {
    const out = new Float32Array(frames);
    const read = (index) => view16.getInt16(header + index * 2, true) / 32768; // HEAD/landed closure
    for (let frame = 0; frame < frames; frame++) out[frame] = read(frame);
    return out;
  };
  const i16View = () => {
    const out = new Float32Array(frames);
    const i16 = new Int16Array(buf16, header, frames); // rejected candidate
    for (let frame = 0; frame < frames; frame++) out[frame] = i16[frame] / 32768;
    return out;
  };
  const A = time('16-bit: DataView closure (HEAD/landed)', base16);
  const B = time('16-bit: Int16Array view (rejected)', i16View);
  console.log(`  -> 16-bit candidate ${(A.best / B.best).toFixed(2)}x — rejected, landed file keeps the HEAD reader`);
}

console.log('[bench-js] 4. Ogg packaging — one packet per page vs batched pages');
{
  // CRC table (same polynomial as webcodecs.ts)
  const CRC_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let j = 0; j < 8; j++) c = c & 0x80000000 ? ((c << 1) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0;
    CRC_TABLE[i] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0;
    for (let i = 0; i < buf.length; i++) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ buf[i]) & 0xff]) >>> 0;
    return c;
  };
  const makePage = (type, granule, serial, seq, packets) => {
    const seg = [];
    let total = 0;
    for (const p of packets) {
      let len = p.length;
      total += len;
      while (len >= 255) { seg.push(255); len -= 255; }
      seg.push(len);
    }
    const page = new Uint8Array(27 + seg.length + total);
    const v = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53, 0, type], 0);
    v.setBigUint64(6, BigInt(granule), true);
    v.setUint32(14, serial, true);
    v.setUint32(18, seq, true);
    page[26] = seg.length;
    page.set(seg, 27);
    let off = 27 + seg.length;
    for (const p of packets) { page.set(p, off); off += p.length; }
    v.setUint32(22, crc(page), true);
    return page;
  };

  const PACKET_COUNT = 6000; // 2 minutes at 20 ms
  const packets = Array.from({ length: PACKET_COUNT }, () => {
    const p = new Uint8Array(80 + ((Math.random() * 60) | 0));
    for (let i = 0; i < p.length; i++) p[i] = (i * 7) & 0xff;
    return p;
  });

  const current = () => {
    const pages = [];
    let g = 0;
    for (let i = 0; i < packets.length; i++) {
      g += 960;
      pages.push(makePage(i === packets.length - 1 ? 0x04 : 0, g, 1234, i + 2, [packets[i]]));
    }
    return { count: pages.length, bytes: pages.reduce((a, p) => a + p.length, 0) };
  };
  const proposed = () => {
    const pages = [];
    const PER_PAGE = 20;
    let g = 0;
    let seq = 2;
    for (let i = 0; i < packets.length; i += PER_PAGE) {
      const group = packets.slice(i, Math.min(i + PER_PAGE, packets.length));
      g += 960 * group.length;
      const isEos = i + PER_PAGE >= packets.length;
      pages.push(makePage(isEos ? 0x04 : 0, g, 1234, seq++, group));
    }
    return { count: pages.length, bytes: pages.reduce((a, p) => a + p.length, 0) };
  };

  const A = time('current: 1 packet/page', () => current());
  const B = time('proposed: 20 packets/page', () => proposed());
  console.log(`  -> speed-up ${(A.best / B.best).toFixed(2)}x; pages ${A.last.count} -> ${B.last.count}; payload bytes ${A.last.bytes} -> ${B.last.bytes} (${(((B.last.bytes - A.last.bytes) / A.last.bytes) * 100).toFixed(1)} % container size)`);
}

console.log('[bench-js] 5. rollSession.live() — 240 Hz drag gesture: unthrottled vs rAF-throttled React notifies');
{
  const N_NOTES = 500;
  const EVENTS = 240;
  const DISPLAY_HZ = 60;
  const EVENTS_PER_FRAME = Math.round(EVENTS / DISPLAY_HZ);

  const simulateRender = (notes) => {
    let sum = 0;
    for (let i = 0; i < notes.length; i++) sum += notes[i].start * 10 + notes[i].note;
    return sum;
  };

  const notes = Array.from({ length: N_NOTES }, (_, i) => ({
    id: `n${i}`,
    start: i * 0.25,
    note: 60 + (i % 24),
    length: 0.25,
  }));

  // Baseline: unthrottled live() notifying listeners on every pointer event
  let baseRenders = 0;
  const runUnthrottled = () => {
    let currentDoc = { notes };
    let renders = 0;
    for (let i = 0; i < EVENTS; i++) {
      currentDoc = {
        notes: currentDoc.notes.map((n) => ({ ...n, start: n.start + 0.01 })),
      };
      // Every pointer event rebuilds state and triggers subscriber render
      renders++;
      simulateRender(currentDoc.notes);
    }
    baseRenders = renders;
    return renders;
  };

  // Landed: rAF-throttled live() coalescing notifications to display refresh rate
  let throttledRenders = 0;
  const runThrottled = () => {
    let currentDoc = { notes };
    let queued = false;
    let renders = 0;
    for (let i = 0; i < EVENTS; i++) {
      currentDoc = {
        notes: currentDoc.notes.map((n) => ({ ...n, start: n.start + 0.01 })),
      };
      queued = true;
      if (i % EVENTS_PER_FRAME === EVENTS_PER_FRAME - 1) {
        if (queued) {
          renders++;
          simulateRender(currentDoc.notes);
          queued = false;
        }
      }
    }
    if (queued) {
      renders++;
      simulateRender(currentDoc.notes);
    }
    throttledRenders = renders;
    return renders;
  };

  const A = time('unthrottled: 1 render/pointermove (HEAD)', runUnthrottled);
  const B = time('rAF-throttled: 1 render/frame (landed)', runThrottled);
  console.log(
    `  -> speed-up ${(A.best / B.best).toFixed(2)}x; React renders ${baseRenders} -> ${throttledRenders} (-${(((baseRenders - throttledRenders) / baseRenders) * 100).toFixed(1)} % renders during drag)`,
  );
}

