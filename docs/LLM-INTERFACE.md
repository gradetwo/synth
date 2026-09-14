# 让别的 AI / LLM 使用 GS-1：接口设计与批次规划（P13，2026-09-14 立项）

> 用户要求：「设计规划提供接口让其它 AI/LLM 使用本 app」。
> 本文是**设计 + 规划**，不是实现。它先说清「用什么形态、为什么」，再给出可验收的批次拆分。

## 一、目标与非目标

**目标**：让一个外部 agent（Claude/ChatGPT/自研）能**离线、确定地**：
1. **看懂**这台合成器有什么：参数表（id/名字/范围/默认/单位）、预设、曲库、效果节点；
2. **改**它：读写整套音色（patch）、套用/保存预设、导入采样与波表；
3. **听**它：把一段演奏**渲染成 WAV**；
4. **量**它：用**本仓库自己的尺子**（BH-7 非谐波地板、THD、峰值/RMS、最大步进、过采样对照）给出结构化数字；
5. **迭代**：拿到数字 → 改参数 → 再量，直到满足某个门禁（例如「≥1 kHz 非谐波 ≤ −60 dB」）。

**非目标（第一版明确不做）**：
- **不做真实音频输出**（不接声卡；只做离线渲染）——省掉设备与实时性的全部麻烦；
- **不做联网/云**：服务器只在本机 stdio/loopback 上跑，不发任何请求；
- **不做任意代码执行**：工具是**白名单**的固定动词，不接受表达式/脚本；
- **不碰部署**：MCP 服务器**永远不会**调用 `wrangler` / `release`；它只能读仓库与写临时目录。

**为什么值得做**：本仓库最有价值的、别人没有的东西不是「又一个合成器」，而是
**一套已经被交叉验证过的测量尺子**（BH-7 + Hann 双尺子、1/N² 表长律、P9.1b/P9.1c/P9.6/P9.7/P9.8 的回归门禁）。
把它做成工具，别的 agent 就能**对着真实门禁迭代音色**，而不是凭感觉调参。

## 二、形态：MCP（stdio）+ 可选 HTTP，**手写、不引新运行时依赖**

- 主形态：**MCP（Model Context Protocol）over stdio**。这是现在 LLM 客户端接工具的事实标准，Claude Desktop / 各类 agent 框架都能直接挂。
- 次形态：**同一套工具的 HTTP JSON-RPC**（`127.0.0.1` 只回环），给不玩 MCP 的客户端；
  两个入口共用**同一份 tool registry**，不存在两套实现。
- **手写而不引入 `@modelcontextprotocol/sdk`**：MCP 的 stdio 框架是**很小的 JSON-RPC 子集**
  （`initialize` / `tools/list` / `tools/call` + 通知），手写约 150 行；换来的是**零新增运行时依赖**
  （与仓库一贯的依赖极简一致，也避免把一条供应链塞进一个「本地音频工具」里）。
  若日后协议演进到需要 SDK，再引也不迟——`server.mjs` 会把 framing 与 tools 分层，替换只动一层。

## 三、架构：两层，共用一份核心

```
 ┌───────────────────────────── 外部 agent（LLM） ─────────────────────────────┐
 │  MCP client / HTTP client                                                    │
 └───────────────┬──────────────────────────────────────────────────────────────┘
                 │  tools/call { name, arguments }
 ┌───────────────▼──────────────────────────────────────────────────────────────┐
 │ mcp/server.mjs        手写 JSON-RPC（stdio / 回环 HTTP），只做协议与校验      │
 ├──────────────────────────────────────────────────────────────────────────────┤
 │ mcp/tools/*.mjs       工具实现（参数校验 → 调用下层 → 结构化结果）            │
 ├──────────────────────────────────────────────────────────────────────────────┤
 │ scripts/lib/render-core.mjs   在 Node 里起真 wasm 核心（**今天已经这么干**：   │
 │                               verify-audio / dsp-baseline / bench 都这么跑） │
 │ scripts/lib/audio-ruler.mjs   尺子：FFT、BH-7、Hann Goertzel、±8 bin 地板、   │
 │                               THD、峰值/RMS、最大步进、过采样对照            │
 └──────────────────────────────────────────────────────────────────────────────┘
```

**关键点：不新增音频代码。** 第 4 层的两件事今天**已经存在**，只是当年长在 `scripts/verify-audio.mjs`（P13.1 抽尺子前 2814 行，抽完 **2294 行**）里。
所以第一批（P13.1）是**抽取**，不是新写：把尺子与渲染引导抽成 `scripts/lib/`，让**门禁与 MCP 共用同一份实现**——
否则「工具量出来的数」与「门禁量出来的数」迟早会分叉，那这套接口就没有意义了。

## 四、工具契约（第一版）

命名 `gs1.*`，全部**纯函数式**（给同样的输入，得同样的字节），全部返回**结构化 JSON**（大对象用文件路径而不是塞进 base64 里）。

### 4.1 认知类
| 工具 | 输入 | 输出 |
| :--- | :--- | :--- |
| `gs1.describe` | — | 版本、ABI、`PARAM_COUNT`、渲染采样率、arena 容量与余量、可用波形/滤波类型/效果种类（枚举与 id） |
| `gs1.params.list` | `{ filter?: string }` | `[{ id, key, nameZh, nameEn, min, max, default, unit, discrete }]`（**从 `params.ts`/`params.rs` 的同一张表派生**，不做第二份清单） |
| `gs1.presets.list` | — | `[{ id, name, tags }]`（**91** 条工厂预设定） |
| `gs1.songs.list` | — | `[{ id, title, composer, source:{kind,credit} }]`（含 v2.0.0 的来源/许可） |
| `gs1.fxGraph.describe` | — | 节点种类、每个节点的槽位语义、调制目标（供 agent 构图） |

### 4.2 操作类
| 工具 | 输入 | 输出 |
| :--- | :--- | :--- |
| `gs1.patch.get` | `{ presetId? }` | 完整 patch JSON（**与分享码/预设同一格式**，不是另造一套） |
| `gs1.patch.set` | `{ patch }` / `{ presetId }` / `{ params: {key:value}, partial:true }` | 生效后的 patch 摘要 + 被夹取的参数清单（**夹取要报告，不静默**） |
| `gs1.patch.random` | `{ seed }` | 同 `random` 按钮的确定性版本（**必须带 seed**，否则 agent 无法复现） |
| `gs1.sample.import` | `{ path }` 或 `{ wavBase64 }` | `{ ok, code, note?, poolBytes }`；**装不下时返回 `noRoom`（P9.8 的返回码 4），不许静默截断** |
| `gs1.wavetable.import` | `{ path }` 或 `{ cycleBase64 }` | `{ ok, code, capacity }` |

### 4.3 渲染与测量类（这套接口的真正价值）
| 工具 | 输入 | 输出 |
| :--- | :--- | :--- |
| `gs1.render` | `{ patch?, notes:[{note,velocity,start,duration}], seconds, oversample?, sampleRate?, seed? }` | `{ wavPath, samples, peak, rms, sha256 }` |
| `gs1.analyze` | `{ wavPath }` 或 `{ render: <同 gs1.render> }` + `{ f0 }` | 见下 |
| `gs1.gate` | `{ render, ruler:'bh7'\|'hann'\|'both', harmonics:±8 }` | **与 `verify:audio` 同一套判据**：各音高的非谐波地板、是否满足给定阈值、**以及它用的是哪把尺子** |

`gs1.analyze` 的输出（示意）：
```json
{
  "sampleRate": 48000, "seconds": 4, "blocks": 1500,
  "peak": 0.6043, "rms": 0.1210, "maxStep": 0.0938,
  "aliasing": { "ruler": "bh7", "window": "blackman-harris-7", "bins": 8,
                "perNote": [{ "note": 96, "f0": 2093.0, "worstDb": -70.5 }],
                "worstDb": -70.5 },
  "secondRuler": { "ruler": "hann-goertzel", "probes": [9000,9200,9500], "worstDb": -146.7 },
  "nonFinite": 0, "allocViolations": 0
}
```
**两条硬规矩**：①每个数字都带**用的是哪把尺子**（否则不同尺子的数字不可比）；②`allocViolations`/`nonFinite` 永远在结果里
（零分配是这个引擎的底线，agent 改参数时不该能破坏它）。

### 4.4 浏览器层（P13.4，独立进程，默认关闭）
| 工具 | 用途 |
| :--- | :--- |
| `gs1.ui.open` / `gs1.ui.screenshot` / `gs1.ui.click` / `gs1.ui.text` | 让 agent 看到并驱动**真实页面**（Playwright，复用 `e2e/fixtures.ts` 的帧无关交互） |
| `gs1.ui.gate` | 跑**视觉基线**比对与 `performance.spec.ts` 的两个门禁 |

这一层单独一个进程/子命令，因为浏览器比 wasm 重得多，而且它需要 `dist`——不该让「只想要个 patch」的 agent 付这个代价。

## 五、安全、确定性与资源边界

- **确定性**：所有随机入口必须吃 `seed`；渲染不使用挂钟；同一输入两次调用**逐字节相同**（输出里带 `sha256` 让调用者自己验）。
- **无副作用**：渲染与导入只写**调用者指定的**输出路径（默认 `.tmp/mcp/`）；不碰 `src/`、不碰 `release/`、**永不部署**。
- **资源上限**：`seconds ≤ 30`、`notes ≤ 512`、导入样本遵守既有 `MAX_BASE_SAMPLES` 与 12 MiB arena ⇒ **超出要返回结构化拒绝**，不是崩。
- **不新增依赖**：MCP framing 手写；HTTP 用 `node:http`；WAV 用仓库既有的写法。
- **可审计**：服务器把每次 `tools/call` 的名称与参数摘要追加到 `.tmp/mcp/calls.jsonl`（默认开、可关），便于事后复现一次「agent 干了什么」。

## 六、批次拆分与验收（每批独立可交付）

| 批 | 内容 | 验收 |
| :--- | :--- | :--- |
| **P13.1 抽尺子** | 把 `verify-audio.mjs` 的渲染引导与测量抽成 `scripts/lib/render-core.mjs` + `scripts/lib/audio-ruler.mjs`；门禁改为调用它们 | **门禁输出逐字节不变**（`verify:audio` 的每条读数、`test:dsp` **0.061470**、`verify:dsp:2x` **0.061703**、两侧 `91 presets unchanged · ABI 8` 一字不动）；`verify` 绿。**这是纯重构，不接受任何数字变化** |
| **P13.2 只读 + 渲染 + 测量** ✅ 2026-09-14（v2.1.1）| `mcp/server.mjs` + `mcp/tools/*.mjs`（**目录驱动**：新增工具＝加一个文件，不动共享清单）+ `gs1.describe`/`params.list`/`presets.list`/`patch.get`/`render`/`analyze`/`gate` + `npm run mcp`（stdio / `--http` 回环 / `--self-test`） | ✅ 工具级单测 **54 条**：schema、参数校验、20 条拒绝路径、手写 JSON-RPC 的 `initialize`/`tools/list`/`tools/call`（含 `-32700`/`-32601`/`-32602` 错误帧）、黄金会话、共用实现、依赖自证。**黄金会话**：7 次调用（覆盖全部 7 个工具）跑两遍 `sha256` 相同、WAV 字节相同。**与门禁共用**：`gs1.gate` 的地板与 `offGridFloor(renderFloor(...))`（`verify-audio.mjs` P9.1a 的原调用）`toBe` 全等，四个波形逐一比对。**依赖**：`dependencies` 与 v2.1.0 清单一字不差——本仓库该字段本来就不是空对象（6 条：lamejs、两个 fontsource、playwright、react、react-dom），本批**没有新增任何条目**，尤其没有 `@modelcontextprotocol/sdk`（协议手写，esbuild 读取 app TS 但它是既有 devDependency）。`npm run mcp -- --self-test` 已同步进 `.github/workflows/ci.yml`、`scripts/verify-ci.mjs` 与 `verify` 链。实现说明见 `docs/notes/mcp.md` |
| **P13.3 操作类** | `patch.set`/`patch.random`/`sample.import`/`wavetable.import`/`songs.list`/preset 套用与保存 | 单测覆盖「夹取要报告」「装不下返回 noRoom」「坏文件返回结构化拒绝」；patch 往返与 `patch.get` 一致 |
| **P13.4 浏览器层 + 范例** | `gs1.ui.*`（Playwright 驱动，复用帧无关交互）+ `docs/LLM-INTERFACE.md` 补「实战范例」一节 | 范例必须是**真跑过**的：让一个 agent 用这套工具把某个 patch 的 ≥1 kHz 非谐波地板改进 ≥20 dB，并贴出前后 `analyze` 的 JSON；`ui.screenshot` 能出图且与视觉基线同尺寸 |

**顺序理由**：P13.1 必须先做（否则工具与门禁会各量各的）；P13.2 是「能用」的最小集（认知 + 听 + 量）；
P13.3 才能「改」；P13.4 是给需要看界面的 agent 的，最重、最可延后。

## 七、风险与取舍

| 风险 | 对策 |
| :--- | :--- |
| **工具与门禁的测量分叉**（同一个 bug 两种读数） | P13.1 强制「同一份实现」，且验收要求门禁读数**逐字节不变** |
| MCP 协议演进 / 客户端差异 | framing 与 tools 分层；先只实现 `initialize`/`tools/list`/`tools/call`；HTTP 入口作为退路 |
| agent 用 `patch.set` 把音色改坏、或让引擎非有限 | 每次 `render`/`analyze` 都返回 `nonFinite`/`allocViolations`；工具**不做**「自动修好」——把判断留给 agent |
| 无界渲染把内存吃满 | `seconds`/`notes` 上限 + 12 MiB arena 的既有拒绝路径 |
| 让 agent 直接驱动浏览器很危险（点击/导航） | `ui.*` 默认关闭、只连本地 `vite preview`、不接外部 URL；不暴露文件系统 |
| 过度设计成「万能 API」 | 工具**只覆盖这四种动词**（认知/操作/渲染测量/UI）；不做插件系统、不做表达式引擎 |

## 八、与现有计划的关系

- 这是**新方向 P13**（计划原为 P9–P12）。它**不改**任何既有批次的验收，也不动引擎行为。
- 依赖：**P13.1 依赖 P9.x/P10.x 全部已交付**（尺子已定型：双尺子、1/N²、P9.6 钉相位、P9.8 的拒绝码）。
  如果 P12.1/P12.2/P12.6 还没做，P13 **可以并行**——它的足迹是 `scripts/lib/`、`mcp/`、`docs/`，
  与「教学内容/内容包/SW 握手」都不重叠。
- 版本：P13.1 起从 v2.1.x 继续累加（**不影响 v2.0.0 里程碑已达成的事实**）。
