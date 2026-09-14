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

**已经实现**（`npm run mcp:ui`，入口 `mcp/ui/server.mjs`；工具在 `mcp/ui/tools/`，和离线层一样**扫目录**注册：

| 工具 | 输入 | 输出（要点） |
| :--- | :--- | :--- |
| `gs1.ui.open` | `{ path?, url?, viewport?{width,height}, waitForMs? }` | `{ url, title, status, viewport, mounted, gateCleared, ready, consoleErrors, consoleMessages, navigationMs, bootMs, distDir, previewPort, baseline }`。默认 `1440x900`（视觉基线桌面尺寸）；**只接受本站**预览的 URL，外部 origin 一律 `E_UI_URL` |
| `gs1.ui.click` | `{ selector, force?, timeoutMs?, position? }` | `{ ok, force, hitTested, clicked:{x,y}, box, element, elapsedMs, implementation }`；`force:true` 跳过可操作性检查（Playwright 语义） |
| `gs1.ui.text` | `{ selector?, all?, attribute?, maxLength? }` | `{ ok, selector, count, text }` 或 `all:true` 的 `{ values }`；**空匹配不是错误**（`count:0`） |
| `gs1.ui.screenshot` | `{ name?, fullPage?, selector?, animations? }` | `{ screenshotPath, width, height, bytes, sha256, viewport, consoleErrors, baseline:{device,width,height,matches,count,names} }`；只写 `.tmp/mcp/`，宽高从 PNG 头**读回** |
| `gs1.ui.gate` | `{ spec:'visual'\|'performance'\|'param-range', project?:'chromium', timeoutMs? }` | `{ ok, spec, specFile, command, port, exitCode, passed, failed, skipped, tests[], logPath, reportPath, logTail }`；**白名单**，不接受 spec 路径/其它 project |

**单一实现**：`gs1.ui.click` 调用的就是 `e2e/interact.mjs`——从 `e2e/fixtures.ts` 抽出来的那份帧无关交互（`fixtures.ts` 仍然在 WebKit 上把它装到 Playwright 的动词上）。`mcp/ui/` 里**没有**第二份命中/滚动逻辑。抽取时修掉了 `e2e/fixtures.ts` 里的一个真缺陷：`ClickOptions.force` 从来没被读，`click({force:true})` 会死循环到超时。

边界与冒烟跑法见 `docs/notes/mcp.md` §九；**下面这节是这套工具真跑过一次的范例**。

### 4.5 实战范例：把 `crushlead` 的 ≥1 kHz 非谐波地板降 60.86 dB（真跑，2026-09-15）

这一节里的每个数字都是一次真实的 `tools/call` 结果（Node 里的 wasm 核，不是浏览器；浏览器只用于最后一步的「页面里也真的生效」）。**完整调用序列在 §4.5.5**，父代理可以照着重跑。

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

`gs1.ui.open` 的默认视口就是 `e2e/visual.spec.ts` 的 desktop `test.use({viewport:{width:1440,height:900}})`、`deviceScaleFactor:1`，截图用 `scale:'css'`（与视觉基线同一个 `SHOT` 配置），所以**默认全视口截图与 20 张 desktop 基线同尺寸**；结果里的 `baseline.matches === true` 就是这个断言，`ui:smoke` 里也有一条 check。

> 诚实说明：尺寸一致，**像素不保证一致**。视觉基线是**启动门出现时**的截图，`ui.open` 拿到的是「外壳已挂载、启动门还在」的同一状态（`gateCleared:false`），但基线本身的容差（1 % 像素、5 % 颜色距离）和字体光栅是 `e2e/visual.spec.ts` 自己的事；`gs1.ui.gate {spec:"visual"}` 才是跑那套比对的地方。

#### 4.5.7 这个范例没做到的部分

- `bh7` 全带地板（跨谐波栅格的「总」非谐波能量）**没有**改善：-0.0025 → -0.0006 dB。原因是 `crushlead` 的 OSC2 在 -12 st、OSC1 detune +8 ct，两台振荡器的谐波不在同一栅格上，`bh7` 在这个 patch 上量的是「分层」而不是「混叠」。要一个 `bh7` 也干净的范例，得挑单振荡器、与音符同调的 patch——那类的 `bh7` 地板本来就在 -100 dB 上下，没有 20 dB 可改。
- 这个改动**换来了量化噪声**：`analyze.thd` 从 26.7 % 升到 60.4 %（4 bit 的量化台阶）。任务是「把 ≥1 kHz 非谐波地板降 20 dB」，做到了；但这不是一个可以无脑套用的音色修改，`docs/notes/mcp.md` 的取舍一节也这么写。
- 低音区（note 72/84）这条改动**不稳定**：宽探针下 note 72 变差 3.7 dB、note 84 变好 7.4 dB（探针与基频的相对位置随音高变），稳定的大幅改善只出现在 C7 以上。这条结论也是真跑出来的，没有藏。

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
| **P13.3 操作类** ✅ 2026-09-15 | `mcp/tools/` 七个新文件（**只加文件，不动共享清单**）：`patch-set.mjs`/`patch-random.mjs`/`sample-import.mjs`/`wavetable-import.mjs`/`songs.mjs`/`preset-apply.mjs`/`preset-save.mjs`；`mcp/lib/session.mjs`（会话状态）、`mcp/lib/random.mjs`（带种子的 RANDOM 配方）、`mcp/lib/import.mjs`（解码与结构化拒绝） | ✅ 工具级单测 34 条 + P13.2 的 54 条（共 88 条绿）：schema、每条拒绝路径、**夹取报告**（`filterCutoff: 99999 → 20000`，`clamped:[{key,asked,got,reason}]`，`partial:true` 叠加）、`noRoom` 结构化拒绝、**patch 往返**（`patch.get`→`patch.set`→`patch.get` 的 `shareCode` 与 224 个参数逐字节相同，含手工分层 `params2`）、**会话状态**（无 patch 的 `render` 播放当前 patch；导入的采样/波表被重放进每次 `initCore()` 的全新引擎）、**黄金会话**扩展到 21 次调用（含全部变异工具）跑两遍 `sha256` 相同。**`dependencies` 仍未变**：6 条，与 v2.1.0 清单一字不差。**名字说明**：`gs1.songs.list` 在本文 §4.1 被列在只读类、P13.2 未交付，本批补上；`gs1.preset.apply`/`gs1.preset.save` 本文 §4.2 未列，名字取自 P13.3 任务书。实现与状态规则见 `docs/notes/mcp.md` |
| **P13.4 浏览器层 + 范例** ✅ 2026-09-15 | `gs1.ui.*`（Playwright 驱动，复用帧无关交互）+ `docs/LLM-INTERFACE.md` 补「实战范例」一节 | ✅ 见 §4.4 与 §4.5：五个工具（`mcp/ui/tools/*.mjs`，独立入口 `npm run mcp:ui`，`npm run mcp` 不加载它们）；`gs1.ui.click` 与 `e2e/fixtures.ts` 共用 `e2e/interact.mjs`（抽取时修掉 `force` 不生效的真缺陷，Chromium 套件不回归，5 条单测在自己进程里证明去掉 `force` 分支即红）；白名单 `gs1.ui.gate`；截图 1440×900 与视觉基线同尺寸；§4.5 是**真跑过**的范例——`crushlead` 的 ≥1 kHz 非谐波地板（Hann 宽探针）**-4.0170 → -64.8761 dB，改善 60.86 dB**（默认三探针 -13.0589 → -67.7049 dB），改动只有 `fxCrushBits: 6 → 4`，前后 JSON、完整调用序列、以及没做到的部分（`bh7` 在这条分层 patch 上不适用、THD 26.7 % → 60.4 %、低音区不稳定）都在那一节里 |

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
