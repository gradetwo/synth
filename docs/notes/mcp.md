# MCP 工具服务器 / The GS-1 tool server（P13.2）

**让你的 agent 离线、确定地看懂这台合成器、渲染出 WAV、并用本仓库自己的尺子量它。**

`docs/LLM-INTERFACE.md` 是设计与批次规划；本文件是 **P13.2 的实现说明**：协议、工具契约、
限制、怎么接 Claude/ChatGPT 类客户端，以及「工具与门禁共用同一份实现」的证据。

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
| `gs1.patch.get` | `{ presetId? }` | `shareCode`（**分享码同格式**）+ 解码后的完整 `patch` |
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

## 三、协议要点（帧与错误处理）

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

## 四、确定性、边界、无副作用

- **确定性**：每次 `gs1.render` 都 `initCore()` 起一个**全新的 wasm 实例**——`phase_seed` 与
  `random_seed` 从构造函数开始，所以同一调用两次逐字节相同；路径里没有任何 `Date.now()`。
  `seed` 是**真的输入**：新引擎 `phase_seed = 0`，`seed` 会用那么多次静音 note-on 把相位/随机
  序列推进（每次都分配空闲声部并 retrigger），所以同 seed 同字节、不同 seed 不同字节。
  黄金会话（`gs1.describe`→`params.list`→`presets.list`→`patch.get`→`render`→`analyze`→`gate`）
  跑两遍的 sha256 相同，`npm run mcp -- --self-test` 就是它。
- **有界**：`seconds ≤ 30`、`notes ≤ 512`、`seed ≤ 512`、`note ∈ 0..127`、`velocity ∈ 0..1`、
  `bins ≤ 64`；越界是**结构化拒绝**（`E_RANGE`/`E_SCHEMA`），不是崩也不是截断。
  `sampleRate` 目前只接受 48000——尺子就校准在这个率，给别的率会让数字失去意义。
- **无副作用**：只写 `.tmp/mcp/`（`outPath` 解析后必须仍在该目录内，否则 `E_PATH`），
  读也只读仓库内的路径。**永不部署、永不联网**。每次 `tools/call` 都会把
  `{ seq, tool, argsDigest, ok, code }` 追加到 `.tmp/mcp/calls.jsonl`（`--no-log` 可关）；
  里面**没有时间戳**，是序号 + 参数 sha256，这样日志本身也是确定的。

## 五、「与门禁共用同一实现」的证据

这是 P13 的全部意义：**工具量出来的数**必须与**门禁量出来的数**是同一个数。

- 渲染引导与统计量全部来自 `scripts/lib/render-core.mjs`（P13.1 抽出来的、`verify-audio.mjs`
  自己也在用的那份）：`gs1.render` 的 `mcp/lib/render.mjs` 只调用 `initCore`/`engine`/
  `renderWith`/`clearModMatrix`/`gs_set_mod_route`/`peakOf`/`rmsOf`/`worstStepOf`/
  `allocViolations`。为按块调度音符，P13.2 给 `render-core.mjs` 加了一个 `renderWith`
  原语，并把原来的 `render` 改成 `renderWith(blocks, null, skip)`——门禁的缓冲由**同一批语句**
  拷贝，读数不变。
- 尺子全部来自 `scripts/lib/audio-ruler.mjs`：`offGridFloor`（7 项 Blackman-Harris，±bins）、
  `binMagHann`（Hann Goertzel）、`thdPercent`、`interHarmonicDb`。为支持 `harmonics` 参数，
  `offGridFloor` 的第三个参数默认值就是门禁的 `FLOOR_BINS`，门禁两参数调用**行为逐位不变**。
- `gs1.gate` 的 fixture 就是门禁的 `renderFloor`（settled 4 s、清调制矩阵、单音）。
- **逐位证据**（`mcp/mcp.test.mjs` 的一条测试）：把门禁自己的 `QUIET_PATCH` 当作 patch 传进
  `gs1.gate`，它的 `floorDb` 与 `offGridFloor(renderFloor([[P.OSC1_WAVE, wave]], 81), hz(81))`
  ——即 `verify-audio.mjs` P9.1a 段的原调用——**`toBe` 全等**（saw/square/triangle/sine 四个波形
  逐一比对）。
- 反向证据：一条测试扫描 `mcp/**/*.mjs`，断言里面**没有** BH-7/BH-4 窗系数、没有
  `fftInPlace`/`offGridFloor`/`binMagHann` 的定义——尺子只有一份。

## 六、新增一个工具要改哪几个文件

**一个。** 在 `mcp/tools/` 放下一个新 `.mjs`，默认导出
`{ name, description, inputSchema, handler(args, ctx) }` 即可。`mcp/registry.mjs` 是**扫目录**
（按文件名排序、跳过 `_` 前缀的辅助模块），没有共享的 import 清单——这正是为了让 P13.3
（`patch.set`/`patch.random`/`sample.import`…）和 P13.4（`gs1.ui.*`）能在**各自的 worktree**里
各加各的文件而零冲突。以 `_` 开头的文件（如 `mcp/tools/_schemas.mjs`）是共享 schema 片段，
不注册。

## 七、限制与已知取舍

- **层**：所有数字都是 **Node 里的 wasm 核**测出来的，没有 AudioWorklet、没有 AudioParam
  自动化、没有 Web Audio 图。浏览器层的问题（v2.0.7 那种 AudioParam 量程 clamp）在这里
  **看不见**——真实浏览器测量是 P13.4。`gs1.describe` 的 `layer` 字段把这件事写进了结果里。
- **`analyze` 的 BH-7/Hann 是对「你给的那段音频」量的**。它包含调制与混响的能量；只有
  「单音、无调制、无混响」时才等同于混叠。要门禁口径的振荡器地板，用 `gs1.gate`
  （它走门禁的 settled fixture）。
- **分层音色**（`params2`/`instanceMode`）：`patch.get` 会完整返回，但 `gs1.render` v1
  只渲染 instance A，并在结果的 `layersRendered` 里注明。
- **导入类工具**（`sample.import` / `wavetable.import`）是 P13.3；本批只在 `gs1.describe`
  里透出 `MAX_BASE_SAMPLES`、采样器容量与 P9.8 的 `noRoom = 4` 返回码。
- 8 MiB 以上的 HTTP body 会被服务端直接断开；服务只绑 `127.0.0.1`。
