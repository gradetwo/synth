# MCP 工具服务器 / The GS-1 tool server（P13.2 + P13.3）

**让你的 agent 离线、确定地看懂这台合成器、改它、渲染出 WAV、并用本仓库自己的尺子量它。**

`docs/LLM-INTERFACE.md` 是设计与批次规划；本文件是 **P13.2（只读 + 渲染 + 测量）与 P13.3（操作类）的实现说明**：
协议、工具契约、会话状态规则、限制、怎么接 Claude/ChatGPT 类客户端，以及「工具与门禁共用同一份实现」的证据。

## 一、跑起来

```bash
npm run mcp                      # MCP over stdio（Claude Desktop、各类 agent SDK）
npm run mcp -- --http --port 3939   # 同一套工具的 JSON-RPC，只绑 127.0.0.1
npm run mcp -- --self-test       # 黄金会话跑两遍并逐字节比较，打印结果后退出
npm run mcp -- --no-log          # 不写 .tmp/mcp/calls.jsonl
```

**零新增运行时依赖**：协议是手写的（`mcp/protocol.mjs` + `mcp/framing.mjs`），
HTTP 用 `node:http`，WAV 用仓库既有的 `encodeWavBuffer`。读取 app 的 TypeScript 用
`esbuild`（vite 已经带来，且本来就在 `devDependencies` 里），所以 `dependencies` 一个条目
都没有增加——`mcp/mcp.test.mjs` 里有一条测试把 `dependencies` 与 v2.1.0 的清单逐一比对。

接 Claude Desktop（`claude_desktop_config.json`）：

```json
{ "mcpServers": { "gs1": { "command": "npm", "args": ["run", "mcp", "--silent"],
  "cwd": "/home/crow/music/synth" } } }
```

接不玩 MCP 的客户端：`node mcp/server.mjs --http`，然后向 `http://127.0.0.1:3939/`
POST 一个 JSON-RPC 2.0 消息（`initialize` / `tools/list` / `tools/call`）；`GET /` 会列出工具名。

## 二、工具清单（P13.2：只读 + 渲染 + 测量）

| 工具 | 输入 | 输出（要点） |
| :--- | :--- | :--- |
| `gs1.describe` | — | 版本、ABI 8、`paramCount` 224、48000 Hz、128 块、arena 容量/余量、采样器上限与 P9.8 返回码、全部枚举、预设数 |
| `gs1.params.list` | `{ filter? }` | `{ id, key, nameEn, nameZh, min, max, default, unit, discrete }[]` |
| `gs1.presets.list` | — | `{ id, name, tag, cat, wave, tags, hasLayer, instanceMode }[]`（91 条） |
| `gs1.patch.get` | `{ presetId? }` | `shareCode`（**分享码同格式**）+ 解码后的完整 `patch`；无参数时给**会话当前 patch** |
| `gs1.render` | `{ patch?/presetId?, notes, seconds, oversample?, sampleRate?, seed?, outPath? }` | `{ wavPath, sha256, byteLength, samples, peak, rms, maxStep, nonFinite, allocViolations }` |
| `gs1.analyze` | `{ wavPath }` 或 `{ render }` + `{ f0?, note?, bins?, probes? }` | 时域 + BH-7 + Hann（**每个数都带尺子名**）+ `nonFinite`/`allocViolations` |
| `gs1.gate` | `{ patch?, notes, ruler?, harmonics?, thresholdDb?, probes?, oversample? }` | 各音高的 BH-7 / Hann 地板 + `passed`，判据与 `verify:audio` 相同 |

### 输入/输出实例（都是真跑出来的）

`gs1.describe`（截断）：
```json
{"version":"2.1.0","abi":8,"paramCount":224,"sampleRate":48000,"blockSize":128,
 "arena":{"capacityBytes":12582912,"freeBytes":12582912,"allocViolations":0},
 "sampler":{"maxBaseSamples":192000,"importCapacity":192000,
            "importCodes":{"ok":0,"short":1,"silent":2,"notFinite":3,"noRoom":4}},
 "enums":{"waves":["sine","triangle","saw","square","pulse","noise","pink","brown","wavetable","sample"],
          "filterTypes":["lp","hp","bp","nt","comb","formant","sem"],
          "fxKinds":["none","delay","reverb","chorus","flanger","phaser","drive","crush","eq","transient"]},
 "presets":{"count":91}}
```

`gs1.params.list {filter:"filterCutoff"}`：
```json
{"id":14,"key":"filterCutoff","nameEn":"CUTOFF","nameZh":null,
 "min":20,"max":20000,"default":9000,"unit":"kHz","discrete":false}
```
> `min/max/default` 是从 `src/audio/worklet-processor.js` 的 `PARAMS` 表**解析**出来的
> （浏览器真正服务的量程），`key` 来自 `PARAM_NAMES`，`nameEn` 来自 `PARAM_SPECS.label`，
> `discrete` 来自 `DISCRETE_PARAMS`。`nameZh` 恒为 `null`：本仓库不逐个本地化旋钮标签，
> 没有权威中文名可以返回，所以不编一个。

`gs1.render {notes:[{note:60,velocity:0.9}],seconds:1,seed:7}`：
```json
{"wavPath":".tmp/mcp/9f2c...e1.wav","sha256":"59c16bcb…f12dd","byteLength":192044,
 "samples":48000,"time":{"ruler":"time-domain-float","peak":0.0596,"rms":0.0215,"maxStep":0.0581},
 "nonFinite":0,"allocViolations":0}
```

`gs1.analyze {render:…, f0:261.6256}`（截断）：
```json
{"aliasing":{"ruler":"bh7","window":"blackman-harris-7","bins":8,"perNote":[…],"worstDb":-8.76},
 "secondRuler":{"ruler":"hann-goertzel","window":"hann",
                "probes":[{"frequency":9000,"db":-20.9},{"frequency":9200,"db":-13.8},{"frequency":9500,"db":-42.9}],
                "worstDb":-13.76},
 "nonFinite":0,"allocViolations":0}
```

`gs1.gate`（用门禁自己的 quiet 差分音色，C4=220 Hz 与 A5=880 Hz）：
```json
{"ruler":"both","bins":8,"thresholdDb":-60,
 "perNote":[{"note":57,"f0":220,"bh7":-115.96,"hann":-161.03,"passed":true},
            {"note":81,"f0":880,"bh7":-113.87,"hann":-153.52,"passed":true}],
 "worstBh7Db":-113.87,"worstHannDb":-153.52,"passed":true,
 "nonFinite":0,"allocViolations":0}
```

## 三、操作类工具与状态规则（P13.3）

| 工具 | 输入 | 输出（要点） |
| :--- | :--- | :--- |
| `gs1.patch.set` | `{ patch }` / `{ presetId }` / `{ params:{key:value}, partial? }` | 生效后的 `patch` + `shareCode` + `summary` + **`clamped:[{key,asked,got,reason}]`**（夹取/取整必须报告） |
| `gs1.patch.random` | `{ seed }`（**必填**） | 同 UI「随机」按钮的配方，输出 `patch`/`shareCode` + `randomised:[id…]`；缺 seed 拒绝 |
| `gs1.sample.import` | `{ path }` 或 `{ wavBase64 }`，可选 `{ name }` | `{ ok, code, note, samples, sampleRate, capacity, poolBytes, arenaFreeBytes }`；**装不下拒绝，不截断** |
| `gs1.wavetable.import` | `{ path }` 或 `{ cycleBase64 }`，可选 `{ name }` | `{ ok, code, note, samples, capacity }`（`samples` 恒为 2048） |
| `gs1.songs.list` | — | `[{ id, title, titleZh, composer, source:{kind,credit,url?}, bpm }]`（**从 `src/midi/songs.ts` 派生**） |
| `gs1.preset.apply` | `{ presetId }` 或 `{ file }` | 走 `patch.set` 的同一条路；`file` 是仓库内的 `.gs1.json` |
| `gs1.preset.save` | `{ name?, outPath? }` | 把当前 patch 写成**用户库 `.gs1.json` 格式**（默认 `.tmp/mcp/`）+ `sha256` |

**名字说明（与 `docs/LLM-INTERFACE.md` 的出入）**：`gs1.songs.list` 在 §4.1 被列在**只读类**、P13.2 没交付，
本批补上；`gs1.preset.apply` / `gs1.preset.save` 在 §4.2 **根本没有列**，名字取自 P13.3 任务书。
其余名字与文档一致。

### 输入/输出实例（真跑）

```json
// gs1.patch.set { params: { filterCutoff: 99999, osc1Wave: 1.4 } }
{"ok":true,"applied":"params","partial":false,"source":"session",
 "clamped":[{"key":"filterCutoff","asked":99999,"got":20000,"reason":"max"},
            {"key":"osc1Wave","asked":1.4,"got":1,"reason":"discrete"}],
 "shareCode":"gs1.1.eyJzIjo0LCJ2Ij…","summary":{"presetId":null,"instanceMode":"single",…,"paramCount":224}}

// gs1.patch.random { seed: 11 }
{"ok":true,"seed":11,"randomised":[1,2,3,…],"clamped":[],
 "shareCode":"gs1.1.eyJzIjo0LCJ2Ij…"}    // 同 seed 两次逐字节相同

// gs1.sample.import { wavBase64: "<480 samples @48k>", name: "tone.wav" }
{"ok":true,"code":0,"note":"ok","name":"tone.wav","source":"wavBase64",
 "samples":480,"sampleRate":48000,"capacity":192000,"poolBytes":3856,"arenaFreeBytes":11811040}

// gs1.wavetable.import { cycleBase64: "<one cycle>", name: "cycle-a" }
{"ok":true,"code":0,"note":"ok","name":"cycle-a","samples":2048,"capacity":2048}

// gs1.songs.list {}
{"count":25,"sourceKinds":{"public-domain":19,"original":6},
 "songs":[{"id":"elise","title":"Für Elise","titleZh":"致爱丽丝","composer":"L. v. Beethoven",
           "source":{"kind":"public-domain","credit":"WoO 59"},"bpm":112}, …]}

// gs1.preset.save { name: "demo" }
{"ok":true,"format":"gs1-preset","savePath":".tmp/mcp/demo.gs1.json","name":"demo",
 "byteLength":3688,"sha256":"d0d514bd…","paramCount":224,"routeCount":4,"layered":false,"source":"session"}
```

`poolBytes` 的定义是**这次调用向 arena 新要到的字节数**（mipmap 本体；量之前先把 768 KB 的
staging buffer 建好，所以它不计入）。同一个引擎里第二次导入同样长度的采样时，pool 会被复用，
`poolBytes` 就是 `0`——这是如实报告「这次没有新占内存」，不是「没有导入」。

### 会话状态规则（哪些工具读、哪些写、`render` 用不用当前状态）

状态只有一份，放在 `ctx.session`（`mcp/lib/session.mjs`）：

```js
{ patch: null | { params, params2, instanceMode, splitNote, routes, shareCode, presetId },
  sample: null | { name, samples, sampleRate, poolBytes },
  wavetable: null | { name, cycle } }
```

| 工具 | 读 | 写 |
| :--- | :--- | :--- |
| `gs1.describe` / `params.list` / `presets.list` / `songs.list` | app 数据 | — |
| `gs1.patch.get`（无 `patch`/`presetId`） | `session.patch`（空则默认 patch） | — |
| `gs1.patch.set` / `patch.random` / `preset.apply` | 会话（`partial`） | **`session.patch`** |
| `gs1.sample.import` | — | **`session.sample`**（并装进当前引擎） |
| `gs1.wavetable.import` | — | **`session.wavetable`**（并装进当前引擎） |
| `gs1.render` / `gs1.analyze {render}` / `gs1.gate` | `session.patch`（仅当调用者没给 `patch`/`presetId`）+ `session.sample`/`session.wavetable` | — |
| `gs1.preset.save` | `session.patch`（空则默认 patch） | 只写 `.tmp/mcp/` 的文件 |

**`render` 用当前状态，但引擎不跨调用保留**：每次 `gs1.render`/`gs1.gate` 都 `initCore()`
起一个**全新的 wasm 实例**（`phase_seed = 0`，这是逐字节确定性的来源），所以 `sample.import`
装进旧实例的东西不会被继承——真正的状态在 `session` 里，渲染一开始由
`installInstrument()` 把 `session.sample` / `session.wavetable` **重放进新实例**，跟浏览器
reload 后 `installUserSample()` 做的事一样。

**每个 pass 一个干净会话**：`runGoldenSession()` 的每一遍都先 `resetSession(ctx)`
（清空 patch/采样/波表 + 换一个新 wasm 实例），所以第二遍不会继承第一遍的 sample pool 或当前
patch；`npm run mcp -- --self-test` 的第二遍才有意义。

**黄金会话**：21 次调用，覆盖全部 14 个工具，其中 8 次是变异/观察（`patch.set`（夹取）→
`patch.get` → `patch.random` → `patch.get` → `patch.set{presetId}` → `preset.apply` →
`patch.get` → `sample.import` → `wavetable.import` → `render`（无 patch，吃会话状态）→
`preset.save` → `patch.set{patch}` → `patch.get`）。两遍的规范化 JSON `sha256` 相同，
WAV 与 `.gs1.json` 的字节也相同。

### 拒绝路径（输入 → 结构化错误）

| 输入 | `error.code` | 附带字段 |
| :--- | :--- | :--- |
| `patch.set {}` / 同时给两个来源 / `params` 是数组 / `patch` 是数字 | `E_SCHEMA` | `given` / `field` |
| `patch.set { presetId: "nope" }` | `E_PATCH` | `presetId` |
| `patch.set { patch: { nope: 1 } }` / 坏分享码 | `E_PATCH` | `hint` / `prefix` |
| `patch.set { params: { nonsenseKey: 1 } }` | `E_PARAM` | `field` |
| `patch.set { params: { filterCutoff: "loud" \| NaN } }` | `E_PARAM` | `field`, `value` |
| `patch.random {}`（缺 seed）/ `seed: 1.5` | `E_SCHEMA` | `field: "seed"` |
| `patch.random { seed: -1 }` | `E_RANGE` | `field: "seed"` |
| `sample.import { wavBase64: <非 RIFF> }` | `E_WAV` | `note: "decode"`, `source: "decoder"` |
| `sample.import { path: <200000 样本> }` | `E_RANGE` | `field:"samples"`, `value`, `max:192000`（**不截断**） |
| `sample.import { wavBase64: <静音> }` | `E_IMPORT` | `note:"silent"`, `importCode:2`, `source:"core"` |
| `sample.import { wavBase64: <20 样本> }` | `E_IMPORT` | `note:"short"`, `importCode:1` |
| `sample.import` 两个来源都给 / 都不给 / `path` 逃出仓库 | `E_SCHEMA` / `E_PATH` | `field` / `allowedRoot` |
| `sample.import` 装不下 | `E_IMPORT` | `note:"noRoom"`, `importCode:4`, `source:"core"` |
| `wavetable.import { cycleBase64: <静音> }` | `E_IMPORT` | `note:"silent"`, `source:"decoder"` |
| `wavetable.import { cycleBase64: <junk> }` | `E_WAV` | `note:"decode"` |
| `preset.apply { presetId: "nope" }` | `E_PATCH` | `presetId` |
| `preset.apply { file: <gs1song> }` / junk | `E_PATCH` | `file` |
| `preset.apply { file: "../../etc/passwd" }` | `E_PATH` | `field: "file"` |
| `preset.save { outPath: "../x" \| "src/x" }` | `E_PATH` | `allowedRoot: ".tmp/mcp/"` |
| `songs.list { filter: "x" }` | `E_SCHEMA` | `field` |

**关于 `noRoom`（P9.8 返回码 4）**：工具把它原样透传（`error.importCode = 4`、`error.note = "noRoom"`），
但**本仓库 12 MiB 的 arena 到不了这个码**：`crates/synth-core/src/dsp/sampler.rs` 自己的测试
`the_longest_mipmap_fits_the_arena` 断言 4 秒采样的 mipmap 只要不到一半 arena，直接探针
（先装满 98304 样本的 IR，再导入 4 秒采样）也还剩 ~7.9 MB。所以 noRoom 是**防御路径**，
P9.8 当年是靠把 `ARENA_SIZE` 临时改成 5 MiB 验证的。测试因此只替换**那一次决定判定的 core 调用**
（`runSampleImport(..., () => 4)`），其余（解码、容量检查、staging、arena 计量、错误形状）全是真的；
同一条测试用真实 core 跑一遍 4 秒采样 + IR，断言 `code === 0` 并说明为什么必须注入。
输出里没有 `code` 顶层字段与 `error.code` 冲突：`error.code` 是工具词汇（`E_IMPORT`），
P9.8 的数字在 `error.importCode`。

## 四、协议要点（帧与错误处理）

- **stdio 帧**：MCP 的 stdio 是**换行分隔的 JSON-RPC**（一行一条，无 `Content-Length`）。
  `mcp/framing.mjs` 的 `createLineDecoder` 能处理跨 chunk 的半条消息、一次多条的 batch、
  以及结尾没有换行的最后一条；`mcp/server.mjs` 用一条 promise 链**按请求顺序**回，避免慢的
  `tools/call` 让后一条响应超车。
- **方法**：`initialize` / `tools/list` / `tools/call` / `ping`，以及 `notifications/*`（不回帧）。
  未知方法 → `-32601`；未知工具 → `-32602`（`data.code = E_TOOL`，并列出可用工具）；
  非法 JSON → `-32700`；不是 JSON-RPC 2.0 → `-32600`。
- **两类失败分得很清**：
  - **协议错误**是 JSON-RPC 的 `error` 帧（请求本身坏了）；
  - **工具拒绝**是一条**成功的** JSON-RPC 响应，`result.isError = true`，并在
    `content[0].text` 与 `structuredContent` 里给同一个 `{ code, message, … }`——
    因为「`seconds=999`」是**格式正确但被拒绝**的请求，不该看起来像客户端坏了。
- **每个工具都返回结构化 JSON**：`content[0].text` 是同一对象的字符串（照顾老客户端），
  `structuredContent` 是新字段；大对象只给**文件路径**，不塞 base64。

## 五、确定性、边界、无副作用

- **确定性**：每次 `gs1.render` 都 `initCore()` 起一个**全新的 wasm 实例**——`phase_seed` 与
  `random_seed` 从构造函数开始，所以同一调用两次逐字节相同；路径里没有任何 `Date.now()`。
  `seed` 是**真的输入**：新引擎 `phase_seed = 0`，`seed` 会用那么多次静音 note-on 把相位/随机
  序列推进（每次都分配空闲声部并 retrigger），所以同 seed 同字节、不同 seed 不同字节。
  `gs1.patch.random` 的 `seed` 走 `mcp/lib/random.mjs` 里一个具名的 `mulberry32`，同 seed 同
  patch；`mcp/lib/random.mjs` 只拥有「哪些 id、各自的分布」这一小段配方（`store.randomize()`
  用 `Math.random()`，无法被重放），一条测试直接从 `src/state/store.ts` 里抽出 `randomize()`
  写的 id 集合与它比对，防止两边悄悄漂移。黄金会话跑两遍的 sha256 相同，
  `npm run mcp -- --self-test` 就是它。
- **有界**：`seconds ≤ 30`、`notes ≤ 512`、`seed ≤ 512`、`note ∈ 0..127`、`velocity ∈ 0..1`、
  `bins ≤ 64`；参数按 worklet 服务的量程夹取并**报告**；导入的采样遵守 `MAX_BASE_SAMPLES`
  （`gs_sample_capacity()`），**超长是拒绝不是截断**。越界一律**结构化拒绝**
  （`E_SCHEMA`/`E_RANGE`/`E_PARAM`/`E_WAV`/`E_IMPORT`/`E_PATH`），不是崩。
  `sampleRate` 目前只接受 48000——尺子就校准在这个率，给别的率会让数字失去意义。
- **无副作用**：只写 `.tmp/mcp/`（`outPath`/`savePath` 解析后必须仍在该目录内，否则 `E_PATH`），
  读也只读仓库内的路径。`preset.save` 写的是 app 自己的 `.gs1.json` 用户库格式，**不碰
  `localStorage`、不碰 `src/`**。**永不部署、永不联网**。每次 `tools/call` 都会把
  `{ seq, tool, argsDigest, ok, code }` 追加到 `.tmp/mcp/calls.jsonl`（`--no-log` 可关）；
  里面**没有时间戳**，是序号 + 参数 sha256，这样日志本身也是确定的。

## 六、「与门禁共用同一实现」的证据

这是 P13 的全部意义：**工具量出来的数**必须与**门禁量出来的数**是同一个数。

- 渲染引导与统计量全部来自 `scripts/lib/render-core.mjs`（P13.1 抽出来的、`verify-audio.mjs`
  自己也在用的那份）：`gs1.render` 的 `mcp/lib/render.mjs` 只调用 `initCore`/`engine`/
  `renderWith`/`clearModMatrix`/`gs_set_mod_route`/`peakOf`/`rmsOf`/`worstStepOf`/
  `allocViolations`。为按块调度音符，P13.2 给 `render-core.mjs` 加了一个 `renderWith`
  原语，并把原来的 `render` 改成 `renderWith(blocks, null, skip)`——门禁的缓冲由**同一批语句**
  拷贝，读数不变。P13.3 的导入也不自己 stage：`sample.import`/`wavetable.import` 调的是
  `render-core.mjs` 的 `importSample`/`importWavetableCycle`（即 worklet 自己的做法）。
- 尺子全部来自 `scripts/lib/audio-ruler.mjs`：`offGridFloor`（7 项 Blackman-Harris，±bins）、
  `binMagHann`（Hann Goertzel）、`thdPercent`、`interHarmonicDb`。为支持 `harmonics` 参数，
  `offGridFloor` 的第三个参数默认值就是门禁的 `FLOOR_BINS`，门禁两参数调用**行为逐位不变**。
- `gs1.gate` 的 fixture 就是门禁的 `renderFloor`（settled 4 s、清调制矩阵、单音）。
- **解码也是 app 的**：`sample.import` 走 `src/audio/wavefile.ts` 的 `decodeSampleFile`，
  `wavetable.import` 走它的 `decodeCycle`（自相关找周期、多周期平均）；`preset.apply { file }`
  走 `src/state/patchfile.ts` 的 `parsePatchFile`；`patch.set` 的分享码走
  `src/state/share.ts` 的 `encodePatch`/`decodePatch`；`preset.save` 写的是 store
  `exportCurrentPreset()` 的同一种 payload。`mcp/` 里没有第二份 WAV/MIDI/预设解析。
- **逐位证据**（`mcp/mcp.test.mjs` 的一条测试）：把门禁自己的 `QUIET_PATCH` 当作 patch 传进
  `gs1.gate`，它的 `floorDb` 与 `offGridFloor(renderFloor([[P.OSC1_WAVE, wave]], 81), hz(81))`
  ——即 `verify-audio.mjs` P9.1a 段的原调用——**`toBe` 全等**（saw/square/triangle/sine 四个波形
  逐一比对）。
- **往返证据**（`mcp/ops.test.mjs`）：`patch.get {presetId}` → `patch.set {patch: <该分享码>}`
  → `patch.get {}` 的 `shareCode` 与 224 个参数**逐字节相同**（pluck/pad/acid + 手工分层
  `params2` 各一条）；保存到 `.gs1.json` 再 `preset.apply { file }` 回来也相同。
- 反向证据：一条测试扫描 `mcp/**/*.mjs`，断言里面**没有** BH-7/BH-4 窗系数、没有
  `fftInPlace`/`offGridFloor`/`binMagHann` 的定义——尺子只有一份。

## 七、新增一个工具要改哪几个文件

**一个。** 在 `mcp/tools/` 放下一个新 `.mjs`，默认导出
`{ name, description, inputSchema, handler(args, ctx) }` 即可。`mcp/registry.mjs` 是**扫目录**
（按文件名排序、跳过 `_` 前缀的辅助模块），没有共享的 import 清单——P13.3 的七个操作类工具就是
这么加进来的（只新增文件 + 复用 `mcp/lib/` 的新模块），P13.4（`gs1.ui.*`）也能在**自己的
worktree**里各加各的文件而零冲突。以 `_` 开头的文件（如 `mcp/tools/_schemas.mjs`）是共享 schema
片段，不注册。

## 八、限制与已知取舍

- **层**：所有数字都是 **Node 里的 wasm 核**测出来的，没有 AudioWorklet、没有 AudioParam
  自动化、没有 Web Audio 图。浏览器层的问题（v2.0.7 那种 AudioParam 量程 clamp）在这里
  **看不见**——真实浏览器测量是 P13.4。`gs1.describe` 的 `layer` 字段把这件事写进了结果里。
- **`analyze` 的 BH-7/Hann 是对「你给的那段音频」量的**。它包含调制与混响的能量；只有
  「单音、无调制、无混响」时才等同于混叠。要门禁口径的振荡器地板，用 `gs1.gate`
  （它走门禁的 settled fixture）。
- **分层音色**（`params2`/`instanceMode`）：`patch.get`/`patch.set`/`preset.apply`/`preset.save`
  会完整读写它，但 `gs1.render` v1 只渲染 instance A，并在结果的 `layersRendered` 里注明。
- **`gs1.patch.random` 的随机配方不是从 `store.randomize()` 运行时导入的**（它用全局
  `Math.random()`，无法重放）。`mcp/lib/random.mjs` 转写了它的 id 与分布，用种子化 PRNG 驱动；
  一条测试从 `store.ts` 源码抽出 id 集合比对，夹取步骤再对量程兜底。若哪天按钮改了配方，
  id 集合变了测试会红，分布变了则需要人工同步——这是本批已知的唯一「两处配方」。
- **`noRoom` 是防御路径**（12 MiB arena 到不了），见第三节。
- 8 MiB 以上的 HTTP body 会被服务端直接断开；服务只绑 `127.0.0.1`。
