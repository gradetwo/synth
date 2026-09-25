# GS-1 的 LLM / MCP 接口：外部可读的契约（P13，2026-09-14 立项）

> 用户要求：「设计规划提供接口让其它 AI/LLM 使用本 app」。
> 本文是**外部 agent 读的那一份**：19 个工具的名字、输入、返回字段、错误码、资源上限、怎么接、
> 以及末尾的**接入自查清单**。另一份 `docs/notes/mcp.md` 是**实现说明**：为什么手写 JSON-RPC、
> 为什么零新增运行时依赖、目录驱动注册表、确定性的来源、浏览器层为什么独立进程/端口，以及
> P13.2–P13.4 的已知取舍。**只读这两份文件就能接上**，不必读源码；门禁的自证在
> `scripts/verify-llm-docs.mjs`（文档与代码漂移即红）。

## 一、现状：已经交付了什么（v2.1.1，2026-09-15）

一共 **19 个工具**：**14 个离线工具**（`mcp/tools/*.mjs`，入口 `npm run mcp`）+
**5 个浏览器工具**（`mcp/ui/tools/*.mjs`，入口 `npm run mcp:ui`）。两个 registry 都是**扫目录**：
按**文件名**排序（不是工具名的字母序——所以 `gs1.patch.random`、`gs1.patch.set` 在前，
`gs1.patch.get` 在后）、跳过 `_` 前缀的辅助模块；新增一个工具＝加一个文件，不动任何共享清单。
`tools/list` 的顺序因此是**稳定**的。

| | 离线层（14） | 浏览器层（5） |
| :--- | :--- | :--- |
| 入口 | `npm run mcp`（stdio）或 `--http` | `npm run mcp:ui`（stdio）或 `--http` |
| 需要 | `npm install`（CI 与本地实测的 Node 是 22；`esbuild` 是 vite 带来的既有 devDependency） | 上面全部 **+** 一份 `dist/` **+** Chromium |
| 不读 | `dist/`、Chromium、网络 | —— |
| 端口 | `--http` 默认 `127.0.0.1:3939` | 自己的预览默认 `127.0.0.1:4796`（`GS1_MCP_UI_PORT` 可改） |
| 在 `verify`/CI 里？ | **是**（`npm run mcp -- --self-test`） | **故意不在**：它需要 Chromium 与 `dist/` |

**起法**（仓库根目录）：

```bash
npm install                                   # 必需；零新增运行时依赖
npm run build:wasm                            # 第一次跑门禁/工具前需要 src/generated/*.wasm
npm run mcp                                   # 离线层：MCP over stdio
npm run mcp -- --http --port 3939             # 离线层：同一套工具的 JSON-RPC，只绑 127.0.0.1
npm run mcp -- --self-test                    # 黄金会话跑两遍、逐字节比较
npm run mcp -- --no-log                       # 不写 .tmp/mcp/calls.jsonl

npm run build                                 # 浏览器层要先有一份 dist/（含 wasm + SW）
npx playwright install chromium               # 浏览器层要 Chromium
npm run mcp:ui                                # 浏览器层：14 个离线工具 + 5 个 gs1.ui.*
npm run ui:smoke                              # 端到端冒烟：开页 → 启动引擎 → 装预设 → 读 DOM → 截图
```

- **两个 script 故意不在 `npm run verify` / CI 里**：`mcp:ui` 与 `ui:smoke` 需要 Chromium 和
  `dist/`，与 `test:e2e` / `test:perf` 同类；`scripts/verify-ci.mjs` 会断言它们**没有**被塞进
  必需门禁。离线层的黄金会话（`npm run mcp -- --self-test`）**在** `verify` 与 CI 链里。
- **19 个工具的名字**（文档与注册表由 `scripts/verify-llm-docs.mjs` 双向核对）：
  `gs1.analyze`、`gs1.describe`、`gs1.gate`、`gs1.params.list`、`gs1.patch.get`、`gs1.patch.random`、
  `gs1.patch.set`、`gs1.preset.apply`、`gs1.preset.save`、`gs1.presets.list`、`gs1.render`、
  `gs1.sample.import`、`gs1.songs.list`、`gs1.wavetable.import`；
  `gs1.ui.click`、`gs1.ui.gate`、`gs1.ui.open`、`gs1.ui.screenshot`、`gs1.ui.text`。
- **版本**：引擎与工具都读 `package.json` 的 `version`（当前 **2.1.1**）。`gs1.describe` 的 `version`
  与 `initialize` 的 `serverInfo.version` 都是它；ABI 是 **9**。

## 二、目标与非目标

**目标**：让一个外部 agent（Claude/ChatGPT/自研）能**离线、确定地**：
1. **看懂**这台合成器有什么：参数表（id/名字/范围/默认/单位）、预设、曲库、效果节点；
2. **改**它：读写整套音色（patch）、套用/保存预设、导入采样与波表；
3. **听**它：把一段演奏**渲染成 WAV**；
4. **量**它：用**本仓库自己的尺子**（BH-7 非谐波地板、Hann 探针、THD、峰值/RMS、最大步进）给出结构化数字；
5. **迭代**：拿到数字 → 改参数 → 再量，直到满足某个门禁（例如「≥1 kHz 非谐波 ≤ −60 dB」）。

**非目标（明确不做）**：
- **不做真实音频输出**（不接声卡；只做离线渲染）——省掉设备与实时性的全部麻烦；
- **不做联网/云**：服务器只在本机 stdio/loopback 上跑，**不发任何请求**；
- **不做任意代码执行**：工具是**白名单**的固定动词，不接受表达式/脚本；
- **不碰部署**：MCP 服务器**永远不会**调用 `wrangler` / `release`；它只能读仓库与写 `.tmp/mcp/`。

**为什么值得做**：本仓库最有价值的、别人没有的东西不是「又一个合成器」，而是
**一套已经被交叉验证过的测量尺子**（BH-7 + Hann 双尺子、1/N² 表长律、P9.1b/P9.1c/P9.6/P9.7/P9.8 的回归门禁）。
把它做成工具，别的 agent 就能**对着真实门禁迭代音色**，而不是凭感觉调参。

## 三、形态与架构

- 主形态：**MCP（Model Context Protocol）over stdio**——现在 LLM 客户端接工具的事实标准，
  Claude Desktop / 各类 agent 框架都能直接挂。
- 次形态：**同一套工具的 HTTP JSON-RPC**（`127.0.0.1` 只回环），给不玩 MCP 的客户端；
  两个入口共用**同一份 tool registry**，不存在两套实现。
- **手写而不引入 `@modelcontextprotocol/sdk`**：MCP 的 stdio 框架是**很小的 JSON-RPC 子集**
  （`initialize` / `tools/list` / `tools/call` + 通知），手写换来的是**零新增运行时依赖**
  （与仓库一贯的依赖极简一致）。理由与做法见 `docs/notes/mcp.md` §一/§四。

```
 ┌───────────────────────────── 外部 agent（LLM） ─────────────────────────────┐
 │  MCP client / HTTP client                                                    │
 └───────────────┬──────────────────────────────────────────────────────────────┘
                 │  tools/call { name, arguments }
 ┌───────────────▼──────────────────────────────────────────────────────────────┐
 │ mcp/server.mjs        手写 JSON-RPC（stdio / 回环 HTTP），只做协议与校验      │
 │ mcp/ui/server.mjs     P13.4 浏览器层入口（同一协议，另一套 registry）         │
 ├──────────────────────────────────────────────────────────────────────────────┤
 │ mcp/tools/*.mjs       14 个离线工具（参数校验 → 调用下层 → 结构化结果）        │
 │ mcp/ui/tools/*.mjs    5 个浏览器工具（Playwright 驱动真实页面）              │
 ├──────────────────────────────────────────────────────────────────────────────┤
 │ scripts/lib/render-core.mjs   在 Node 里起真 wasm 核心（门禁也在用同一份）     │
 │ scripts/lib/audio-ruler.mjs   尺子：FFT、BH-7、Hann Goertzel、±8 bin 地板、   │
 │                               THD、峰值/RMS、最大步进、过采样对照            │
 └──────────────────────────────────────────────────────────────────────────────┘
```

**关键点：不新增音频代码。** 第 4 层的两件事**已经存在**，只是当年长在 `scripts/verify-audio.mjs`
里。P13.1 把它们抽成 `scripts/lib/render-core.mjs` + `scripts/lib/audio-ruler.mjs`，让**门禁与 MCP
共用同一份实现**——否则「工具量出来的数」与「门禁量出来的数」迟早会分叉，那这套接口就没有意义了。
那次抽取的 `verify-audio.mjs` 是 2814 行 → **2294 行**；此后 P14.2 的负载探针又给它加了 53 行，
**今天是 2347 行**（`wc -l scripts/verify-audio.mjs`；抽取提交 `0239b41`，负载探针提交 `1458a8f`）。

## 四、工具契约（19 个，实现后）

命名 `gs1.*`，全部**纯函数式**（给同样的输入，得同样的字节），全部返回**结构化 JSON**
（大对象用文件路径而不是塞进 base64 里）。

**三条通用约定**：
1. **每个数字都带「用的是哪把尺子」**（`ruler`/`window` 字段），否则不同尺子的数字不可比；
2. **`nonFinite` / `allocViolations` 永远在渲染与测量结果里**——零分配是这个引擎的底线，
   agent 改参数时不该能破坏它（`gs1.analyze` 只读磁盘上的 WAV 时 `allocViolations` 为 `null`，
   因为文件里没有引擎可问）；
3. **拒绝是结构化的**：`tools/call` 返回**成功的** JSON-RPC 响应，`result.isError === true`，
   `result.structuredContent` 与 `content[0].text` 是同一个 `{ ok:false, error:{ code, message, … } }`。
   错误码表见 §5.4。

### 4.1 离线层 · 认知类（4）

| 工具 | 输入（类型 / 范围 / 默认） | 返回（要点） | 错误码 |
| :--- | :--- | :--- | :--- |
| `gs1.describe` | — | `name`、`version`、`abi`、`paramCount`、`sampleRate`、`blockSize`、`maxBlockSize`、`maxVoices`、`arena{capacityBytes,freeBytes,allocViolations}`、`sampler{maxBaseSamples,importCapacity,importCodes{ok,short,silent,notFinite,noRoom}}`、`enums{waves,waveNamesZh,filterTypes,lfoWaves,lfoTargets,delaySyncs,fxKinds,fxSlots,fxModSlots,modSources,modDests}`、`presets{count,categories}`、`layer{render,rulers,excludes}` | `E_INTERNAL` |
| `gs1.params.list` | `filter?: string`（≥1 字符，id/key/label 的大小写不敏感子串；省略＝全部） | `{ count, total, params:[{ id, key, nameEn, nameZh, min, max, default, unit, discrete }] }`（`total` 恒 224；`nameZh` 恒 `null`——本仓库不逐个本地化旋钮标签） | `E_INTERNAL` |
| `gs1.presets.list` | — | `{ count, categories, presets:[{ id, name, tag, cat, wave, tags, user, hasLayer, instanceMode }] }`（91 条工厂预设） | `E_INTERNAL` |
| `gs1.songs.list` | — | `{ count, sourceKinds, songs:[{ id, title, titleZh, composer, source:{kind,credit,url?}, bpm, steps }] }`（25 首；`sourceKinds` 是 `{kind: 条数}`） | `E_INTERNAL` |

真跑片段（`gs1.describe` 截断）：

```json
{"name":"GS-1","version":"2.1.1","abi":9,"paramCount":224,"sampleRate":48000,"blockSize":128,
 "maxBlockSize":1024,"maxVoices":32,
 "arena":{"capacityBytes":12582912,"freeBytes":12582912,"allocViolations":0},
 "sampler":{"maxBaseSamples":192000,"importCapacity":192000,
            "importCodes":{"ok":0,"short":1,"silent":2,"notFinite":3,"noRoom":4}},
 "presets":{"count":91,
            "categories":["ALL","LEAD","BASS","PAD","PLUCK","KEYS","FX","BASIC","USER"]}}
```

（上面省了 `enums` 的其余枚举与 `layer` 字段；`layer` 是三个字符串，说明这一层的数字来自
`scripts/lib/render-core.mjs` 里的 wasm 核、尺子来自 `scripts/lib/audio-ruler.mjs`，以及它**不覆盖**
AudioWorklet / AudioParam 自动化 / Web Audio 图。）

`gs1.params.list { filter:"filterCutoff" }`：

```json
{"count":1,"total":224,
 "params":[{"id":14,"key":"filterCutoff","nameEn":"CUTOFF","nameZh":null,
            "min":20,"max":20000,"default":9000,"unit":"kHz","discrete":false}]}
```

### 4.2 离线层 · 操作类（7）

`gs1.patch.get` / `gs1.patch.set` / `gs1.render` / `gs1.analyze` / `gs1.gate` 都能拿
`patch`（分享码字符串**或**解码后的 `{params, routes, params2?, instanceMode?, splitNote?}` 对象）
或 `presetId`；**都不给**时用**会话当前 patch**（没设过则是默认 patch）。`patch` 与分享码、
预设**是同一格式**：`gs1.patch.get` 给的 `shareCode` 就是分享链接里那一串，`src/state/share.ts`
自己的 `encodePatch`/`decodePatch` 产生与读取，`mcp/` 里没有第二套。

| 工具 | 输入（类型 / 范围 / 默认） | 返回（要点） | 错误码 |
| :--- | :--- | :--- | :--- |
| `gs1.patch.get` | `{ presetId?: string(≥1), patch?: string \| object }`；给 `presetId` 时它优先，两个都不给＝**会话当前 patch** | `format:'gs1-share-code'`、`abi`、`source`（`preset`\|`session`\|`default`\|`shareCode`\|`object`）、`presetId`、`name`、`tag`、`cat`、`wave`、`shareCode`、`instanceMode`、`splitNote`、`routeCount`、`paramCount`、`patch{params,params2,instanceMode,splitNote,routes}` | `E_SCHEMA`、`E_PATCH` |
| `gs1.patch.set` | `{ patch? \| presetId? \| params?, partial?: boolean }`——三者**恰好一个**；`params` 是 `{ key\|id: value }`，值会按浏览器服务的量程**夹取**并报告 | `ok`、`applied`（`params`\|`presetId`\|`patch`）、`partial`、`source`、`presetId`、`shareCode`、`summary{presetId,instanceMode,splitNote,routeCount,paramCount,shareCode}`、`clamped[{key,asked,got,reason}]`、`clampedCount`、`patch` | `E_SCHEMA`、`E_PATCH`、`E_PARAM` |
| `gs1.patch.random` | `{ seed: integer 0..4294967295 }`（**必填**） | 同 `patch.set` 的载荷，外加 `seed` 与 `randomised:[id…]`（本轮被随机化的参数 id；`applied:'random'`） | `E_SCHEMA`（缺 seed / 非整数）、`E_RANGE`（负数） |
| `gs1.preset.apply` | `{ presetId? \| file? }`——**恰好一个**；`file` 是仓库内的 `.gs1.json` | 同 `patch.set` 的结果（`applied:'preset.apply'`）；`file` 来源再加 `name`、`file` | `E_SCHEMA`、`E_PATCH`、`E_PATH` |
| `gs1.preset.save` | `{ name?: string, outPath?: string }`（默认名 `GS1 Patch`；`outPath` 必须在 `.tmp/mcp/` 内） | `ok`、`format:'gs1-preset'`、`savePath`、`name`、`byteLength`、`sha256`、`paramCount`、`routeCount`、`layered`、`source`（`session`\|`default`）、`note` | `E_PATH`、`E_SCHEMA` |
| `gs1.sample.import` | `{ path? \| wavBase64?, name?: string }`——**恰好一个**来源；解码用 app 自己的 `src/audio/wavefile.ts` | `ok`、`code`、`note`、`name`、`source`、`samples`、`sampleRate`、`seconds`、`capacity`、`poolBytes`（本次新占的 arena 字节）、`arenaFreeBytes`、`installed` | `E_SCHEMA`、`E_PATH`、`E_WAV`、`E_RANGE`（超 `MAX_BASE_SAMPLES`，**拒绝不截断**）、`E_IMPORT` |
| `gs1.wavetable.import` | `{ path? \| cycleBase64?, name?: string }`——**恰好一个**来源；周期由 app 自己的自相关分析找出 | `ok`、`code`、`note`、`name`、`source`、`samples`（恒 2048）、`capacity`、`seconds`、`installed` | `E_SCHEMA`、`E_PATH`、`E_WAV`、`E_RANGE`、`E_IMPORT` |

**夹取必须报告，不许静默**——`clamped` 里每一条是 `{ key, asked, got, reason }`，`reason` 取
`max`/`min`/`discrete`。真跑：

```json
{"tool":"gs1.patch.set","args":{"params":{"filterCutoff":99999,"osc1Wave":1.4}}}
```
```json
{"ok":true,"applied":"params","partial":false,"source":"session","presetId":null,
 "clamped":[{"key":"filterCutoff","asked":99999,"got":20000,"reason":"max"},
            {"key":"osc1Wave","asked":1.4,"got":1,"reason":"discrete"}],
 "clampedCount":2,"shareCode":"gs1.1.eyJzIjo0LCJ2IjpbMC43NSwxLDEsMCw3LD…",
 "summary":{"presetId":null,"instanceMode":"single","splitNote":60,"routeCount":4,
            "paramCount":224,"shareCode":"gs1.1.eyJzIjo0LCJ2IjpbMC43NSwxLDEsMCw3LD…"}}
```

`gs1.sample.import`（480 样本 @48 kHz）——`poolBytes` 是**这次调用向 arena 新要到的字节数**；
同一个引擎里第二次导入同样长度的采样，pool 被复用，`poolBytes` 就是 `0`（如实报告，不是没导入）：

```json
{"ok":true,"code":0,"note":"ok","name":"tone.wav","source":"wavBase64","samples":480,
 "sampleRate":48000,"seconds":0.01,"capacity":192000,"poolBytes":3856,"arenaFreeBytes":11811040,
 "installed":"session sample — replayed into every later render/gate"}
```

**会话状态规则**（状态一份，放在 `ctx.session`）：

| 工具 | 读 | 写 |
| :--- | :--- | :--- |
| `gs1.describe` / `params.list` / `presets.list` / `songs.list` | app 数据 | — |
| `gs1.patch.get`（无 `patch`/`presetId`） | `session.patch`（空则默认 patch） | — |
| `gs1.patch.set` / `patch.random` / `preset.apply` | 会话（`partial:true` 时） | **`session.patch`** |
| `gs1.sample.import` | — | **`session.sample`** |
| `gs1.wavetable.import` | — | **`session.wavetable`** |
| `gs1.render` / `gs1.analyze {render}` / `gs1.gate` | `session.patch`（仅当调用者没给 `patch`/`presetId`）+ `session.sample` / `session.wavetable` | — |
| `gs1.preset.save` | `session.patch`（空则默认 patch） | 只写 `.tmp/mcp/` 的文件 |

**引擎不跨调用保留**：每次 `render`/`gate` 都起一个**全新的 wasm 实例**（`phase_seed = 0`，
这是逐字节确定性的来源），随后 `installInstrument()` 把 `session.sample` / `session.wavetable`
**重放进新实例**——和浏览器 reload 后装用户采样做的是同一件事。

### 4.3 离线层 · 渲染与测量类（3）

| 工具 | 输入（类型 / 范围 / 默认） | 返回（要点） | 错误码 |
| :--- | :--- | :--- | :--- |
| `gs1.render` | `{ patch? \| presetId?, notes(**必填**, 1..512 条), seconds?(0.05..30，默认 2), oversample?(0\|1 或 bool，默认 0), sampleRate?(枚举 `[48000]`，默认 48000), seed?(0..512，默认 0), outPath?(必须在 `.tmp/mcp/` 内) }`；`notes[i] = { note(0..127，必填), velocity?(0..1，默认 1), start?(秒，默认 0), duration?(秒，默认到渲染结束) }`，按 128 样本块边界放置 | `ok`、`wavPath`、`sha256`（WAV 字节）、`byteLength`、`samples`、`channels:2`、`sampleRate`、`seconds`、`blocks`、`seed`、`oversample`、`time{ruler:'time-domain-float',peak,rms,maxStep}`、`nonFinite`、`allocViolations`、`patch{source,presetId,instanceMode,splitNote,routeCount,paramCount,shareCode,layersRendered}` | `E_SCHEMA`、`E_RANGE`、`E_SAMPLE_RATE`、`E_PATCH`、`E_PATH` |
| `gs1.analyze` | `{ wavPath? \| render? }`——**恰好一个**（`render` 与 `gs1.render` 同 spec，在内存里量、不落盘）；`f0?(1..24000)` 或 `note?(0..127)`（WAV 来源**必须**给其一）；`bins?(0..64，默认 8)`；`probes?(1..16 个 1..24000 的频率，默认门禁的 `[9000,9200,9500]`)` | `ok`、`source`、`sampleRate`、`seconds`、`blocks`、`frames`、`time{ruler,peak,rms,maxStep}`、`aliasing{ruler:'bh7',window:'blackman-harris-7',bins,perNote[{note,f0,floorDb}],worstDb}`、`secondRuler{ruler:'hann-goertzel',window:'hann',f0,fundamental,probes[{frequency,db}],worstDb}`、`thd{ruler,window,maxHarmonic:12,percent}`、`interHarmonic{ruler,window,limitHz:20000,db}`、`rulers{bh7,second}`、`nonFinite`、`allocViolations`（WAV 来源为 `null`） | `E_SCHEMA`、`E_WAV`、`E_SAMPLE_RATE`、`E_RANGE`、`E_PATCH` |
| `gs1.gate` | `{ patch? \| presetId?, notes(**必填**, 1..512), oversample?, ruler?('bh7'\|'hann'\|'both'，默认 'bh7'), harmonics?(0..64，默认 8), thresholdDb?(-200..0，默认 -60), probes?(1..16 个，默认 `[9000,9200,9500]`) }`；**没有 `seconds`/`seed`**——它自己跑门禁那套 settled 4 秒单音 fixture | `ok`、`ruler`、`bins`、`thresholdDb`、`criteria`、`isGateRuler:true`、`perNote[{note,f0,bh7{ruler,window,bins,floorDb,passed}?,hann{ruler,window,probes,worstDb,passed}?,passed}]`、`worstBh7Db`、`worstHannDb`、`passed`、`nonFinite`、`allocViolations` | `E_SCHEMA`、`E_RANGE`、`E_PATCH` |

`gs1.render { notes:[{note:60,velocity:0.9}], seconds:1, seed:7 }`（真跑，节选）：

```json
{"ok":true,"wavPath":".tmp/mcp/59c16bcb6e59ee00.wav",
 "sha256":"59c16bcb6e59ee00f293c1a41cb48e29b23475d03c651bbbccd69548715f12dd",
 "byteLength":192044,"samples":48000,"channels":2,"sampleRate":48000,"seconds":1,"blocks":375,
 "seed":7,"oversample":0,
 "time":{"ruler":"time-domain-float","peak":0.05958358570933342,
         "rms":0.021532217840107986,"maxStep":0.05809706263244152},
 "nonFinite":0,"allocViolations":0,
 "patch":{"source":"default","presetId":null,"instanceMode":"single","splitNote":null,
          "routeCount":4,"paramCount":224,"shareCode":"gs1.1.eyJzIjo0LCJ2IjpbMC…",
          "layersRendered":"single"}}
```

`gs1.gate`（用门禁自己的 quiet 差分音色，C4=220 Hz 与 A5=880 Hz；节选，`bh7`/`hann` 是**嵌套对象**，
每个都带自己的尺子名）：

```json
{"ok":true,"ruler":"both","bins":8,"thresholdDb":-60,"isGateRuler":true,
 "perNote":[{"note":57,"f0":220,
             "bh7":{"ruler":"bh7","window":"blackman-harris-7","bins":8,"floorDb":-115.95862439046535,"passed":true},
             "hann":{"ruler":"hann-goertzel","window":"hann","worstDb":-161.0251694935408,"passed":true},
             "passed":true},
            {"note":81,"f0":880,
             "bh7":{"ruler":"bh7","window":"blackman-harris-7","bins":8,"floorDb":-113.87405471234766,"passed":true},
             "hann":{"ruler":"hann-goertzel","window":"hann","worstDb":-153.51766851891068,"passed":true},
             "passed":true}],
 "worstBh7Db":-113.87405471234766,"worstHannDb":-153.51766851891068,"passed":true,
 "nonFinite":0,"allocViolations":0}
```

### 4.4 浏览器层（5）：要 `dist/`、要 Chromium、只用 4796

这一层单独一个进程/子命令，因为浏览器比 wasm 重得多，而且它需要 `dist/`——不该让「只想要个 patch」
的 agent 付这个代价。`npm run mcp` **不加载**这些文件（`scripts/verify-llm-docs.mjs` 断言离线
registry 里没有 `gs1.ui.*`）。

| 工具 | 输入（类型 / 范围 / 默认） | 返回（要点） | 错误码 |
| :--- | :--- | :--- | :--- |
| `gs1.ui.open` | `{ path?(默认 `/`), url?(必须**本进程自己**的 `http://127.0.0.1:4796` origin), viewport?{width(320..3840，默认 1440), height(240..2400，默认 900)}, waitForMs?(100..120000，默认 20000) }` | `ok`、`url`、`requestedUrl`、`title`、`status`、`viewport`、`consoleErrors`、`consoleMessages`、`mounted`、`gateCleared`、`ready`、`startedInMs`、`navigationMs`、`bootMs`、`distDir`、`previewPort`、`baseline{device,width,height,note,count,names}`、`layer:'browser'`、`note` | `E_UI_URL`、`E_SCHEMA`、`E_PATH`（没有 `dist/index.html`）、`E_UI_BROWSER`、`E_RANGE` |
| `gs1.ui.click` | `{ selector(**必填**), force?(默认 false), timeoutMs?(1..120000，默认 5000), position?{x,y} }` | `ok`、`selector`、`force`、`hitTested`（`!force`）、`clicked{x,y}`、`box`、`element`、`elapsedMs`、`implementation:'e2e/interact.mjs (shared with e2e/fixtures.ts)'` | `E_UI_SESSION`、`E_UI_TIMEOUT`、`E_SCHEMA` |
| `gs1.ui.text` | `{ selector?(默认整页 body), all?, attribute?, maxLength?(1..20000，默认 20000) }` | `all:true` → `{ ok, selector, count, returned, attribute, values }`（最多 200 条）；否则 `{ ok, selector, count, attribute, text, length, truncated }`；**空匹配不是错误**（`count:0`） | `E_UI_SESSION`、`E_SCHEMA` |
| `gs1.ui.screenshot` | `{ name?(默认 `ui-page-N.png`), fullPage?, selector?, animations?('disabled'\|'allow'，默认 'disabled') }` | `ok`、`screenshotPath`、`width`、`height`（从 PNG 头**读回**，不是请求值）、`bytes`、`sha256`、`fullPage`、`selector`、`element`、`viewport`、`consoleErrors`、`baseline{device,width,height,names,count,matches}`；只写 `.tmp/mcp/` | `E_UI_SESSION`、`E_PATH`、`E_SCHEMA`、`E_UI_TIMEOUT`、`E_UI_BROWSER` |
| `gs1.ui.gate` | `{ spec(**必填**:'visual'\|'performance'\|'param-range'), project?(枚举 `['chromium']`，默认 chromium), timeoutMs?(1000..900000，默认 300000) }` | `ok`、`spec`、`specFile`、`project`、`command`、`port`、`url`、`exitCode`、`elapsedMs`、`passed`、`failed`、`skipped`、`tests[{title,project,status,durationMs,error}]`、`logPath`、`reportPath`、`logTail`、`note`、`reportParsed`；**白名单**，不接受 spec 路径/其它 project | `E_UI_SPEC`、`E_SCHEMA`、`E_UI_BROWSER` |

**边界**（细节见 `docs/notes/mcp.md` §9.2）：
- **只连本站**：外部 origin、`//host/path`、非字符串一律 `E_UI_URL`，而且**在起 server / 起浏览器之前**就拒绝；
- **只写 `.tmp/mcp/`**：`gs1.ui.screenshot` 的文件名解析后必须仍是该目录下的普通文件名
  （`../x`、`sub/x`、`.x` 都是 `E_PATH`）；
- **只用自己的端口**：预览默认 **4796**（`GS1_MCP_UI_PORT` 可改），**`4783` 直接拒绝**——那是
  `playwright.config.ts` 的 E2E 端口；`gs1.ui.gate` 跑的 Playwright 也把 `GS1_E2E_PORT`
  强制成这个端口，两层不会互相抢。**绝不占用 4783。**
- **单一实现**：`gs1.ui.click` 调用的就是 `e2e/interact.mjs`——从 `e2e/fixtures.ts` 抽出来的那份
  帧无关交互；`mcp/` 里**没有**第二份命中/滚动逻辑。抽取时修掉了 `fixtures.ts` 里一个真缺陷：
  `ClickOptions.force` 从来没被读，`click({force:true})` 会死循环到超时。

### 4.5 实战范例：把 `crushlead` 的 ≥1 kHz 非谐波地板降 60.86 dB（真跑，2026-09-15）

这一节里的每个数字都是一次真实的 `tools/call` 结果（Node 里的 wasm 核，不是浏览器；浏览器只用于最后一步的「页面里也真的生效」）。**完整调用序列在 §4.5.5**，可以照着重跑。

#### 4.5.1 先测量：91 条工厂预设，谁的高频非谐波地板最差

用 `gs1.presets.list` 拿到 91 条工厂预设，然后**逐条** `gs1.gate`（`ruler:'both'`、`thresholdDb:-60`、`probes:[9000,9200,9500]`——门禁自己的三个 C7 探针，都在 1 kHz 以上）。全部 91 条都测了（每条约 0.3–0.7 s，整轮约 50 s），没有抽样：

```
note 96 (C7, f0 2093.0 Hz), probes [9000,9200,9500] — 91 presets
worst 15 by the Hann >=1 kHz floor:
  hann    30.2  bh7    -0.0  whiteriser      FX/TRANSITION w=noise
  hann    27.6  bh7     0.0  sub             BASS/TECHNO w=pulse
  hann    27.1  bh7    -0.0  reesegrowl      BASS/DnB w=saw
  hann    26.8  bh7    -0.0  sync            LEAD/ELECTRO w=pulse
  hann    22.9  bh7    -0.0  gate            LEAD/TRANCE w=saw
  hann    22.5  bh7    -0.0  hoover          LEAD/HARDCORE w=saw
  hann    19.4  bh7    -0.0  driftpad        PAD/AMBIENT w=noise
  hann    11.5  bh7    -0.0  wind            FX/SFX w=noise
  hann     6.3  bh7    -0.0  semnotch        FX/EXPERIMENTAL w=saw
  hann     5.8  bh7    -0.0  riser           FX/TRANSITION w=noise
  hann     5.3  bh7    -0.0  drift           PAD/AMBIENT w=noise
  hann     5.1  bh7    -0.0  semparabass     BASS/EXPERIMENTAL w=saw
  hann     1.2  bh7    -0.0  fmbite          BASS/DUBSTEP w=saw
  hann     1.0  bh7     0.0  sub808          BASS/TRAP w=sine
  hann     1.0  bh7     0.0  phonk           FX/PHONK w=square
cleanest: init -168.8, neon -181.9 dB
passed (-60 dB, both rulers): 1/91
```

**为什么不用这张表直接选「最差的那条」**：表里 `hann ≥ 0 dB` 的那些**不是混叠**，是「探针频率上比 `f0` 处的能量还高」——`whiteriser`/`wind`/`driftpad` 是噪声源（宽带，本来就该是 0 dB），`sub`/`reesegrowl`/`sync`/`hoover`/`gate` 是**失谐/分层**音色：OSC2 打开 + OSC1 detune 非零时实际基频不在 2093 Hz（实测 2101.5 Hz，+7 ct），Hann 比值拿一个几乎空的 bin 当分母，于是每个探针都读到 0 dB 以上。

同一批预设的第二种测法（`bh7` 全带地板，谐波栅格取**渲染信号自己的基频**）也说明这一点：91 条里 64 条的基频峰在 25 ct 以内，其余 27 条（`acid`/`sub`/`hardbass`/`hoover`/`reese`/`mono-` 系…）的「基频」峰出现在**低一个八度**（-1193 ct，OSC2 在 -12 st）或其它位置。**结论：`gs1.gate` 的尺子对「单振荡器、与音符同调」的 patch 才有意义**，对分层/失谐的预设，`bh7` 与 Hann 分母都会失真——这是这套尺子的适用边界，不是预设的缺陷。

所以范例挑的是**那种仍能被尺子正确测量、且非谐波地板真差**的一类：位压碎（bit-crusher）的宽带混叠。`crushlead`（LEAD/EXPERIMENTAL）就是这一类，它进不了上面那张表是因为它的失谐同样把分母打偏了——**同一份测量换成宽探针（3000/5000/7000/9000/11000/13000/15000 Hz）后，它的地板是 -4.0 dB**，比表里所有「真混叠」候选都高：

```json
{"tool":"gs1.gate","args":{"presetId":"crushlead","notes":[{"note":96}],"ruler":"both","thresholdDb":-60,
  "probes":[3000,5000,7000,9000,11000,13000,15000]}}
```
```json
{"ok":true,"ruler":"both","bins":8,"thresholdDb":-60,"isGateRuler":true,
 "perNote":[{"note":96,"f0":2093.004522404789,
   "bh7":{"ruler":"bh7","window":"blackman-harris-7","bins":8,"floorDb":-0.002458965753592448,"passed":false},
   "hann":{"ruler":"hann-goertzel","window":"hann",
     "probes":[{"frequency":3000,"db":-4.017016537500746},{"frequency":5000,"db":-21.25112498151106},
               {"frequency":7000,"db":-23.977221780786515},{"frequency":9000,"db":-13.058905960073073},
               {"frequency":11000,"db":-27.399125450148347},{"frequency":13000,"db":-28.528260328869777},
               {"frequency":15000,"db":-16.52632304259008}],
     "worstDb":-4.017016537500746,"passed":false},
   "passed":false}],
 "worstBh7Db":-0.002458965753592448,"worstHannDb":-4.017016537500746,"passed":false,
 "nonFinite":0,"allocViolations":0}
```

> 为什么取宽探针作判据：题目要的是「**≥1 kHz** 的非谐波地板」，门禁默认的三个探针（9.0/9.2/9.5 kHz）只采样三个点，而位压碎的混叠是**宽带**的——`crushlead` 在 3 kHz 处最差（-4.0 dB），默认三探针只看到 -13.1 dB。两个数下面都给。

#### 4.5.2 改进前：`analyze` 的结构化 JSON

`gs1.analyze` 的 Hann 尺子是**相对 `f0` 处的 bin 幅度**；`crushlead` 的 OSC1 detune 是 +8 ct（OSC2 在 -12 st），所以判据用的 `f0` 必须是 `2093.0045 × 2^(8/1200) = 2102.6986 Hz`（用音符的 2093.0 Hz 去量，分母几乎为零，整份结果会退化成 0 dB——这一点写进 `docs/notes/mcp.md` 的已知取舍）。

```
gs1.patch.set { presetId: "crushlead" }        → 会话当前 patch
gs1.patch.get {}                                → 下面前后两份分享码的「前」
gs1.render  { patch: <前>, notes:[{note:96,velocity:1}], seconds:4, seed:0 }
gs1.analyze { render: { patch:<前>, notes:[{note:96,velocity:1}], seconds:4, seed:0 }, f0: 2102.6986 }
```

```json
{"ok":true,"source":"render","sampleRate":48000,"seconds":4,"blocks":1500,"frames":192000,
 "time":{"ruler":"time-domain-float","peak":0.025701463222503662,"rms":0.010487039148856495,
         "maxStep":0.037557341158390045},
 "aliasing":{"ruler":"bh7","window":"blackman-harris-7","bins":8,
   "perNote":[{"note":96,"f0":2093.004522404789,"floorDb":-0.01449481805041423}],
   "worstDb":-0.01449481805041423},
 "secondRuler":{"ruler":"hann-goertzel","window":"hann","f0":2102.6986397112883,
   "fundamental":0.008355436333385384,
   "probes":[{"frequency":9000,"db":-57.77160455161302},{"frequency":9200,"db":-57.89927343128503},
             {"frequency":9500,"db":-66.17767929308687}],
   "worstDb":-57.77160455161302},
 "thd":{"ruler":"hann-goertzel","window":"hann","maxHarmonic":12,"percent":26.70803398334714},
 "interHarmonic":{"ruler":"hann-goertzel","window":"hann","limitHz":20000,"db":-59.949273363726405},
 "nonFinite":0,"allocViolations":0}
```

#### 4.5.3 改了什么：一个参数

```json
{"tool":"gs1.patch.set","args":{"params":{"fxCrushBits":4},"partial":true}}
```

`fxCrushBits`（id 153，比特压碎的量化位数）从 **6 → 4**，`partial:true` 叠在会话当前 patch 上，其余 223 个参数与 4 条调制路由**逐位不变**（两份分享码解码后 `v[153]` 是唯一差异：`6 → 4`；`routes` 数组全等）。

为什么是它：位压碎的混叠来自「量化步进的跳变」——跳变越密（位数越高）越接近硬削波，宽带谱越丰富，折叠进 1 kHz 以上的能量越多；降低量化位数把跳变间隔拉大，宽带混叠随之减少（代价是量化噪声本身变大，见 §4.5.6）。

#### 4.5.4 改进后：`analyze` JSON 与 `gate` 的对照

```
gs1.patch.set { params: { fxCrushBits: 4 }, partial: true }
gs1.patch.get {}                                → 「后」分享码（v[153]=4）
gs1.render  { patch: <后>, notes:[{note:96,velocity:1}], seconds:4, seed:0 }
gs1.analyze { render: { patch:<后>, notes:[{note:96,velocity:1}], seconds:4, seed:0 }, f0: 2102.6986 }
```

```json
{"ok":true,"source":"render","sampleRate":48000,"seconds":4,"blocks":1500,"frames":192000,
 "time":{"ruler":"time-domain-float","peak":0.011860109865665436,"rms":0.003954380684900505,
         "maxStep":0.01118595851585269},
 "aliasing":{"ruler":"bh7","window":"blackman-harris-7","bins":8,
   "perNote":[{"note":96,"f0":2093.004522404789,"floorDb":-0.025913230657841894}],
   "worstDb":-0.025913230657841894},
 "secondRuler":{"ruler":"hann-goertzel","window":"hann","f0":2102.6986397112883,
   "fundamental":0.003786203937873979,
   "probes":[{"frequency":9000,"db":-92.35695531375703},{"frequency":9200,"db":-75.2323443428793},
             {"frequency":9500,"db":-83.46309457524893}],
   "worstDb":-75.2323443428793},
 "thd":{"ruler":"hann-goertzel","window":"hann","maxHarmonic":12,"percent":60.36185091590972},
 "interHarmonic":{"ruler":"hann-goertzel","window":"hann","limitHz":20000,"db":-66.02000361857839},
 "nonFinite":0,"allocViolations":0}
```

| 量 | 改进前 | 改进后 | 变化 |
| :--- | ---: | ---: | ---: |
| `gate` Hann 地板，宽探针（≥1 kHz，worst） | **-4.0170 dB** | **-64.8761 dB** | **-60.859 dB** |
| `gate` Hann 地板，默认三探针（9.0/9.2/9.5 kHz） | -13.0589 dB | -67.7049 dB | -54.646 dB |
| `analyze.secondRuler.worstDb`（9.0/9.2/9.5 kHz，对 2102.70 Hz） | -57.7716 dB | -75.2323 dB | -17.461 dB |
| `analyze.interHarmonic` | -59.9493 dB | -66.0199 dB | -6.071 dB |
| `analyze.time.rms` | 0.010487 | 0.003954 | -8.47 dB |
| `nonFinite` / `allocViolations` | 0 / 0 | 0 / 0 | — |

> 上表按 4 位小数取整（`gate` 的两行可与上面 JSON 里的完整数字逐位对上）。`analyze` 的两行在
> 重放时会落在第 5–6 位小数上（例如 `secondRuler.worstDb` = -57.771610 / -75.232346），
> 因为判据 `f0` 在调用里是写成 `2102.6986` 的六位小数——把完整值 `2102.6986397112883` 传进去
> 就逐位一致。

`gate` 的两把尺子里只有 Hann 动了：`bh7` 从 -0.0025 到 -0.0006 dB——这条 patch 有两台相差 12 个半音的振荡器，**任何**单一谐波栅格都漏掉另一台，所以全带 `bh7` 地板在这个 patch 上是「不适用」，不是「证明没问题」。真正能读的判据是 Hann 探针（它只问「这些频率上的能量相对基频有多高」）。

改进后 `gate` 的 `hann.passed` 从 `false` 变 `true`（-64.88 < -60），而整条 `passed` 仍是 `false`——因为 `bh7` 那一半是上面说的不适用。

#### 4.5.5 完整调用序列（可照着重跑）

下面两份分享码就是「前 / 后」的完整 patch（`{params(224), routes(4)}`，`gs1.patch.get` 给的格式）。
**唯一差异是 `v[153]`（`fxCrushBits`）：`6 → 4`**；可以直接把它们当 `patch` 传给 `gs1.render` /
`gs1.gate`，不必先 `patch.set`。

```jsonc
// 1. 会话里装上工厂预设（这一段只是为了拿到「前」的分享码）
{ "tool": "gs1.patch.set", "args": { "presetId": "crushlead" } }
{ "tool": "gs1.patch.get", "args": {} }                     // shareCode = <前>（见下）

// 2. 改前测量（宽探针）
{ "tool": "gs1.gate", "args": { "notes": [{"note": 96}], "ruler": "both", "thresholdDb": -60,
  "probes": [3000,5000,7000,9000,11000,13000,15000] } }      // worstHannDb = -4.017016537500746

// 3. 改前 analyze（把 <前> 原样交给 render.patch）
{ "tool": "gs1.render", "args": { "patch": "<前>", "notes": [{"note":96,"velocity":1}],
  "seconds": 4, "seed": 0 } }                                // wavPath = .tmp/mcp/<sha>.wav
{ "tool": "gs1.analyze", "args": { "render": { "patch": "<前>",
  "notes": [{"note":96,"velocity":1}], "seconds": 4, "seed": 0 }, "f0": 2102.6986 } }
                                                             // secondRuler.worstDb = -57.77160455161302

// 4. 只改一个参数（partial:true 叠在会话当前 patch 上；clamped 为空）
{ "tool": "gs1.patch.set", "args": { "params": { "fxCrushBits": 4 }, "partial": true } }
{ "tool": "gs1.patch.get", "args": {} }                     // shareCode = <后>（v[153]=4）

// 5. 改后测量 + analyze
{ "tool": "gs1.gate", "args": { "notes": [{"note": 96}], "ruler": "both", "thresholdDb": -60,
  "probes": [3000,5000,7000,9000,11000,13000,15000] } }      // worstHannDb = -64.87613597834282
{ "tool": "gs1.analyze", "args": { "render": { "patch": "<后>",
  "notes": [{"note":96,"velocity":1}], "seconds": 4, "seed": 0 }, "f0": 2102.6986 } }
                                                             // secondRuler.worstDb = -75.2323443428793
```

`<前>`（`gs1.patch.set {presetId:"crushlead"}` 之后 `gs1.patch.get {}` 的 `shareCode`，916 字符）：

```
gs1.1.eyJzIjo0LCJ2IjpbMC43NSwxLDIsMCw4LDAuNywwLjUsMSwzLDAsLTksMC4zNSwwLjUsMCw2NTAwLDAuMywwLjMsMC41LDEsMC4wMDMsMC4yMiwwLjcsMC4yNSwxLDAsNC42LDAuMzIsMCwwLDAsMC40NSwwLjI1LDEsMiwwLjM1LDAuMiwwLDEyMCwyLDAsMCwwLDAsMCwwLjUsMC42LDAuNCwwLDAuMywwLjUsMC40LDAsMC40LDAuNiwwLjUsMCwwLjQsMC42LDAuMDEsMC4zLDAuNSwwLjMsMCwxLDAuNSwwLjMsMCwwLjM1LDAuOCwwLjAxMiwxLDAuMzUsMSwwLjM1LDAsMCwwLDAsMC41MjksMCwwLjM1LDAsMSwyLDMsNCw1LDcsMCwwLDAsMCwwLDAsMCwxLDYwLDAsMCwxLDAsMSwyLDMsNCw1LDYsMSwxLDEsMSwxLDEsMCwwLDAsMCwwLDAsMSwxLDEsMSwxLDEsMCwwLDAsMCwwLDEsMSwxLDEsMSwxLDEsMCwwLDAsMCwwLjQsMCwwLjQsMCwwLDAsMCw5MDAwLDAuMjUsMC4xNSwwLjUsMSw2LDgsMC4yNSwwLjc1LDAsMCwyMDAsMCwxMDAwLDAuOSwwLDQwMDAsMSwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDEsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsLTIsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwXSwiciI6W1swLDAsMC44LDFdLFsyLDAsMC41NSwxXSxbMCwxLDAuMTgsMF0sWzMsMCwwLjQsMF1dfQ
```

`<后>`（`gs1.patch.set {params:{fxCrushBits:4}, partial:true}` 之后 `gs1.patch.get {}` 的 `shareCode`）：
与 `<前>` 长度相同（916 字符）、共有前 597 与后 318 个字符，**只有中间一个编码字符不同**——
`…MCwwLjE1LDAuNSwxLDYsOCwwLjI1…`（`…0,0.15,0.5,1,6,8,0.25…`）变成
`…MCwwLjE1LDAuNSwxLDQsOCwwLjI1…`（`…1,4,8,0.25…`），即
`fxCrushOn=1, fxCrushBits=4, fxCrushDown=8, fxCrushAA=0.25`。

`gs1.gate` 不读会话当前 patch 之外的任何状态，`gs1.analyze` 只读它拿到的 buffer：上面每一次调用都自带全部输入，可以任意顺序重放。
（会话那一路也实测过：`patch.set{presetId}` → `gate{}` → `patch.set{params,partial}` → `gate{}` 与直接传分享码的两次数值逐位一致。）

#### 4.5.6 浏览器层证明「页面里也真的生效」

离线数字说完，还要证明**同一个 patch 在真页面里也生效**。用 §4.4 的工具：

```jsonc
{ "tool": "gs1.ui.open",       "args": { "path": "/" } }              // 1440x900, dist/, port 4796
{ "tool": "gs1.ui.click",      "args": { "selector": ".start-btn" } } // 引擎启动（真正的 AudioContext）
{ "tool": "gs1.ui.click",      "args": { "selector": ".tbtn.primary" } }        // 预设库
{ "tool": "gs1.ui.text",       "args": { "selector": ".preset-drawer.open .pcard", "all": true } }  // 91 张卡
{ "tool": "gs1.ui.click",      "args": { "selector": ".preset-drawer.open .pcard >> nth=84" } }     // Crushed Lead
{ "tool": "gs1.ui.text",       "args": { "selector": ".preset-drawer.open .pcard.current" } }
{ "tool": "gs1.ui.text",       "args": { "selector": "[data-module-id=filter]", "maxLength": 400 } }
{ "tool": "gs1.ui.click",      "args": { "selector": ".preset-drawer.open .d-close" } }
{ "tool": "gs1.ui.screenshot", "args": { "name": "ui-smoke.png" } }
```

真跑输出（`npm run ui:smoke`，同一份序列）：

```
  ✓ gs1.ui.open mounted the app — bootMs 4973
  ✓ gs1.ui.open reported console errors — 0 error(s)
  ✓ gs1.ui.open used its own port, never 4783 — port 4796
  ✓ gs1.ui.open is at the visual baseline size — 1440x900 = splash-*-desktop-chromium-linux.png
  ✓ gs1.ui.click clicked the app's start gate
  ✓ the shared implementation is named in the click result
  ✓ the preset drawer opened — Crystal Pluck · 晶体拨弦 FUTURE BASS · PLUCK
  ✓ every factory preset is in the drawer list — 91 cards
  ✓ the factory preset loaded (DOM read-back) — Crushed Lead · 位粉碎主音 EXPERIMENTAL · LEAD
  ✓ the filter readout changed with the patch —
      CUTOFF 9.00 kHz RES 25 % DRIVE 15 %  ->  CUTOFF 6.50 kHz RES 30 % DRIVE 30 %
  ✓ gs1.ui.screenshot wrote a real PNG — .tmp/mcp/ui-smoke.png
  ✓ the screenshot is 1440x900
  ✓ the screenshot is the baseline size — 24 baselines
```

**截图尺寸对照**：`gs1.ui.screenshot` 写出的 PNG 宽高是**从 PNG 头读回来**的（不是请求值）：

| | 宽 × 高 | bytes | sha256 |
| :--- | :--- | ---: | :--- |
| `gs1.ui.screenshot {name:"ui-smoke.png"}` | **1440 × 900** | 273660 | `1647bd0217651bc12306fd2893b2dbb2d6179ab7c5bd8b6252eac5f1fb3e3f2e` |
| `e2e/visual.spec.ts-snapshots/splash-dark-desktop-chromium-linux.png`（基线） | **1440 × 900** | — | — |
| `e2e/visual.spec.ts-snapshots/splash-dark-phone-chromium-linux.png`（手机基线） | 390 × 844 | — | — |

`gs1.ui.open` 的默认视口就是 `e2e/visual.spec.ts` 的 desktop `test.use({viewport:{width:1440,height:900}})`、`deviceScaleFactor:1`，截图用 `scale:'css'`（与视觉基线同一个 `SHOT` 配置），所以**默认全视口截图与 24 张 desktop 基线同尺寸**（快照目录里 desktop/phone 各 24 张、共 48 张）；结果里的 `baseline.matches === true` 就是这个断言，`ui:smoke` 里也有一条 check。

> 诚实说明：尺寸一致，**像素不保证一致**。视觉基线是**启动门出现时**的截图，`ui.open` 拿到的是「外壳已挂载、启动门还在」的同一状态（`gateCleared:false`），但基线本身的容差（1 % 像素、5 % 颜色距离）和字体光栅是 `e2e/visual.spec.ts` 自己的事；`gs1.ui.gate {spec:"visual"}` 才是跑那套比对的地方。**本层只断言尺寸**：`gs1.ui.open`（默认，什么都不点）截的确实是启动门那一屏，但「像素相同」这句话留给视觉套件说。

#### 4.5.7 这个范例没做到的部分

- `bh7` 全带地板（跨谐波栅格的「总」非谐波能量）**没有**改善：-0.0025 → -0.0006 dB。原因是 `crushlead` 的 OSC2 在 -12 st、OSC1 detune +8 ct，两台振荡器的谐波不在同一栅格上，`bh7` 在这个 patch 上量的是「分层」而不是「混叠」。要一个 `bh7` 也干净的范例，得挑单振荡器、与音符同调的 patch——那类的 `bh7` 地板本来就在 -100 dB 上下，没有 20 dB 可改。
- 这个改动**换来了量化噪声**：`analyze.thd` 从 26.7 % 升到 60.4 %（4 bit 的量化台阶）。任务是「把 ≥1 kHz 非谐波地板降 20 dB」，做到了；但这不是一个可以无脑套用的音色修改，`docs/notes/mcp.md` 的取舍一节也这么写。
- 低音区（note 72/84）这条改动**不稳定**：宽探针下 note 72 变差 3.7 dB、note 84 变好 7.4 dB（探针与基频的相对位置随音高变），稳定的大幅改善只出现在 C7 以上。这条结论也是真跑出来的，没有藏。

## 五、限制、拒绝与边界

### 5.1 数值上限（全部来自代码常量，`scripts/verify-llm-docs.mjs` 会核对这份文档）

| 量 | 上限 / 取值 | 违反时 |
| :--- | :--- | :--- |
| 渲染长度 | `0.05 ≤ seconds ≤ 30` | `E_RANGE`：`{ path:"$.seconds", maximum:30, value }`（下限给 `minimum`） |
| 音符条数 | `notes ≤ 512`（至少 1 条） | `E_RANGE`：`{ path:"$.notes", maximum:512, length }`；空/非数组是 `E_SCHEMA`：`{ path:"$.notes", expected:["array"], got }` |
| `gs1.render` 的相位种子 | `seed ≤ 512`（0..512） | `E_RANGE`：`{ path:"$.seed", maximum:512, value }` |
| `gs1.patch.random` 的种子 | `0..4294967295`（u32），**必填** | `E_SCHEMA`（缺/非整数）、`E_RANGE`（负） |
| 采样率 | 只有 **48000**（尺子校准在这里） | `E_SAMPLE_RATE`（工具路径）/ `E_SCHEMA`：`{ path:"$.sampleRate", enum:[48000] }` |
| 单个音符 | `note ∈ 0..127` | `E_RANGE`：`{ path:"$.notes[i].note", minimum:0, maximum:127, value }` |
| 力度 / 起点 / 时长 | `velocity ∈ 0..1`、`start ≥ 0`、时长必须落在渲染内 | `E_RANGE`：`path`/`minimum`/`maximum`（schema 能表达的）或 `field`/`value`/`seconds`（跨字段的 `start`/`duration`） |
| BH-7 排除半宽 / Hann 探针 | `bins`/`harmonics ≤ 64`；`probes` 1..16 个、每个 1..24000 Hz | `E_RANGE`：`{ path, maximum }` / `E_SCHEMA`：`{ path, expected }` |
| 导入采样 | `MAX_BASE_SAMPLES = 192000`（4 秒 @48 kHz）；超长**拒绝不截断** | `E_RANGE`：`{ field:"samples", value, max:192000, sampleRate, hint }` |
| arena | 12 MiB（`12582912` 字节） | 采样导入的 `E_IMPORT` + `importCode:4`（见 §5.6） |
| 面板文本 | `gs1.ui.text` 单次最多返回 200 条匹配、每条截到 `maxLength`（默认 20000） | 结果里的 `truncated` |

> **`E_RANGE` 有两种形状，按谁先拒它区分**：
> 1. **schema 层**（`tools/list` 公布的那份 `inputSchema`，服务器真的会走它）——能表达的越界
>    在这里就被拒，形状是 `{ code:"E_RANGE", message, path:"$.字段", minimum?, maximum?, length?, value? }`；
>    真跑：`{notes:[{note:300}]}` → `{"code":"E_RANGE","message":"$.notes[0].note: 300 is above the maximum 127","path":"$.notes[0].note","maximum":127,"value":300}`。
> 2. **handler 层**——schema 表达不了的约束（`start` 超出 `seconds`、`duration` 越过渲染末尾、
>    导入容量、解码）才走到它，形状是 `{ code:"E_RANGE", message, field, value, min?, max?, seconds? }`；
>    真跑：`{notes:[{note:60,start:5}],seconds:1}` → `{"code":"E_RANGE","message":"notes[0].start must be within [0, seconds)","field":"notes[0].start","value":5,"seconds":1}`。
>
> 想只认一种的调用者请分支 **`code`**；想给用户看原因的，两种里的 `message` 都是给人读的。

### 5.2 写入与读取边界

- **只写 `.tmp/mcp/`**。`outPath`（render/save）与 `name`（screenshot）解析后必须仍在该目录内，
  否则 `E_PATH`；越界**拒绝，不夹取**。读取只允许仓库内的路径（`resolveReadPath`）。
- **不碰 `src/`、不碰 `localStorage`、不碰 `release/`、永不部署**。
- 每次 `tools/call` 追加一行 `{ seq, tool, argsDigest, ok, code }` 到 `.tmp/mcp/calls.jsonl`
  （默认开，`--no-log` / `GS1_MCP_LOG=0` 可关）；**没有时间戳**，是序号 + 参数 sha256，日志本身也是确定的。
  `seq` 是**每个进程**从 1 开始的计数：多个进程共用同一个 `.tmp/mcp/calls.jsonl` 时序号会重复，
  它不是全局唯一 id（要唯一就用 `argsDigest` 或自己配对）。

### 5.3 网络

- 只绑 `127.0.0.1`（离线层 `--http` 默认 `3939`；浏览器层预览默认 `4796`）。
- 浏览器层**只连本进程自己那个预览**，外部 origin 一律 `E_UI_URL`；也**绝不占用 4783**
  （`playwright.config.ts` 的 E2E 端口，代码里结构化拒绝）。
- 不发起任何出站请求；HTTP body 超过 8 MiB 直接断开。

### 5.4 错误码全表（与 `mcp/lib/errors.mjs` 一一对应，门禁双向核对）

| 码 | 含义 | 典型触发 / 附带字段 |
| :--- | :--- | :--- |
| `E_SCHEMA` | 必填字段缺失、JSON 类型不对、给了多余字段、枚举不匹配 | 缺 `notes`；`patch.set` 同时给两个来源；`songs.list {filter}`。schema 层带 `path`，多数还带 `expected`/`got` 或 `field`；handler 层（如 `patch.set` 的来源互斥）带 `given`/`field` |
| `E_RANGE` | 数字/长度越界 | `seconds:999`；`notes` 513 条；采样 200000 个样点。**两种形状**见上表下的说明 |
| `E_PATCH` | patch 既不是可解码的分享码，也不是已知预设 id | `presetId:"nope"`；坏分享码；`.gs1song` 当补丁。带 `presetId`/`file`/`hint`/`prefix` |
| `E_PARAM` | 未知参数 key/id，或值不是有限数 | `params:{nonsenseKey:1}`；`filterCutoff:"loud"`。带 `field`（如 `params.nonsenseKey`）与 `hint` |
| `E_PATH` | 路径逃出允许的根（写 `.tmp/mcp/`、读仓库根） | `outPath:"../x"`；`sample.import {path:"../etc/passwd"}`。带 `field`、`requested`、`allowedRoot` |
| `E_SAMPLE_RATE` | 渲染/分析不是 48 kHz | 分析一个 44.1 kHz 的 WAV。带 `wavPath`/`field`/`value`/`allowed` |
| `E_WAV` | WAV 找不到或解不开（RIFF/WAVE PCM） | `wavPath` 不存在；非 RIFF 的 base64。带 `wavPath`/`note:"decode"`/`source:"decoder"` |
| `E_TOOL` | 未知工具名（JSON-RPC 层是 `-32602`，`data.code` 是它，并列出可用工具） | `tools/call {name:"不存在的名字"}` |
| `E_IMPORT` | P9.8 导入拒绝（`short`=1 / `silent`=2 / `notFinite`=3 / `noRoom`=4），原样透传在 `importCode` | 导入静音 WAV；采样装不下。带 `note`、`importCode`、`source` |
| `E_UI_URL` | 浏览器层：URL 不是本进程自己的回环预览 | `url:"https://example.com"`；`path:"//host/x"`。带 `url`/`path`/`allowedOrigin` |
| `E_UI_SESSION` | 需要页面却没有开（或页面已关） | 没 `gs1.ui.open` 就 `gs1.ui.click`。带 `hint` |
| `E_UI_BROWSER` | Chromium 缺失/起不来、截图不是 PNG | 未 `npx playwright install chromium`。带 `hint` |
| `E_UI_SPEC` | `gs1.ui.gate` 的 spec 不在白名单，或 project 不是 chromium | `spec:"../../evil.spec.ts"`。带 `field`、`spec`/`project`、`allowed` |
| `E_UI_TIMEOUT` | 元素在 deadline 前没有变成可点/可见 | 启动门还在时点工具栏（模态遮挡）。带 `field`、`selector` |
| `E_INTERNAL` | 兜底：工具抛了非结构化异常 | 理论上不该出现；出现即 bug |

**协议层错误**（请求本身坏了）走 JSON-RPC `error` 帧，不是上面的码：非法 JSON `-32700`、
不是 JSON-RPC 2.0 `-32600`、未知方法 `-32601`、未知工具 `-32602`（其 `data.code` 才是 `E_TOOL`）。

### 5.5 尺子的适用边界（`gs1.analyze` 与 `gs1.gate`）

- **`analyze` 的 BH-7 / Hann 是对「你给的那段音频」量的**，包含调制与混响的能量；只有
  「单音、无调制、无混响」时才等同于混叠。要门禁口径的振荡器地板，用 `gs1.gate`（它走门禁的
  settled 4 秒 fixture）。
- **Hann 比值以 `f0` 处的 bin 为分母**。patch 的振荡器若偏离音符（OSC1 detune 或 OSC2 在别的
  音程），必须把**实际基频**传进 `f0`，否则分母近乎为零、整份结果退化成 0 dB 附近。
  §4.5.2 的 `crushlead` 就是这么做的：`f0` 是 `2102.6986` 而不是 `2093.0`。
- **`gs1.gate` 的 `bh7` 全带地板对分层/失谐 patch 不适用**（两台振荡器的谐波不在同一栅格上，
  读数里混进了「分层」）；这类 patch 要读 Hann 探针。`gs1.render` 只渲染 instance A
  （分层 patch 的 `patch.layersRendered` 会写 `instance A only`）。
- **所有数字都是 Node 里的 wasm 核测出来的**：没有 AudioWorklet、没有 AudioParam 自动化、
  没有 Web Audio 图。浏览器层只证明「页面起来、控件响应、DOM 反映出 patch、截图对得上尺寸」，
  它**看不到音频**（`gs1.describe` 的 `layer` 字段把这件事写进结果里）。

### 5.6 `noRoom`（P9.8 返回码 4）的实际可达性

工具把 core 的 `{0,1,2,3,4}` 原样透传（`error.importCode`、`error.note`），但**本仓库 12 MiB 的
arena 到不了 `noRoom`**：Rust 自己的测试 `the_longest_mipmap_fits_the_arena`
（`crates/synth-core/src/dsp/sampler.rs`）断言 4 秒采样的 mipmap 只要不到一半 arena，`mcp/lib/import.mjs`
的注释记录的直探针（先装满 98304 样本的 IR，再导入 4 秒采样）也还剩 ~7.9 MB。所以 `noRoom` 是
**防御路径**，P9.8 当年是靠把 `ARENA_SIZE` 临时改成 5 MiB 验证的；测试因此只替换**那一次决定
判定的 core 调用**，其余（解码、容量检查、staging、arena 计量、错误形状）全是真的。
**不要指望用超大文件换到 `noRoom`——超长会先撞 `E_RANGE`。**

## 六、客户端怎么接

### 6.1 Claude Desktop / 通用 MCP 客户端（stdio）

`claude_desktop_config.json`（`cwd` 换成你自己的 checkout 路径）：

```json
{ "mcpServers": { "gs1": { "command": "npm", "args": ["run", "mcp", "--silent"],
  "cwd": "/home/crow/music/synth" } } }
```

不想经过 npm 就直接跑入口（等价，且 `stdout` 干净）：

```json
{ "mcpServers": { "gs1": { "command": "node", "args": ["mcp/server.mjs"],
  "cwd": "/home/crow/music/synth" } } }
```

浏览器层同理，把命令换成 `npm run mcp:ui --silent`（或 `node mcp/ui/server.mjs`），并先完成
`npm run build` + `npx playwright install chromium`。协议方法是 `initialize` / `tools/list` /
`tools/call` / `ping`（通知不回帧）；stdout 是协议通道，诊断走 stderr。

### 6.2 不玩 MCP：回环 HTTP

```bash
npm run mcp -- --http --port 3939
curl -s http://127.0.0.1:3939/            # GET 会列出工具名
curl -s http://127.0.0.1:3939/ -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

同一个 registry、同一份实现；`POST /` 收 JSON-RPC 2.0 的 `initialize`/`tools/list`/`tools/call`，
也接受 batch 数组。

### 6.3 一份可照着敲的最小会话（真跑）

stdio 是**换行分隔的 JSON-RPC**（一行一条，无 `Content-Length`）。把下面五行按顺序写进
`node mcp/server.mjs` 的 stdin，就能从零拿到一个 WAV 和一个数字：

```jsonc
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"gs1.presets.list","arguments":{}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"gs1.render","arguments":{"presetId":"pluck","notes":[{"note":60,"velocity":0.9}],"seconds":2,"seed":7}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"gs1.analyze","arguments":{"wavPath":"<第 4 步返回的 wavPath>","note":60}}}
```

回帧（`tools/call` 的信封是 `result.content[0].text` = `JSON.stringify(result.structuredContent)`、
`result.isError`；下面只写后者的形状，省掉大数组）：

```jsonc
// id 1
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18",
  "capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"gs1-mcp","version":"2.1.1"}}}
// id 2 —— 14 个元素的 tools 数组，每个 { name, description, inputSchema }
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"gs1.analyze","description":"…","inputSchema":{…}}, /* …13 more… */]}}
// id 3 —— gs1.presets.list
{"count":91,"categories":["ALL","LEAD","BASS","PAD","PLUCK","KEYS","FX","BASIC","USER"],"presets":[{"id":"pluck",…}, /* …90 more… */]}
// id 4 —— gs1.render（真跑，pick 了 pluck）
{"ok":true,"wavPath":".tmp/mcp/<sha256 前 16 位>.wav","sha256":"…","byteLength":…,"samples":…,
 "channels":2,"sampleRate":48000,"seconds":2,"blocks":…,"seed":7,"oversample":0,
 "time":{"ruler":"time-domain-float","peak":…,"rms":…,"maxStep":…},"nonFinite":0,"allocViolations":0,"patch":{…}}
// id 5 —— gs1.analyze：source 变成 "wav:<路径>"，aliasing/secondRuler 各带尺子名
{"ok":true,"source":"wav:.tmp/mcp/<sha256 前 16 位>.wav","aliasing":{"ruler":"bh7",…},"secondRuler":{"ruler":"hann-goertzel",…},"nonFinite":0,"allocViolations":null}
```

- `initialize` 会**原样回显**客户端报的 `protocolVersion`（不报就用默认的 `2025-06-18`）；
  `notifications/initialized` **不是必须的**（通知不回帧，带 `id` 的才回）。
- **把 `gs1.render` 返回的 `wavPath` 原样交给 `gs1.analyze`**，别自己拼 sha256：默认路径就是仓库根下的
  `.tmp/mcp/<sha256 前 16 位>.wav`（或在 `outPath` 里指定的那个）。
- **关掉 stdin（或发 `SIGINT`/`SIGTERM`）服务器就退出，退出码 0**。stderr 只有诊断
  （`[mcp] stdio ready — 14 tools, log=on`），stdout 只有协议帧——所以 stdout 不能拿来看日志。

## 七、实现批次与验收记录

| 批 | 内容 | 验收 |
| :--- | :--- | :--- |
| **P13.1 抽尺子** | 把 `verify-audio.mjs` 的渲染引导与测量抽成 `scripts/lib/render-core.mjs` + `scripts/lib/audio-ruler.mjs`；门禁改为调用它们 | **门禁输出逐字节不变**（`verify:audio` 的每条读数、`test:dsp` **0.061470**、`verify:dsp:2x` **0.061703**、两侧 `91 presets unchanged · ABI 8` 一字不动）；`verify` 绿。**这是纯重构，不接受任何数字变化** |
| **P13.2 只读 + 渲染 + 测量** ✅ 2026-09-14（v2.1.1）| `mcp/server.mjs` + `mcp/tools/*.mjs`（**目录驱动**：新增工具＝加一个文件，不动共享清单）+ `gs1.describe`/`params.list`/`presets.list`/`patch.get`/`render`/`analyze`/`gate` + `npm run mcp`（stdio / `--http` 回环 / `--self-test`） | ✅ 工具级单测 **54 条**（P13.2 当时；`mcp/mcp.test.mjs` 今天是 **55** 条）：schema、参数校验、20 条拒绝路径、手写 JSON-RPC 的 `initialize`/`tools/list`/`tools/call`（含 `-32700`/`-32601`/`-32602` 错误帧）、黄金会话、共用实现、依赖自证。**黄金会话**：7 次调用（覆盖全部 7 个工具）跑两遍 `sha256` 相同、WAV 字节相同。**与门禁共用**：`gs1.gate` 的地板与 `offGridFloor(renderFloor(...))`（`verify-audio.mjs` P9.1a 的原调用）`toBe` 全等，四个波形逐一比对。**依赖**：`dependencies` 与 v2.1.0 清单一字不差——本仓库该字段本来就不是空对象（6 条：lamejs、两个 fontsource、playwright、react、react-dom），本批**没有新增任何条目**，尤其没有 `@modelcontextprotocol/sdk`（协议手写，esbuild 读取 app TS 但它是既有 devDependency）。`npm run mcp -- --self-test` 已同步进 `.github/workflows/ci.yml`、`scripts/verify-ci.mjs` 与 `verify` 链。实现说明见 `docs/notes/mcp.md` |
| **P13.3 操作类** ✅ 2026-09-15 | `mcp/tools/` 七个新文件（**只加文件，不动共享清单**）：`patch-set.mjs`/`patch-random.mjs`/`sample-import.mjs`/`wavetable-import.mjs`/`songs.mjs`/`preset-apply.mjs`/`preset-save.mjs`；`mcp/lib/session.mjs`（会话状态）、`mcp/lib/random.mjs`（带种子的 RANDOM 配方）、`mcp/lib/import.mjs`（解码与结构化拒绝） | ✅ 工具级单测 34 条 + P13.2 的 54 条（当时共 88 条绿；今天 `mcp/` 四个测试文件共 **132 条**全绿）：schema、每条拒绝路径、**夹取报告**（`filterCutoff: 99999 → 20000`，`clamped:[{key,asked,got,reason}]`，`partial:true` 叠加）、`noRoom` 结构化拒绝、**patch 往返**（`patch.get`→`patch.set`→`patch.get` 的 `shareCode` 与 224 个参数逐字节相同，含手工分层 `params2`）、**会话状态**（无 patch 的 `render` 播放当前 patch；导入的采样/波表被重放进每次 `initCore()` 的全新引擎）、**黄金会话**扩展到 21 次调用（含全部变异工具）跑两遍 `sha256` 相同。**`dependencies` 仍未变**：6 条，与 v2.1.0 清单一字不差 |
| **P13.4 浏览器层 + 范例** ✅ 2026-09-15（待随下一个版本发布）| `gs1.ui.*`（Playwright 驱动，复用帧无关交互）+ §4.5 的实战范例 | ✅ 见 §4.4 与 §4.5：五个工具（`mcp/ui/tools/*.mjs`，独立入口 `npm run mcp:ui`，`npm run mcp` 不加载它们）；`gs1.ui.click` 与 `e2e/fixtures.ts` 共用 `e2e/interact.mjs`（抽取时修掉 `force` 不生效的真缺陷）；白名单 `gs1.ui.gate`；截图 1440×900 与视觉基线同尺寸（desktop 24 张）；§4.5 是**真跑过**的范例——`crushlead` 的 ≥1 kHz 非谐波地板（Hann 宽探针）**-4.0170 → -64.8761 dB，改善 60.86 dB**（默认三探针 -13.0589 → -67.7049 dB），改动只有 `fxCrushBits: 6 → 4` |
| **P13.5 文档 + 门禁** ✅ 2026-09-15 | 本文补齐为**外部可读的契约** + `docs/notes/mcp.md` 补完 + `scripts/verify-llm-docs.mjs`（接进 `verify`、`ci.yml`、`verify-ci.mjs`）| ✅ 门禁双向核对 19 个工具名、上限与码表（错误码 15 条）；三条自证（删工具名 / 写不存在的名字 / 改 `MAX_SECONDS`）都红；一次**外部视角**检验（无上下文的 agent 只读这两份文件跑通 `tools/list → presets.list → render → analyze`） |

**顺序理由**：P13.1 必须先做（否则工具与门禁会各量各的）；P13.2 是「能用」的最小集（认知 + 听 + 量）；
P13.3 才能「改」；P13.4 是给需要看界面的 agent 的，最重、最可延后；P13.5 把上面四批的用法
钉成外部契约，并用门禁防止它漂移。

## 八、风险与取舍

| 风险 | 对策 |
| :--- | :--- |
| **工具与门禁的测量分叉**（同一个 bug 两种读数） | P13.1 强制「同一份实现」，且验收要求门禁读数**逐字节不变**；P13.5 用 `verify-llm-docs.mjs` 钉住文档 |
| **文档与代码分叉**（改名/改上限后文档还在说旧的） | 工具名双向核对 + 上限/错误码从代码常量派生（本批新增，接进 `verify` 与 CI） |
| MCP 协议演进 / 客户端差异 | framing 与 tools 分层；先只实现 `initialize`/`tools/list`/`tools/call`；HTTP 入口作为退路 |
| agent 用 `patch.set` 把音色改坏、或让引擎非有限 | 每次 `render`/`analyze` 都返回 `nonFinite`/`allocViolations`；工具**不做**「自动修好」——把判断留给 agent |
| 无界渲染把内存吃满 | `0.05 ≤ seconds ≤ 30`、`notes ≤ 512` + 12 MiB arena 的既有拒绝路径 |
| 让 agent 直接驱动浏览器很危险（点击/导航） | `ui.*` 默认关闭、只连本地预览、不接外部 URL；不暴露文件系统；`gs1.ui.gate` 白名单三个 spec |
| 过度设计成「万能 API」 | 工具**只覆盖这四种动词**（认知/操作/渲染测量/UI）；不做插件系统、不做表达式引擎 |

## 九、与现有计划的关系

- 这是**新方向 P13**（计划原为 P9–P12）。它**不改**任何既有批次的验收，也不动引擎行为。
- 依赖：**P13.1 依赖 P9.x/P10.x 全部已交付**（尺子已定型：双尺子、1/N²、P9.6 钉相位、P9.8 的拒绝码）。
  它的足迹是 `scripts/lib/`、`mcp/`、`docs/`，与「教学内容/内容包/SW 握手」都不重叠。
- 版本：P13.1–P13.3 随 **v2.1.1** 发布（2026-09-15）；P13.4 浏览器层与 P13.5 文档随后续版本发布
  （**不影响 v2.0.0 里程碑已达成的事实**）。

## 十、接入自查清单

只用**本文 + `docs/notes/mcp.md`** 就应该能回答下面每一条；答不上来说明文档有洞（或这段接口
漂移了——`scripts/verify-llm-docs.mjs` 是机器版的这份清单）。

1. **一共有几个工具、怎么分层？** 19 个：14 个离线（`npm run mcp`）+ 5 个浏览器（`npm run mcp:ui`）。
   两层的 registry 都扫目录（§一）。
2. **怎么起？需要装到什么程度？** `npm install`；离线层直接 `npm run mcp`；浏览器层还要
   `npm run build` + `npx playwright install chromium`，然后 `npm run mcp:ui`；冒烟是 `npm run ui:smoke`（§一）。
3. **`gs1.render` 的 `seconds` 上限是多少、超了返回什么？** 上限 **30**（下限 0.05）；
   超了是结构化拒绝 `E_RANGE`：`{ code:"E_RANGE", path:"$.seconds", maximum:30, value }`，
   不是崩（§4.3、§5.1）。
4. **`notes` 上限？** 512 条，至少 1 条；超了 `E_RANGE`（§5.1）。
5. **`gs1.patch.get` 的 `patch` 与分享码是不是同一格式？** 是。`shareCode` 就是分享链接那串
   `gs1.1.`/`gs1.2.`，`patch` 是它解码后的 `{params, routes, params2?, instanceMode?, splitNote?}`，
   两者 `gs1.render`/`patch.set` 都收（§4.2）。
6. **要量「≥1 kHz 非谐波地板」用哪个工具、哪一项告诉我是哪把尺子？** 首选 `gs1.gate`
   （门禁口径；`perNote[].bh7.window`/`hann.ruler` 带着尺子名）；`gs1.analyze` 适合量任意 buffer，
   结果在 `aliasing.ruler`/`secondRuler.ruler`（§4.3、§5.5）。
7. **要改音色用哪个工具、被夹取时怎么知道？** `gs1.patch.set`（或 `patch.random`/`preset.apply`）；
   结果里的 `clamped:[{key,asked,got,reason}]` 列出每一个被改动的值，`reason` 是 max/min/discrete（§4.2）。
8. **改完一组参数后，`gs1.render` 不给 `patch` 会渲染什么？** 会话当前 patch（`patch.set` 设过的
   那份）；采样/波表也是会话状态，会被重放进每次新引擎（§4.2 会话状态规则）。
9. **`gs1.analyze` 的 Hann 数字退化成 0 dB 附近是什么原因？** `f0` 给错了——它的分母是 `f0` 处的
   bin，detune/分层让实际基频偏离音符时必须传**实测基频**（§5.5）。
10. **两次相同的调用会不会给出不同字节？怎么自己验？** 不会。每次渲染起全新 wasm 实例，
    `seed` 是输入；结果带 WAV 的 `sha256`，自己比（§4.3、`docs/notes/mcp.md` §五）。
11. **工具能写哪些路径？** 只能写 `.tmp/mcp/`，越界 `E_PATH`；只读仓库内路径；永不部署、永不联网（§5.2、§5.3）。
12. **采样超长会怎样？** `E_RANGE`，`max:192000`——**拒绝而不是截断**；`noRoom` 在 12 MiB arena 下
    基本到不了，见 §5.6（§4.2、§5.6）。
13. **浏览器层要什么前置条件、端口是哪个？** 一份 `dist/` + Chromium + `npm run mcp:ui`；
    预览默认 **4796**（`GS1_MCP_UI_PORT` 可改），**绝不占 4783**（E2E 的），外部 URL 一律 `E_UI_URL`（§4.4）。
14. **浏览器层的 5 个工具叫什么、`gs1.ui.gate` 能跑哪些 spec？** `open`/`click`/`text`/`screenshot`/`gate`；
    `gate` 只认 `visual`/`performance`/`param-range` 三个 spec 与 `chromium` project（§4.4）。
15. **为什么浏览器层的两个 script 不在 CI 里？** 它们要 Chromium 和 `dist/`，与 E2E/性能套件同类；
    `verify-ci.mjs` 会断言它们**没有**被塞进必需门禁（§一、`docs/notes/mcp.md` §9.2）。
16. **工具拒绝与协议错误怎么区分？** 工具拒绝是**成功的** JSON-RPC 响应 + `result.isError:true`
    + `structuredContent.error.code`；协议错误（`-32700`/`-32600`/`-32601`/`-32602`）才是 `error` 帧（§4、§5.4）。
17. **不玩 MCP 怎么接？** `npm run mcp -- --http --port 3939`，往 `http://127.0.0.1:3939/` POST
    JSON-RPC；`GET /` 列工具名（§6.2）。
18. **只读这两份文件，能不能跑通一次 `tools/list → presets.list → render → analyze`？**
    能——§6.3 就是逐行可抄的会话（连回帧信封都有），WAV 落在 `.tmp/mcp/<sha256 前 16 位>.wav`（§6.3）。
19. **服务器怎么优雅关掉？要发 `notifications/initialized` 吗？** 关掉 stdin（或 `SIGINT`/`SIGTERM`）
    就退出，退出码 0；`notifications/initialized` 不是必须的（通知不回帧），协议只有
    `initialize`/`tools/list`/`tools/call`/`ping` 会回（§6.3、`docs/notes/mcp.md` §四）。
20. **`E_RANGE` 的附带字段有两种形状，为什么？** schema 层能表达的越界带 `path`/`minimum`/`maximum`，
    schema 表达不了的（跨字段、导入容量）带 `field`/`value`/`max`；只认一种的调用者分支 `code`（§5.1）。
