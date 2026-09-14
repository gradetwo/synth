# 教学与练习模式（P12.1）

和弦/音阶助手 + 练习评分。目标音用 MIDI note 号表示，评分是**纯函数、确定性、可复现**的：
同一份演奏永远得到同一组分。规则的实现是 `src/teaching/score.ts`，它的证明是
`src/teaching/score.test.ts`（21 条），本文是两者的规格。

## 一、模块结构

| 文件 | 作用 |
| :--- | :--- |
| `src/teaching/theory.ts` | 音阶/和弦的音高集合与练习构建（纯逻辑，无 DOM/React/i18n） |
| `src/teaching/score.ts` | 评分：目标 + 演奏事件 → 量化结果（纯逻辑） |
| `src/teaching/theory.test.ts` | 14 条：音程、八度、闭八度、边界钳制、练习形状、i18n 键覆盖 |
| `src/teaching/score.test.ts` | 21 条：命中/漏音/多音、窗口边界、音准、节奏、权重、边界情形 |
| `src/components/Teaching.tsx` | 懒 chunk UI（默认导出是设置抽屉里的一行） |
| `src/components/teaching.css` | 懒 chunk 样式（含目标键高亮） |
| `src/i18n.teach.ts` | 本批自己的中英文案表（不动 `src/i18n-panels.ts`） |
| `e2e/teaching.spec.ts` | 入口/懒 chunk、目标高亮、正确与错误演奏的实测分数 |

### 音高集合的约定

- 根音与全部音高都是 **MIDI note 号**（0–127），不是字符串。
- `scalePitches(root, id, octaves)`：从根音**上行**，`octaves` 个八度，**含收尾的闭八度**。
  C4 大调一个八度 = `[60,62,64,65,67,69,71,72]`（8 个音，不是 7 个）。
- `chordPitches(root, id, octaves)`：和弦音 + **高八度的根音**。C4 大三一个八度 =
  `[60,64,67,72]`。
- 越界根音会钳到 0–127 并去重，函数是全函数（极端输入得到短练习，不会给出界外的音）。
- 音阶 7 种：大调、自然小调、和声小调、多利亚、大调五声、小调五声、布鲁斯。
- 和弦 9 种：大三、小三、减三、增三、挂二、挂四、大七、小七、属七。

### 练习的形状

`buildExercise({kind, root, id, octaves, bpm})` 把选择变成**每个 step 一个音、每拍一个
step 的上行琶音**（音阶就是音阶本身，和弦就是根音-三音-五音-…-高八度根音）。`bpm` 钳在
20–400，`octaves` 钳在 1–3。

`step.onset` 是**从练习开始算起的秒数** = `index * 60/bpm`。之所以一个 step 只放一个音：
把整和弦塞进同一个 onset 会让节奏分变成必然事件，节奏准确率就没有信息量了。

## 二、评分规则（确切定义）

### 输入

```ts
interface PlayedNote {
  note: number;       // MIDI
  start: number;      // 秒；名义起点
  duration: number;   // 秒；只原样带出，不参与评分
  onset?: number;     // 秒；设备自己的时间戳，存在时它就是 onset，start 被忽略
}
scorePerformance(target: ExerciseTarget, played: PlayedNote[], options?): PracticeResult
```

非有限值（`NaN`/`Infinity`）的事件**直接丢弃**，不参与任何计数。演奏事件按
`(onset, note, 原始下标)` 排序后再处理，所以输入顺序不影响结果。

### 对齐（确定性）

对每个演奏事件，在目标的所有 step 里找 **onset 距离最近**的一个，条件是距离
`|Δt| ≤ windowMs`（默认 **300 ms，边界包含**）。平手（正好在两个 step 中点）时取
**靠前**的 step（代码用严格 `<` 比较，先到者保持）。

事件落到某个 step 后：

| 情况 | 判定 | 计数 |
| :--- | :--- | :--- |
| 音高 ∈ 该 step 的音高，且该音高未被这个 step 用过 | **命中 hit** | `matched` +1，记录带符号时间偏差 `Δt`（负=早） |
| 音高不匹配，或该音高已被这个 step 用过（重复触发） | **错音** | `extra` +1，记录到该 step 最近音高的**半音距离**（`|note - p|` 的最小值；重复同一正确音则记 0） |
| 不在任何 step 的窗口内 | **多音（错时）** | `extra` +1，不进音准统计 |

事件全部处理完后，**没被命中的目标音**就是**漏音 missed**：`missed = expected - matched`。

### 输出指标

- `hitRate = matched / expected`（按音高的命中率），`expected = Σ steps[].pitches.length`。
- 音准 `intonation`：`errors[]`（每个错音的半音距离，按时间顺序）、`meanError`、`maxError`，
  以及 `quality = 1 / (1 + meanError / 2)`（`INTONATION_REFERENCE_SEMITONES = 2`）。
  没错音时 `meanError = 0 → quality = 1`：全弹对了，音准就是满分。
- 节奏 `timing`：`deviations[]`（命中的带符号偏差 ms）、`meanMs`、`meanAbsMs`、`maxAbsMs`，
  以及同样的 `meanAbsBeats`/`maxAbsBeats`（用目标的 bpm 换算）、`early`/`late` 计数，
  以及 `quality = clamp(1 - meanAbsMs / windowMs, 0, 1)`。
  没有命中时（`deviations` 为空）`quality = 1`——没有可评的节奏，不因此扣分。
- 逐音 `pitches[]`：每个目标音高的 `{pitch, expected, matched}`（按首次出现顺序）。
- `extra` = 错音 + 错时多音。

### 总分

```
score = round( 100 · hitRate · (Wacc + Winto · quality_intonation + Wrhy · quality_rhythm) / (Wacc + Winto + Wrhy) )
SCORE_WEIGHTS = { accuracy: 0.6, intonation: 0.2, rhythm: 0.2 }
```

权重按和归一化，所以**权重全为 0 也不会出现除零**，且完美演奏恰好 **100**。

### 边界情形（都写进了单测）

| 情形 | 结果 |
| :--- | :--- |
| 完全准时、全对 | `score = 100`，`hitRate = 1`，`missed = 0`，`extra = 0`，`meanAbsMs = 0` |
| **空演奏**（一个音都没弹） | `score = 0`，`hitRate = 0`，`missed = expected`，`extra = 0`；`intonation.quality = 1`、`timing.quality = 1`（没弹错任何音，也没得评节奏），总分是 0 是因为一个都没命中 |
| **空目标**（`expected = 0`） | `score = 0`、`hitRate = 0`（视为无可评分内容，不给"虚空的 100"）；此时任何演奏事件都记 `extra` |
| 正好 **±300 ms** | **命中**（边界包含），`deviations` 记 `±300` |
| **301 ms** | 不命中：算错时多音 + 该目标音漏音 |
| 错音（时值正确） | 不算命中：`matched` 少 1、`extra` +1、音高距离进 `errors[]` |
| 重复触发同一正确音 | 第一次命中，之后每次算 `extra`，音准记 0 半音（不扣分，也不刷分） |
| 错时的多音（窗口外） | 只进 `extra`，**不改变总分**（见下） |
| 弹散的和弦（同一 step 内 0/50/100 ms） | 全部命中；50 ms 的平均偏差是真实的节奏误差 → 97 分 |

**多音是否扣分**：会，但**只通过音准与命中率间接扣**。落在窗口内的错音会同时拉低
`hitRate`（它不是命中）和 `quality_intonation`（它的半音距离进 `errors[]`）；而**完全错时**
（窗口外）的多音只出现在 `extra` 字段里，不改变总分。这是有意的：评分衡量的是"该弹的音
有没有弹对、弹准、弹在拍上"，而不是"有没有乱弹";`extra` 仍然如实报出来，供老师看。
之所以不做成第四个惩罚项，是不想让权重表变成四个互相纠缠的旋钮——现在的公式一行能写完，
也能手算复核。

### 可复现

- 所有聚合值都按固定位数四舍五入：比率 4 位、半音 3 位、毫秒/拍 1/3 位，`deviations[]` 与
  `errors[]` 保留原始顺序，`score` 为整数。
- 唯一的时间来源由调用方给出（`onset`/`start`），评分函数自己**不读时钟**。
- `score.test.ts` 里钉了具体数字（70 / 64 / 65 / 90 / 97 / 100 / 0），故意改坏规则会红：
  去掉音高判断 → 4 条红；把音准权重置零 → 2 条红。实测输出见批次报告。

## 三、UI 与懒加载

- 入口：设置抽屉「工作区」里的一行（`data-setting="teaching"`，按钮 `data-act="teach-open"`），
  和工程管理那一行同一个模式——**行的默认导出就是懒 chunk 本身**，所以首屏只多一个 `lazy()`。
- 面板是**非模态**左上角卡片（不是 `.drawer`）：抽屉在右侧且带遮罩，会挡住、也点不到玩家要弹的
  键盘。面板 `max-height: calc(100vh - 236px)`，底部键盘始终可用（E2E 里有真实 hit test 的点击）。
- 目标键高亮：面板给既有键盘的 `[data-midi]` 元素加 `.teach-target` 类，根音音级额外标
  `data-teach-root="1"`；`MutationObserver` 在 React 重写 `className`（例如按键时）后补回。
  高亮逻辑全在懒 chunk 里，**首屏因此不新增任何 store/hook/样式**（本批首屏只剩 ~0.3 KB 余量）。
- 文案：`src/i18n.teach.ts`（中英成对），由 chunk 自己 `loadTeachStrings()` 注册，并在
  `loadAllStrings()` 里并入（语言切换用）。`theory.test.ts` 另有一条守卫：每个音阶/和弦 id
  都必须有中英两个键。

## 四、E2E

`e2e/teaching.spec.ts`（chromium）用**真实的 window keydown/keyup**（即 `Keyboard.tsx` →
`noteBus` → 面板记录器这条路）演奏：正确的一遍弹 C 大调（`a s d f g h j k`），错误的一遍弹
同一个八度的黑键（全部在 C 大调之外）。测试把两个分数 `console.log` 出来，也在
`docs`/报告里原样贴出。
