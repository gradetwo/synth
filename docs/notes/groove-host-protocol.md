# Worklet 主机协议：按帧寻址的音符事件 / Frame-addressed note events

**给外部主机（例如 Groove Lab 这类带 lookahead 调度器的应用）的可发运契约。**
实现只有一份：`src/audio/worklet-processor.js`（`handleMessage` / `scheduleTimedNote` /
`applyScheduledNotesUpTo` / `process`），处理器名 `gs1-synth-processor`。

本文件的「机器可读契约」一节里有**两张表**，它们是门禁
`scripts/verify-worklet-protocol.mjs`（`npm run verify:worklet-protocol`）**唯一**的解析来源：
消息名、字段名、常数逐一与源码双向比对。改代码不改这里、或改这里不改代码，门禁都会红。

## 一、为什么需要按帧寻址

AudioWorklet 的 `port.postMessage` 只能在**消息到达时**生效（`process()` 在音频线程被调用，
主机无法在未来的某个采样点被「叫醒」）。没有这个协议时，主机只有一个选择，两种坏结果：

- 提前 post ⇒ 音符比谱面**早**整整一个 lookahead；
- 用 `setTimeout` 卡点 post ⇒ 继承主线程抖动，音符**忽早忽晚**。

按帧寻址把「什么时候响」变成主机自己的算术：主机给出**绝对帧号**，引擎在渲染到那一帧时应用，
**不吸附到 128 帧边界**，也不受消息送达时刻影响。

## 二、握手：先等 `ready`，再发事件

`handleMessage()` 的第一行是 `if (!this.ready) return;` —— **WASM 实例化完成之前发来的任何消息
都被丢弃（不是排队）**。`ready` 是唯一的开闸信号：

```js
port.onmessage = (e) => {
  if (e.data.type === 'ready') {
    // e.data.abi === 9，e.data.scheduledNoteLatencyFrames === 128
    start();
  }
};
```

`ready` 的两个字段见下面第二节表格；`abi` 是核心 ABI 版本（当前 **9**），
`abi` 与 `scheduledNoteLatencyFrames` 都由核心/处理器**运行时给出**，主机不要抄成常数。

## 三、按帧寻址的消息

三条消息共用一条代码路径（`case 'noteAt' | 'noteOnAt' | 'noteOffAt'`）：

| 消息 | 语义 | 与即时消息的关系 |
| :--- | :--- | :--- |
| `noteAt` | 在绝对帧 `atFrame` 起音 | 等价于在那一帧收到 `noteOn` |
| `noteOnAt` | `noteAt` 的**别名**（同一分支，行为逐位相同） | 同 `noteOn` |
| `noteOffAt` | 在绝对帧 `atFrame` 止音 | 同 `noteOff`（`velocity` / `pan` 被忽略） |

字段语义：

- **`atFrame`**：**绝对帧**，即自 `AudioContext` 时间原点起的采样序号。
  主机自己算：`atFrame = Math.round(when * sampleRate)`，其中 `when` 是 `AudioContext.currentTime`
  口径的秒数、`sampleRate` 是该 context 的采样率（等于 worklet 全局的 `sampleRate`）。
  **必须是 `number` 类型且有限**：处理器先做
  `typeof data.atFrame === 'number' && Number.isFinite(data.atFrame)`，通过后再取整
  `Math.round(data.atFrame)`。
  - **过去的帧 = 尽快应用**（迟到的主机应该「响得晚」，而不是「永远不响」）。已到期的事件在下一次
    `process()` 的第一段就应用。
  - **非 `number` 或非有限值 = 整条消息忽略**，绝不当作 0：`null` / `''` / `false`（`Number()`
    会把它们变成有限的 `0`）、`NaN` / `Infinity` / 数字字符串一律 `break`。
- **`note`**：MIDI 音符号（0–127 语义；核心侧 `note.min(127)`）。**必须是有限 `number`**；
  `NaN` / `Infinity` / 字符串 / `null`（会被 `Number()` 变成音符 0）⇒ 整条消息忽略。
- **`velocity`**：0–1 的浮点。`noteAt` / `noteOnAt` **省略 ⇒ 按 MIDI 惯例视为 1.0（满力度）**并
  正常起音；**给出但非有限 `number`**（`NaN` / `Infinity` / 字符串 / 对象 / `null`）⇒ **整条消息
  忽略**（静默替换成默认值会掩盖宿主的编码错误）。`noteOffAt` 不用它（代码里强制 0）。
- **`pan`**：−1（左）… +1（右）。**省略** ⇒ 走 `gs_note_on`（单声道、居中）；**给出有限
  `number`** ⇒ 走 `gs_note_on_pan`；**给出但非有限**（`NaN` / 字符串 / `null`）⇒ **丢弃 `pan`、
  音符照常居中起音**（音高与时机是契约，定位是装饰）。对 `noteOffAt` 无意义（止音不带声像）。

## 四、队列语义（`scheduledNotes`）

- 队列按 `frame` **升序**保存；插入是从尾部线性回扫（主机几乎总按时间递增下发，常见情况只比一次），
  相同帧保持**先来先应用**。
- **上界 `MAX_SCHEDULED_EVENTS = 1024` 条**。满了先 `shift()` 丢**最旧**的一条再插入
  ⇒ 长度**永不超过 1024**。理由：合法的 lookahead 主机只持有几百条；再往上多半是主机在漏事件，
  而音频线程上无限增长不是选项。
- **`panic` / `allNotesOff` 清空队列**（`this.scheduledNotes.length = 0`）**并**立刻
  `gs_all_notes_off()`。理由：panic 的语义是「现在就要静音」，挂着的未来事件正好相反。
- **`mute` 不清队列**：`mute: true` 只 `gs_all_notes_off()`，排队中的未来事件仍然有效。
  想要「静音且作废未来事件」用 `panic`。
- **静音期间帧游标仍前进**：`process()` 在 `!ready || muted` 时输出静音、但照样
  `renderedFrames += frames`。事件按绝对帧寻址，游标若停住，静音一结束所有排队事件会集体迟到。
- 队列事件**不会**因为 `mute`、`!ready` 或负载降级而被丢弃；只有 `panic` / `allNotesOff` 和
  上界淘汰会移除它们。

## 五、恒定延迟：`scheduledNoteLatencyFrames`

事件在**块内**到期时，`process()` 会把当前渲染块切成几段：每段先
`applyScheduledNotesUpTo(blockStart + offset)`，再 `gs_process(chunk)`。于是：

- 事件**落在它命名的帧**上（`Math.max(1, next - (blockStart + offset))` 保证分段推进），
  **不会**被吸附到下一个 128 帧边界；
- 但核心需要一次 `gs_process` 调用之后，新起的声部才会出声 ⇒ **声部的第一个样点比 `atFrame`
  晚一个渲染量子**。这个偏移与事件落在块内何处无关（`src/audio/worklet-processor.test.ts`
  › `honours the exact frame, with a constant one-block voice-start latency` 用
  `atFrame = 0/100/128/200/384/500` 实测：可测起声点相对 `atFrame` 的**离散度 ≤ 8 帧**，
  且 `≥ scheduledNoteLatencyFrames`）。

**这是恒定延迟，不是抖动**：块内位置**逐样本保留**（相差 100 帧的两个事件，输出仍相差约 100 帧）。
所以：

- 要和原生采样精确声部对齐的主机，把事件地址**提前 `scheduledNoteLatencyFrames` 帧**下发
  （即 `atFrame = Math.round(when * sampleRate) - ready.scheduledNoteLatencyFrames`），
  声部就会恰好落在 `when`；
- 延迟值从 `ready` 消息里读，**不要**在主机侧硬编码 128 —— 换核心/换实现时它可能变；
- 不需要样点级对齐（只要「不抖」）的主机可以原样下发，把它当成一台固定延迟的乐器。

## 六、最小客户端

```js
const ready = await new Promise((resolve) => {
  node.port.onmessage = (e) => { if (e.data.type === 'ready') resolve(e.data); };
});
const { sampleRate, scheduledNoteLatencyFrames } = ready; // ready 里同时带 abi

// `when`：AudioContext.currentTime 口径的秒数（例如谱面第 4.25 秒）
const atFrame = Math.round(when * sampleRate) - scheduledNoteLatencyFrames;
node.port.postMessage({ type: 'noteAt', atFrame, note: 60, velocity: 0.9 });
node.port.postMessage({ type: 'noteOffAt', atFrame: atFrame + 24000 }); // 0.5 s 后止音
```

## 七、机器可读契约（门禁解析区）

下面两张表由 `scripts/verify-worklet-protocol.mjs` 解析，并与 `src/audio/worklet-processor.js`
**双向**比对。表外的散文不参与判定；**改契约请改表**。

<!-- verify-worklet-protocol:begin -->

| 方向 | 消息 | 字段 | 语义 |
| :--- | :--- | :--- | :--- |
| `host→worklet` | `noteOn` | `{ note, velocity, cents? }` | 立即起音（`cents` 可选：该音符的微分音偏移） |
| `host→worklet` | `noteOnPan` | `{ note, velocity, pan, cents? }` | 立即起音并定位 |
| `host→worklet` | `noteOff` | `{ note }` | 立即止音 |
| `host→worklet` | `noteAt` | `{ atFrame, note, velocity, pan, cents? }` | 在绝对帧 `atFrame` 起音（输入校验见第三节） |
| `host→worklet` | `noteOnAt` | `{ atFrame, note, velocity, pan, cents? }` | `noteAt` 的别名（含同一套输入校验） |
| `host→worklet` | `noteOffAt` | `{ atFrame, note }` | 在绝对帧 `atFrame` 止音（`velocity` 强制 0） |
| `host→worklet` | `allNotesOff` | `{}` | 清队列 + 全部止音 |
| `host→worklet` | `panic` | `{}` | `allNotesOff` 的别名（同样清队列） |
| `worklet→host` | `ready` | `{ abi, scheduledNoteLatencyFrames }` | 握手；此前所有消息被丢弃 |

| 常数 | 值 | 语义 |
| :--- | :--- | :--- |
| `MAX_SCHEDULED_EVENTS` | `1024` | 队列上界；满了丢最旧 |
| `SCHEDULED_NOTE_LATENCY_FRAMES` | `128` | `ready.scheduledNoteLatencyFrames` 的来源 |

<!-- verify-worklet-protocol:end -->

## 八、输入边界与取舍（本版已加输入校验）

**合法输入的行为逐位不变**：下面每一条只影响原本 malformed 的输入——校验发生在
`scheduleTimedNote` 入队**之前**，调度、排序、队列上界、按帧切块、panic、静音游标都没动。

1. **`velocity` 省略 ⇒ 1.0（满力度），非有限值 ⇒ 整条忽略**。旧行为：`{ type: 'noteAt', note,
   atFrame }` 缺 `velocity` 时 `data.velocity` 是 `undefined`，WASM 的 `f32` 形参把它变成
   `NaN`，核心侧 `velocity.clamp(0.0, 1.0)` 对 `NaN` 不生效（比较全为 false）⇒ 该声部增益
   `NaN`；输出端把 NaN 兜底成 0 并给 `nan_events` 计数，所以症状是「静音 + nan_events」而不是
   崩溃。现在**缺省取 MIDI 的隐含满力度 1.0**；**给出但非有限（`NaN` / `Infinity` / 字符串 /
   对象 / `null`）⇒ 整条忽略**。取舍理由：缺省是「宿主没填」，满力度是它最可能的意图（静默忽略
   会让宿主以为协议没生效）；而给出坏值是宿主的 bug，静默替换会把它掩盖掉。
   测试：`src/audio/worklet-processor.test.ts › applies a note-on with no velocity at full velocity, never NaN`。
2. **`atFrame` 必须是 `number` 类型且有限**。旧行为：`Number.isFinite(Math.round(Number(x)))` 对
   `null` / `''` / `false` 全为真（`Number()` 把它们变成有限的 `0`）⇒ 被当作**帧 0** 立即响，
   正是注释里说要避免的「malformed ⇒ 当成 0」。现在这三类输入与 `NaN` / `Infinity` / 数字字符串
   一样整条忽略。测试：`… › rejects a non-number atFrame instead of coercing it to frame 0`。
3. **`note` 必须是有限 `number`**：`null`（→ 音符 0）/ 字符串 / `NaN` / `Infinity` 都整条忽略。
   测试：`… › rejects a note that is not a finite number`。
4. **`pan` 存在时必须有限；非有限则丢弃 `pan`、音符照常居中起音**。旧行为只判 `!== undefined`，
   于是 `pan: NaN` 真的进核心。选择「丢 pan 而不是丢事件」的理由：音高与时机是契约，定位是装饰，
   为一个坏 pan 丢掉一个正确的音符是更大的失败。`pan: null` 的新结果（居中）与旧结果
   （`null` → 0 = 居中，经 `gs_note_on_pan`）听感相同。测试：`… › keeps a non-finite pan out of
   the core without losing the note`。
5. **`noteOffAt` 的 `pan` 与 `velocity` 被静默忽略**（`velocity` 强制 0，走 `gs_note_off`）。
   与 `noteAt` 的字段表看似对称、实际不对称：文档里按实际行为写。
6. **`cents` 可选，随音符一起下发并在该音符自己的帧上生效**。它曾经是一条独立的 `tuning` 消息、到达即写：
   宿主给未来的帧排音时，那条消息会去改**正在响的**同一个键，于是"预排"的音符会把当前声音弯走——同一个
   仓库里一个浏览器听得出、另一个听不出，就是这种时序差。微分音属于它自己的那个音符，所以现在走同一条事件。
7. **`noteAt` 与 `noteOnAt` 是完全的别名**（同一 `case` 分支、同一套校验）。保留两个名字是为了
   主机侧可读性，不是两种语义。
7. **上界淘汰是「丢最旧」，不是「拒绝新的」**：队列按帧排序，所以长期漏事件的宿主会**静默丢掉
   时间上最早**的音符（而不是丢掉刚发来的那条）。1024 条对「合法 lookahead 主机只持有几百条」
   有充裕余量；这是**事件条数**上界，和时间跨度无关。
