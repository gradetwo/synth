# MCP 使用反馈:四项改进的方案与落地记录

来源:一次真实 MCP 调用后的反馈——

1. 密集 16 分琶音 + 延音踏板,复音数超过 8 声部上限时,旧声部被截断偶发**微弱直流阶跃(click)**;
2. 工具只有底层原始参数,缺**高阶语义宏**(“更温暖 / 更空气感 / 更清脆”);
3. `gs1.render` 收 JSON note 数组,长段落编曲**吃 token**;
4. 另有两个事实询问:单次渲染是否 ≤30 s、是否无 undo。

**状态(2026-09-27)**:

| 项 | 结果 |
| :-- | :-- |
| P1 窃音降级淡出 | ✅ 已实现。**功能半边已证明**(强制释放在 29 个块内回收槽位,原路径 800);**可听的那半边没能复现** —— 仓库自己的 worst/p99.9 尺子在密集复音下对这一类完全不敏感(故意硬切也只读到 1.03),见下面 §2 的「未复现」段 |
| P2a `songId` / P2b `midiBase64` | ✅ 已实现,上限同时抬到 `seconds ≤ 120` / `notes ≤ 4096` |
| P2c 紧凑文本记谱法 | ❌ 按决定**放弃**(P2a/P2b 已覆盖内置曲与外部编曲两个来源) |
| P3 `gs1.patch.morph` | ✅ 已实现,属性表见下 §4 与 `docs/LLM-INTERFACE.md` §4.2 |
| P4 `gs1.patch.undo` | ✅ 已实现(session 有界栈,深度 32) |
| 顺带 | 定时 CI 的 Chromium 视觉基线按**报告**处理(字体栈差异),不再把 schedule 判红 |

下面保留的是**当时的方案与影响面分析**,已在实现中逐条核对;偏离之处就地标注。

---

## 1. 先把事实核对掉

**单次渲染 ≤30 s:是硬上限,且是刻意的时间/上下文预算。**

| 常量 | 值 | 位置 |
| :-- | :-- | :-- |
| `MAX_SECONDS` / `MIN_SECONDS` | 30 / 0.05 | `mcp/lib/render.mjs:39-40` |
| `MAX_NOTES` | 512 | `mcp/lib/render.mjs:41` |
| 发布出去的 `inputSchema` | `seconds` max 30、`notes` maxItems 512 | `mcp/tools/_schemas.mjs:24-59` |
| 文档门禁 | 断言文档里的数字与常量一致 | `scripts/verify-llm-docs.mjs:155-168` |

所以这三个数字是**被门禁锁住的**,要动就得同时改常量、schema、两份契约文档和门禁断言。

**undo:App 里有,MCP 面没有。**

- App:`src/state/store.ts:898-1019` 有完整的 `undo()` / `redo()` 栈;
- MCP:`mcp/lib/session.mjs` 的 `ctx.session` 只有 `{ patch, shareCode }`,`mcp/lib/patch.mjs:269` 的 `commitPatch` 直接覆盖它 ⇒ **对 agent 而言确实没有退路**。这是接口缺口,不是设计取舍。

---

## 2. P1 窃音点击:结论与建议方向相反,但确有真漏点

### 现状

Rust 端**已经有**快速淡出,而且比建议的 5–10 ms **更长**:

- `const STEAL_RELEASE: f32 = 0.05;`(`crates/synth-core/src/engine.rs:142`),`2be10b9` 把它从 0.02 提到 0.05,理由就写在注释里(UK Garage 主音上 20 ms 是能听见的 click);
- 窃音路径 `NoteOnResult::Queued`(`engine.rs:1348-1353`)对受害者做的是**包络 release**:`envs[victim].set_release(self.steal_release)` + `gate_off()`;
- 新音进 `pending`,等该 slot 到 idle 才起音(`flush_pending`,`voice.rs:219`)。

因此:

- **再引入 5–10 ms 会让它更短、更容易响**,不是修法;
- **“等功率”不适用于这里**:等功率(sin/cos)是给两路信号**同时交叉淡化**用的;当前是单路淡出到静音,线性即可。只有当新音与旧音真正同帧交叠时,等功率才有意义(见下面「备选」)。

### 真漏点

8 声部上限走的是**另一条路**:

```
trigger_smooth_downgrade()            engine.rs:1296
  → vm.force_release_excess(cap)      voice.rs:271
      v.gate = false;
      v.released = true;              ← 只做这两件事
```

它**没有**套用 `steal_release`,于是被降级挤掉的声部按**预设自己的 release** 收尾:短 release 的预设被硬切(→ 阶跃),长 release 的预设则会拖住 `pending` 的起音。密集琶音 + 延音踏板 + 8 声部上限,正好命中这条路。

### 建议做法

1. `force_release_excess` 把被强制的 slot 标出来(复用已有的 `stealing` 字段,或改成返回 slot 列表——后者语义更干净);
2. `trigger_smooth_downgrade` 对这些 slot 同样 `set_release(steal_release)` + `gate_off()`,与窃音路径走同一个淡出。

**备选**(如果你要的是「更低的窃音延迟」而不是「消掉阶跃」):把当前“旧音淡出 → slot 到 idle → 新音起音”换成**旧音等功率淡出 + 新音同帧淡入**的真交叉淡化。那是另一个批次:它会改 `pending` 的语义、`flush_pending` 的时机和一批既有测试。

### 影响面

| 项 | 结论 |
| :-- | :-- |
| 参数 / ABI | 不动,无新导出 |
| 预设指纹 / DSP 基线 | **预期不动**(指纹渲染不调用 smooth downgrade),但必须实测确认 |
| wasm gzip | 需实测;当前 CI 余量 `76.2 / 77.0 KB` |
| 契约文档 | 不动 |

### 测试

扩展已有的 `a_stolen_voice_fades_instead_of_clicking`(`engine.rs:6453`):池满 → `trigger_smooth_downgrade` → 断言被释放声部满足同一条「最大步进 / 99.9 分位比」判据;`voice.rs` 再加一条标注断言。

### 待拍板

一次降级可能**同时**释放多个声部,多个 50 ms 淡出叠加会有短暂电平凹陷。是沿用 50 ms,还是给降级单独一个时长(例如 80 ms)?建议**先测再定**。

---

## 3. P2 渲染输入的经济性

### 现状

- `gs1.render` 只收 `notes`(≤512 条 JSON,`_schemas.mjs:25-40`);
- `gs1.songs.list` 只给 25 首内置曲的**元数据**(id/title/composer/bpm/steps),**没有任何工具能取到这些曲子的音符** ⇒ agent 连“渲染一首内置曲”都做不到,只能自己吐 JSON。

### 三个选项

**P2a `songId`:直接按 id 渲染内置曲(建议先做)。**
零 payload——agent 一个字符串就够了。仓库已有 `DEMO_SONG_BY_ID`(`src/midi/songs.ts:807`)与 `layerNotes()`(`src/midi/smf.ts:109`)可复用。收益/成本比最高。

**P2b `midiBase64`:标准 SMF 字节(建议同批做)。**
`src/midi/smf.ts` 已有 `looksLikeMidi()`(:231)与 `parseMidi()`(:241),而且 `MidiNote`(:12-21)与 render 的 notes 字段**完全同形**:

```ts
{ note: number; velocity: number; start: number /* 秒 */; duration: number /* 秒 */ }
```

⇒ `parseMidi(bytes).notes` 可以直接进现有校验/渲染路径,几乎不引入新概念。DAW 也能直接产出这种输入。

**P2c 紧凑文本记谱法:不建议。**
要新发明并长期维护一套语法与解析器,而 P2a/P2b 已经覆盖了「内置曲」和「外部编曲」两个主要来源。

### 上限问题(需要你拍板)

一首真实曲子通常 >512 音、>30 s。可选:

- 给这两条路径**单独**的上限,并写进文档:`songId` 默认渲染整曲;`midiBase64` 允许更大的 note 数;
- 或保持现上限,用**命名错误**明确拒绝。

**一次工具调用能跑多久,是产品预算,不是实现细节。**

### 影响面

`mcp/` 不进 `dist`(`vite.config.ts` / `scripts/package.mjs` 都不引用它)⇒ **零体积、零指纹、零 ABI 影响**。若做成**新字段**而非新工具,工具计数不变,只需同步两份契约文档的字段表;若做成**新工具**,还要改 `scripts/verify-llm-docs.mjs:133` 的硬编码计数与文档里的「14 / 19」。

---

## 4. P3 高阶语义宏 `gs1.patch.morph`

### 现状

14 个离线工具全是原始参数面。要把“让声音更温暖”落地,agent 得自己换算 cutoff / resonance / env amount / drive / 滤波器类型 等十几项。

### 建议做法

新离线工具 `gs1.patch.morph { attribute, amount, partial? }`,内部是一张**显式属性表**:每个属性 → 一串 `{ 参数 id, 每单位增量, 钳位 }`(允许非线性曲线)。执行走现有 `applyParams` / `commitPatch`,并返回**实际应用的 delta**、**被钳位的项**和新的 share code——与 `patch.set` 已经建立的「钳位必报告,绝不静默」约定保持一致。

建议最小属性集(具体映射待你定或我先出初稿):`warmth`(温暖)、`air`(空气感)、`brightness`(清脆)、`width`(宽度)、`softness`(柔和)。

### 影响面

| 项 | 结论 |
| :-- | :-- |
| Rust / ABI / 指纹 / 体积 | **全部不动**(纯 MCP 层,不进 dist) |
| 工具计数与契约文档 | **必须同步**:14→15、19→20,且每个注册工具都必须在文档里出现 |
| 门禁 | `scripts/verify-llm-docs.mjs:133` 的 `tools.size === 14` 是硬编码,要改 |

### 风险

属性映射是**主观**的。因此它必须是一张可读、可测、可回滚的显式表,并配一条 fixture 断言(例如 `warmth=+0.2` 后 cutoff 恰好 +X Hz、且钳位被如实报告)。

---

## 5. P4 接口缺口:undo 与上限

**`gs1.patch.undo`**:`mcp/lib/session.mjs` 里放一个**有界栈**(建议深度 32)保存 `{ patch, shareCode }`;`commitPatch` 入栈;新工具出栈并返回恢复后的 patch 与 share code。工具计数同样 14→15。

**上限**:改 `MAX_SECONDS` / `MAX_NOTES` 是机械改动(schema + 两份文档 + 门禁断言同步),但**它是产品决定**——30 s 本质上是「一次工具调用的时间预算」。

---

## 6. 影响面总表

| 提案 | 触 Rust/ABI | 指纹 / DSP 基线 | dist 体积 | 工具计数与契约文档 | 主要测试 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| P1 窃音淡出 | 是(仅内部) | 预期不动,**需实测** | 需实测(余量 0.8 KB) | 否 | Rust 单测 + 步进比 |
| P2a `songId` | 否 | 否 | 不适用 | 否(新字段) | MCP 工具测试 |
| P2b `midiBase64` | 否 | 否 | 不适用 | 否(新字段) | 解析 + 上限 |
| P3 `morph` | 否 | 否 | 不适用 | **是**(14→15 / 19→20) | 属性表 fixture |
| P4 `undo` | 否 | 否 | 不适用 | **是**(14→15 / 19→20) | session 栈 |

> 关键结论:**P2/P3/P4 全部只活在 `mcp/`(Node 侧),不进 `dist`** —— 所以它们不触碰体积门禁、指纹和 ABI。只有 P1 动 Rust、要重量 wasm gzip。

---

## 7. 建议的批次划分

1. **批一(修 bug,可单独发版)**:P1。改动最小、有明确症状、可量化验收。
2. **批二(接口经济性,合为一批)**:P2a + P2b + P4 `undo`。它们都要动同一批契约文档与计数,合起来只改一次;且都不进 dist。
3. **批三(需要你先给属性表)**:P3。

---

## 8. 需要你拍板的决定

1. **P1**:降级释放沿用 50 ms,还是单独给一个更长的时长?(我先测再报数字)
2. **P2**:一次工具调用能跑多久 / 多少音?`MAX_SECONDS`(30 s)与 `MAX_NOTES`(512)是否放宽,是否只对 `songId` / `midiBase64` 放宽?
3. **P2**:是否同意**放弃**自研紧凑记谱法,只做 `songId` + `midiBase64`?
4. **P3**:属性表定哪几个属性、各自映射哪些参数、`amount` 的取值范围与曲线形态?
5. **P4**:undo 栈深度 32 是否合适?`patch.set` 之外的哪些调用也应入栈(`preset.apply`?)?
