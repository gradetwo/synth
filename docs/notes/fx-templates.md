# Effect-graph templates (P7.3)

A template is a **routing**: which effect sits at each of the six chain
positions, whether it runs as a parallel send, and the graph that wires the
nodes together — input sources, input gains, which nodes reach the output, and
at what gain. Pick one and the whole routing lands in one change.

## Where a template lives

Templates are **workspace** data. They are stored in `LayoutState.fxTemplates`
under `gs1:layout:v1`, next to the card positions, not in the patch
(`gs1:state:v1`) and not in a share code. Saving one captures the routing that
is playing *now*; deleting one removes it from the workspace. Built-ins are not
in that list at all — they come from `state/fxtemplates.ts`, so they are always
present and cannot be deleted.

Applying a template *does* write patch parameters: the graph is patch data and
the DSP reads it from `Self::params`. That is the same as the editor's own
"rebuild from chain", which also writes those ids. The list itself never travels
with the patch.

## The whitelist

A template body is a map of parameter id → value, and only the ids in
`FX_TEMPLATE_PARAM_IDS` may appear in it:

| group | ids |
| :--- | :--- |
| chain positions | `FX_CHAIN1..FX_CHAIN6` |
| parallel sends | `FX_PARALLEL1..FX_PARALLEL6` |
| the graph | `GRAPH_FROM_CHAIN_IDS` — `FX_GRAPH`, then each node's input 1 source/gain, input 2 source/gain, `TO_OUT` and output gain |

That is 49 ids. Everything outside the list is deliberately left out, in
particular:

* `FX_REVERB_MODE` and everything about the imported impulse response — a
  template is algorithmic-only, so applying one can never switch the reverb to a
  response the receiver has not imported;
* every effect's on/off and mix (`FX_DELAY_ON`, `FX_REVERB_MIX`, `FX_DRIVE_MIX`,
  …) and every oscillator/filter/envelope parameter — a template changes the
  wiring, not the tone;
* the in-graph modulation edges (`FX_MOD*_SRC/DST/DEPTH`, P7.2) — those stay
  with the patch and are not part of a routing template.

Applying a template is one `setParams(..., { immediate: true })` call: one
notification, one undo step, two storage writes. The unit test pins that every
non-whitelisted id keeps its exact value (a `toBe` per id, not a tolerance).

## Loading is not trusting

`normalizeLayout` runs every stored body through `normalizeTemplateParams`:

* **unknown ids are dropped**, so a hand-edited or newer save cannot smuggle a
  timbre parameter into a template;
* every known id is **clamped**: a chain kind to `0…8`, a source code to
  `0…7`, a gain to `0…4`, a switch to `0/1`;
* a **forward or self edge becomes "not connected"** — a source may only name
  the dry bus (`1`) or an earlier node, which is what the renderer already
  ignores anything else as;
* a **third delay node reads as none**: the delay pool holds
  `FX_DELAY_INSTANCES` (2) lines, always, regardless of mode. A reverb is *not*
  capped here: the algorithmic reverb is not pooled, and in impulse-response
  mode the core already gives the nodes past the pool no tail;
* a body with **nothing recognisable is refused** (the entry is dropped), as are
  non-object entries, duplicate ids, and an id that would shadow a built-in.

An id missing from a stored body is filled from `DEFAULT_PARAMS` when applying,
so a template always produces a complete, deterministic routing.

## The built-ins

Five examples ship in code, built with the same `graphFromChain` mapping the
editor seeds from:

| id | name | routing |
| :--- | :--- | :--- |
| `fxg:serial` | 经典串联 | the default chain as a graph: node 1 → … → node 6 → out |
| `fxg:dual-delay` | 双延迟 | two delay nodes, both on the dry bus, both to the output |
| `fxg:parallel-reverb` | 并行混响 | two algorithmic reverbs side by side, both on the dry bus |
| `fxg:drive-split` | 失真分路 | one drive node as a parallel send, so dry keeps running |
| `fxg:empty` | 空图（仅干声） | only node 1 wired, dry → out: a clean slate that still sounds |

None of them asks for more instances than the P7.1 pools hold (two delays, and
two reverbs in the IR-mode worst case), and none sets `FX_REVERB_MODE`, so they
behave the same before and after an impulse response is imported. "Empty" is
dry-only on purpose: a template that silences the synth would be a footgun.

## Verification

* `src/state/fxtemplates.test.ts` — the whitelist excludes the timbre/IR/edge
  ids; clamping and forward-edge repair; the delay cap; junk bodies are refused;
  the saved list is validated; capture covers exactly the whitelist; the five
  built-ins survive their own validation.
* `src/state/store.test.ts` — applying a template matches the template id for id
  and moves **nothing** outside the whitelist (bit for bit, plus a single
  notification); save → fresh store → apply → delete; a corrupt stored list is
  repaired on load; a share code carries the graph (patch data, as before) and
  **not** the template list.
* `e2e/fxgraph.spec.ts` — applying "dual delay" changes the graph and survives a
  fresh load; saving the current graph adds it to the list and applying it after
  a fresh load restores the routing.
