# 解析器模糊测试 / Parser fuzzing

`src/fuzz.test.ts`。凡是读入**不是用户当场输入**的东西的解析器，都是程序的一道门：分享码、补丁文件、
`.gs1song`、MIDI 文件、Scala 音律表、WAV、localStorage 里的波形/包络。这些数据来自聊天软件、下载目录、
别人的手机。它们共同的契约只有一句：

> **要么拒绝，要么产出合法对象——绝不抛出没写进契约的异常，绝不卡死。**

## 一、怎么跑

- 每个解析器 **10 000 个输入**，固定种子（`makeRandom` = mulberry32，纯 32 位运算，跨平台/跨 Node 版本一致），
  失败信息里带 **种子 + 用例序号 + 可粘贴的样本**（字节给十六进制、文本给 JSON 片段），所以复现就是读错误信息；
- 三种输入形态混用，因为纯噪声很难进到深层代码：**随机字节/文本**、**合法文件的变异**（截断、翻位、把长度字段
  改成天文数字、尾部拼垃圾）、**对抗性结构**（超量参数、超长 key、深层嵌套、5 万字符的 code）；
- 断言分两层：`check` 只写**消费方依赖的不变量**（数值有限、在范围内、不超过上限），不是照抄解析器自己的实现；
- 每个解析器 10 000 次的总耗时也有预算（4 s），超了就是**卡死**而不是慢——本轮就靠它抓到了
  「一个 50 字节的文件声称有 65 535 条轨道」的放大问题。

## 二、覆盖的解析器

| 输入 | 解析器 | 预期 |
| :--- | :--- | :--- |
| 分享码 / 分享链接 | `decodePatch`、`readShareCode` | 拒绝或返回合法 `PatchPayload`；带曲目时 `parseMidi` 必须也能吃下 |
| 补丁文件 / `.gs1song` | `parsePatchFile`（`src/state/patchfile.ts`） | 拒绝或返回合法 `Preset` / 分享码 |
| MIDI 文件 | `parseMidi` | 只允许 `not a MIDI file`、`SMPTE time division is not supported` 两种异常 |
| Scala 音律表 | `parseScala`、`parseInterval` | 只允许 `scala.*` 异常（契约就是抛错） |
| WAV | `parseWav`、`decodeSamples16` | 拒绝或返回结构合法的缓冲 |
| 存储的波形 | `decodeUserWave` | 拒绝或返回有限样本的 cycle |
| 存储信封 | `unwrap` | 拒绝或返回 `{schema, data}` |
| Web MIDI 消息 | `decodeMidi` | 拒绝或返回**范围内**的 action（音符 0–127、力度 0–1、通道 0–15、弯音 −1…1） |

## 三、本轮发现并修掉的问题

1. **MIDI 读取器可以读越界**：`ascii(len)` / `u8()` 直接读 `DataView`，被截断的文件（文本事件声称的长度
   超过文件长度、音符事件只剩一个字节）会抛 `RangeError`。改为**全函数**读取：越界返回 0、游标不越界，
   轨道声明的结束位置也夹在文件长度内——损坏的文件是「尽力抢救」的对象，不是一个崩溃。
2. **损坏文件能造出非法音符**：数据字节本应是 7 位，`0xff` 会变成 note 255、velocity 2.0，一路带进播放器。
   现在在读取处就夹到 0–127、力度 ≤ 1。
3. **速度为 0 的 tempo 事件会算出 `Infinity` BPM**：现在忽略非正的 tempo（时钟回落到默认 120），
   与「文件根本没有 tempo 事件」同一条路径。
4. **谎报轨道数会造成放大**：`Array.from({length: trackCount})` 按**声明**分配，一个 50 字节、声称
   65 535 条轨道的文件要分配 6.5 万个数组（实测 25 ms、数 MB）。改成稀疏数组、有音符才建层：
   同一输入 **25 ms → 0.11 ms**（回归用例用 200 次循环 < 1 s 兜住，留了很大余量）。
5. **`decodeMidi` 对非 7 位输入返回非法 action**：声明类型是 `ArrayLike<number>`，来自录音器/测试/驱动的
   洞、`NaN`、300 都会变成 note 300 或力度 2.4。现在状态字节与数据字节分别夹取（状态保留高 4 位，
   否则 `0x90` 会变成 `0x70` 而不认识）。

6. **导入的音色文件在顶栏没有名字**（端到端测试顺带发现）：`applyPreset` 会把 `currentPresetId` 指向
   临时预设，但顶栏是在 `allPresets()` 里查找的，而导入的补丁不进曲库——于是声音换了、名字还是上一个。
   改为走 `store.currentPreset()`（它本来就处理临时预设）。

以上每条都在对应模块的单元测试里留了**最小回归样本**（`src/midi/smf.test.ts` 的
`parseMidi on corrupt files`、`src/audio/midi.test.ts` 的夹取用例）。

## 四、顺带的结构调整

- 补丁文件的解析从 `store.importPresetFile` 抽成纯函数 `parsePatchFile`（`src/state/patchfile.ts`）：
  解析与「装到引擎上」分开，前者才可被 10 000 次随机输入安全地调用。同时给文件加了上限
  （参数 512 条、路由 64 条、名字 120 字、code 20 万字符）——137 个参数的应用不可能写出更大的补丁文件，
  更大的只可能是垃圾或让人爆内存的尝试。
- `src/fuzz.test.ts` 进 `npm test`，所以 `npm run verify` 与 CI 每次都会跑这 10 万个输入（约 7 秒）。
