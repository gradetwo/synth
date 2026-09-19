# In-graph modulation (P7.2)

LFO 1, LFO 2 and the envelope are nodes on the effect graph, and a wire from one
of them to a node gain is the modulation: **the depth sits on the edge**, not on
the source, so one LFO can push several gains by different amounts.

## The data model

Four edges, three parameter ids each, appended after `OVERSAMPLE` (ids 167–178;
`PARAM_COUNT` 179). Ids are the share-code wire format, so they were only ever
appended — every existing share code still lines up, and every depth starts at
`0`, which is what keeps a patch written before this feature bit for bit its old
self.

| field | meaning |
| :--- | :--- |
| `src` | `0` off, `1` LFO 1, `2` LFO 2, `3` the envelope |
| `dst` | `0` off, else `1 + node * 3 + which`: input 1 gain, input 2 gain, output gain |
| `depth` | the signed amount the edge adds to that gain, `-1…1`, smoothed |

## What an edge does

```
gain[node][which] = clamp(host_gain[node][which] + Σ depth[e] * source[e], 0, 4)
```

resolved once per block in `Engine::graph_gains`, then the eighteen gains feed
the same node mix and bus sum the graph always used.

* **Sources.** LFO 1/2 are the raw global LFO value in `-1…1` — deliberately
  *not* scaled by `LFO_DEPTH`, which is the LFO's own direct-target amount. The
  envelope source is the **highest** `env_value` among sounding voices, i.e. a
  bus-level follower: a released note holds the edge open while its tail rings,
  because there is one envelope per voice and the graph is a bus effect.
* **Depth 0 is transparent.** The engine only takes the modulated path when at
  least one edge has a source, a target *and* a non-zero depth. Otherwise the
  host values are used verbatim: no sum, no smoother, no arithmetic. A test
  pins the render to `0` difference (`worstDiff === 0`), with the matrix on and
  off.
* **A target outside the eighteen gains reads as "no edge".** `mod_dst_code`
  clamps it to 0, the same way a bad audio source code reads as disconnected.
  There is no way for an edge to name per-node DSP state, so it cannot close a
  loop — the graph stays feed-forward by construction.

## Block rate vs. the modulation matrix

Both mechanisms are evaluated **once per block** (128 frames) — there is no
per-sample modulation path in this engine — but their scope and destination sets
are different:

| | 8-slot matrix | in-graph edges |
| :--- | :--- | :--- |
| rate | once per block, **per voice** | once per block, on the FX **bus** |
| sources | LFO 1/2, env, mod wheel, velocity, aftertouch, random, keytrack | LFO 1/2, env |
| destinations | cutoff, pitch, volume, pwm, pan, res, fm, ring | the eighteen node gains |
| amount | on the matrix row | on the edge |
| smoothing | source is already per-voice; destinations are the DSP's own | depth is a continuous parameter (host one-pole) **and** the node gain has its own one-pole while an edge is live (`SMOOTH_TAU_S`, ~20 ms) |

The destination sets do not overlap, so the two simply coexist: the matrix
changes what the voices produce, the graph edge changes how their sum is routed
and scaled, and the two therefore *multiply* in the signal path. The unit test
`coexists with the matrix` pins all three facts — the matrix row is audible on
its own, a zero-depth edge does not disturb it (bit for bit), and a live edge
changes the result on top of it.

**Known boundary.** Effect parameters (delay time/feedback, reverb size and
mixes, drive amount, …) are stored per *kind*, not per node, exactly as they
were for P7.1. They are therefore not modulation targets: a "node parameter"
here means the node's own wiring gains. Per-node effect parameters would need
their own parameter ids and knobs, which is the same separate pass P7.1
documented.

## Verification

`src/audio/fxgraph.test.ts` (real wasm, time and frequency domain):

* depth 0 → **bit for bit** identical to no edge, matrix on and off;
* an out-of-range destination → bit for bit identical;
* two edges on the same gain sum (0.3 + 0.2 = 0.5 to `1e-6`, the f32 add order);
* depth 0.5 around a base gain of 0.5 → sidebands at `f0 ± f_lfo` whose measured
  amplitude is half the carrier (Hann-windowed Goertzel at `f0 / 8`, a whole
  number of carrier cycles per window), while the unmodulated render's sideband
  bin stays under 2 % of the carrier;
* depths ±1 stay finite and under peak 2 (base gain 0);
* the peak and the destination/length clamps are also unit-tested in Rust
  (`params::tests::in_graph_modulation_ids_decode`, `…_values_clamp`).

`e2e/fxgraph.spec.ts` drags a wire from the LFO 1 card to node 1's output gain,
edits the depth on the wire's chip, adds a second edge from the strip (the
phone/keyboard path), and checks both survive a fresh load.
