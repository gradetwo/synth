# 下一阶段完整开发计划（v1.79.0 起）

> 本文档接在 `docs/ROADMAP.md` 的进度看板之后：**第一节是现状审计**，**第二节是下一阶段的完整计划**
> （P5 工作流 / P6 声音 / P7 节点图与内存 / P8 工程与质量），每项都写明收益、要点、验收与门禁。
> 执行纪律不变：**每批 = 实现 + 单元/E2E 测试 + `npm run verify` 全绿 + 小步提交 + `npm run package`
> + 部署 + 中文文档同步**。无障碍（P3 a11y）仍按最初约定不做，除非明确改变约定。

## 一、现状审计（v1.78.0）

| 维度 | 状态 |
| :--- | :--- |
| 引擎 | Rust → wasm32（SIMD + 标量双版本运行时探测）、8 MiB arena 零分配、块 ABI 128–1024、**ABI v8**、参数 **139** 个 |
| 合成 | 双振荡器（5 张波表 + 单周期导入 + 采样导入 mipmap 抗混叠）、噪声三色、Unison/SPREAD、**OSC 2 → OSC 1 的 FM 相位调制、RING 环形调制与 SYNC 硬同步、每振荡器 sub、噪声混合**、双实例 Layer/Split、MPE、微调律（4 律 + .scl）、力度曲线 |
| 滤波 | LP/HP/BP/NT（Moog 阶梯）+ CMB 梳状 + FRM 共振峰；每振荡器独立滤波与等功率声像 |
| 调制 | 每声部 LFO ×2（RETRIG / ONE SHOT）、8 槽调制矩阵（目标含 **FM / RING**）、AFTER/RANDOM/KEY/VELO/WHEEL 源 |
| 效果 | 6 个效果节点 + **前馈路由图**（每节点 2 路输入带增益、扇出、无环）、可重排/并联、乒乓延迟+阻尼、卷积混响（IR 导入，单位能量）、合唱/镶边/移相/过载；**算法混响与四个插入效果每节点一套状态**，延迟与卷积单实例（内存上限） |
| 工作流 | 多轨分层播放 + 静音/独奏/音量/声像/时间偏移、缩略时间线（点按定位 + 拖拽整形）、**片段编排（折叠/复制/循环铺排，导出跟随）**、钢琴卷帘、录制 + 量化、A/B 循环 + 节拍器 + 预备拍、MIDI 导入/导出（format 1）、WAV/MP3 导出（跟随层混音）、预设 81 个、分享码（**deflate 压缩**，五分钟曲目 ≈1.5 KB）、布局场景、曲库持久化 |
| 平台 | PWA 离线（内容哈希缓存 + 用户确认更新）、深浅色/高对比、中英文、iPhone/iPad 六视口适配、触屏 ≥44 px |
| 门禁 | `npm run verify`：clippy（correctness/suspicious/perf）+ Rust **162** + Vitest **343** + lint + build + wasm（ABI/无全局构造/零分配）+ dist + 体积（总 1684.3/1700 KB、初始 JS 153.2/165 KB、CSS 19.0/22 KB、WASM 56.8/230 KB）+ 时域&频域音质 + 负载基准 + DSP 指纹 |
| E2E | Chromium **109** 项（本地判据）；WebKit/Firefox 由本地 `npm run nightly` 与 CI 的 `nightly` 作业（`on.schedule`）跑 |
| 性能 | 密集负载均值 ≈250 µs/块（预算 2667 µs），挂 2 秒 IR 后均值 ≈330 µs、最差块 ≈1.2 ms；六个混响后 arena 仍余 **3603 KB** |
| 已知取舍 | 延迟/卷积单实例（内存）；`songs.ts` 未按需化；本机 WebKit 只有软件渲染（Weston 1.8 fps、Xvfb 0.7 fps、Docker 不可用），**本地 WebKit 统一走 Weston**（`npm run test:e2e:webkit:wayland`），真机与 CI 是最终判据 |

已完成的历史阶段（详见 `docs/ROADMAP.md`）：P0–P2 核心、A1–A9 音质项、G2/G3 工程项、
C 多轨与时间线、B 分层与分享、A 效果路由图（引擎 + 编辑器 + 每节点状态）。

## 二、下一阶段完整计划

排序原则：**用户每天用得到的工作流 → 音色能力 → 最贵的引擎重构 → 贯穿的工程与质量**。
括号里是「收益 / 成本 / 建议批数」。

### P5 工作流补完（高 / 中 / 4 批）

**P5.1 时间线编辑二期** — ✅ v1.80.0 完成
- 已做：缩略时间线加「编排 / 音符」两种模式（一个手势不能同时表示「移动整层」和「移动这个音符」，所以给出显式开关，默认仍是原来的编排行为）；音符模式支持点选、拖动改位置、拖右缘改长度、双击删除、1/16 吸附与边界限制；选中后出现微调按钮（提前/推后、缩短/加长、删除）给手机用。
- 共享会话：文档 + 撤销历史搬到 `src/state/roll.ts`（`rollSession`），钢琴卷帘改为渲染它——两边**同一份数据、同一套撤销**；每次编辑即时写入曲库并 `store.mark()`，所以应用级撤销也覆盖编曲改动；内置曲目第一次编辑自动存副本并提示。顺带修掉「卷帘保存/导出多轨文件会压成单轨」（新增 `songLayerToRoll` / `withLayerNotes` / `rollToSeconds`），播放器预览重载不再丢掉层混音（`midiPlayer.load(song, {keepMix:true})`）。
- 验收：单测（吸附、边界与负向拖动、命中的是哪个音符、会话的写入/撤销/认副本/跟随外部改动）；E2E（时间线拖音符 → 卷帘同步 → 卷帘里 Ctrl+Z 撤销 → 重开仍在；应用级撤销；手机视口用按钮改长度且不溢出）。

**P5.2 曲目编排（片段）** — ✅ v1.83.0 完成
- 已做：`src/midi/clips.ts` 定义片段（自己的相对音符 + 时间线位置 + 循环窗口 + 铺排次数 + 所属层）；`song.notes` 与每层 `tracks[].notes` 始终是**展开结果**，所以播放器、卷帘、分享码、MIDI/WAV/MP3 导出都不需要认识片段；折叠一层后听感逐音符不变（窗口按整小节向上取整）；没被折叠的层照原样播放；窗口边界裁切、重叠片段相加、上限（窗口 600 s、64 次铺排）。
- 交互：层条新增片段轨道（折叠 / 前后移一个窗口 / 复制 / 窗口 ±25% / 铺排 ±1 / 删除，块宽=整个编排长度、循环处画分隔线）与卷帘的片段选择器（有片段时卷帘编辑的是所选片段的内容）。
- 门禁：曲库 schema **2 → 3**（加法式：无片段的老曲目读回行为不变，`migrate.test.ts` 留了 v2 曲库样本）；读取时**按片段重新展开**而不是信任存下来的平面列表（`library.test.ts` 两条：重展开、坏片段丢弃后仍可播放）。
- 验收：单测 311 → **335**（展开时间对齐 ±1 ms、循环次数、裁切、重叠、层隔离、折叠等价、上限、校验与迁移）；E2E **106 → 107**（折叠 → 循环 3 次 → 复制 → 重载编排仍在 → 导出 MIDI 再导入：6 个音符、时长一致）。

**P5.3 速度与拍号（tempo map）** — ✅ v1.86.0 完成
- 已做：`src/midi/tempo.ts`（以拍为界的多段 BPM + 拍号；`beatsToSeconds`/`secondsToBeats` 段边界精确、`gridStepAt` 让小节网格随拍号、`barBeatAt` 读数、`normalizeTempoMap` 校验、`withTempoMap` 写回）；节拍器改为按**拍**步进（每拍经地图换成时间），重音/预备拍同源；播放器面板新增速度段编辑行与 `小节.拍` 读数；SMF 读写 tempo(0x51)/拍号(0x58)，秒↔tick 走地图（单速曲目输出字节不变）。
- 验收：单测 8 项（段边界 beats↔seconds 互逆 ±1 ms、`segmentAtBeat`、小节计数随拍号重启、`gridStepAt` 3/4→3、校验与钳位、**MIDI 往返**：两段速度 + 3/4 经自家 `parseMidi` 读回同一张表且音符位置 ±1 ms、单速曲目不生成地图）；E2E 1 项（改 BPM/拍号 → 读数 1.3/2.1 跟随 → 加第二段 → 重载保持 → 开节拍器 + 删除段）。
- 说明：**音符仍是秒**（演奏本身），换速度只改网格/节拍器/读数/文件，不改演奏位置——「把演奏按新速度重新计时」是另一件事，已记在计划的风险项里。

**P5.4 录音 take 与叠加** — ✅ v1.91.0 完成
- 已做：`MidiTake{id,name,layer,notes,createdAt?}` + `MidiSong.takes?/takeId?`（`src/midi/takes.ts` 首屏校验、`take-edit.ts` 懒 chunk 编辑、`state/recording.ts` 统一三条录音入口）；**叠加=每次录完新建 take**（内容 = 当前 take 或该层音符 + 新录），新 take 选中、旧的全留；同音高 50ms 内为重击→替换（避免力度加倍/flam），每层上限 8 退休最旧；`song.notes`/`tracks[]` 仍是展开结果，所以播放/卷帘/导出/分享自动跟随当前 take，**分享码带全部 take + takeId**（MIDI 导出仍是当前 take）；schema **3→4** 加法式（旧档读回不变、`unwrap` 仍拒更新、`migrate.test.ts` 留 schema-3 样本）。
- UI：播放器面板 take 行（chip 切换试听 / 合并 / 删除），触屏 ≥36 px（`pointer: coarse` 44 px）；录音走 `finishRecording`（沿用量化、一个撤销步、内置曲目先复制）。
- 验收：`takes.test.ts` 10 项 + `recording.test.ts` 4 项 + `migrate.test.ts` 2 项（叠加不丢音符、重击规则、上限退休、选中 take 驱动层与 MIDI 导出字节、卷帘写回、坏数据、重载保持、分享码 take 往返）+ E2E「录两次→切 take→层内容不同→重开保持→合并→删除后仍播」。
- 顺带修掉一个预算隐患：更新横幅只需要最新一条标题，却因 import 整个 `CHANGELOG` 把 108 条历史拉进首屏 chunk（加一条更新记录就顶破 165 KB）。现把最新条目拆到 `src/changelog-head.ts`（横幅只读它，`changelog.test.ts` 锁住与 `CHANGELOG[0]` 一致），历史留在懒加载面板，`release.mjs` 读两个文件做同一套校验；**首屏 JS 165.0 → 127.3 KB**。

### P6 声音能力（高 / 中高 / 5 批）

**P6.1 FM / PM 与环形调制** — ✅ v1.82.0 完成
- 已做：`OSC_FM`（OSC 2 → OSC 1 相位调制，平方曲线、满量程 2 个周期）与 `OSC_RING`（环形调制干湿量，`sqrt(l1·l2)` 电平补偿）两个新参数，默认 0；C 桥接层新增 `gs_voice_osc_pm_block`，按样本**放置**载波相位（用 DaisySP 的 `Phase()`/`PhaseInc()`），**不是累加偏移**——累加会把调制信号积分成另一种亮得多的调制，本轮由「与解析解逐谐波比对」的单测当场抓出；调制矩阵新增 `ModDst::Fm` / `ModDst::Ring`，所以包络/LFO/矩阵都能扫它们；OSC 1 模块多了两个旋钮。
- 验收：Rust 时域 + 频域 6 项（`sin(x + β sin x)` 的贝塞尔边带与解析频谱逐谐波一致、深度→边带数严格单调、环形调制的和/差频与载波/调制器抑制、零点数与电平不变、unison 下有限且有边带、矩阵驱动两项）；`verify-audio` 8 项新门禁经**真 wasm**（含「FM 关闭时二次谐波 −138.8 dB」「环形调制后载波与调制器 0.0%」「FM 下零点数 120 vs 40」）；E2E 2 项（控件可达、分享码往返到空存储的接收方、矩阵目标列表末尾两项）。
- 指纹：默认参数不变，`npm run test:dsp` 指纹（rms 0.030806 · 12 bands）与 v1.81.0 完全一致，即**旧音色逐样本不变**；新能力由上述门禁单独盯住。

**P6.2 硬同步与子振荡器** — 🔶 v1.84.0 交付，**一条验收未达成（P6.2b）**
- 已做：`OSC1_SYNC`（主振 OSC 2 每周期把从振 OSC 1 相位拉回起点）、每振荡器 `SUB`（0/1/2 八度）+ `SUB_LEVEL`（正弦，无谐波可混叠）、全局 `NOISE_MIX`；C 桥接层 `gs_voice_osc_sync_block` 以 2× 过采样 + 95 抽头 Kaiser 低通（通带 19.2 kHz、阻带 −72 dB）降采样，重启点用主振的越零相位做**亚采样精度**对齐；默认全关，旧音色逐样本不变（指纹 rms 0.030806 不动）。
- 验收（已达成）：时域周期对齐（相关系数 0.99 vs 未同步 0.24–0.50）× 频域（非整数比时从振线让位 >20×，整数比不误判；sub 的八度/纯度/电平；噪声非谐波 +55 dB、基频不动）——Rust 4 项 + `verify-audio` 5 项（经真 wasm）+ E2E 1 项（控件与分享码往返）。
- **未达成**：`混叠 ≤ −60 dB`。原因不是没做抗混叠，而是**这个度量当前不可信**：同一度量对干净正弦给 −60 dB、对干净锯齿（门禁实测混叠 −84 dB）给 −41 dB，说明引擎输出在整秒尺度上并非严格周期，而它的非周期底噪（−40…−60 dB）正好压在待测目标上。详见 `docs/notes/hard-sync-aliasing.md`。
- **P6.2b（进行中，v1.85.0 完成第一步）**：
  - ✅ **第一步：相位累加器改双精度**。vendored DaisySP `Oscillator` 的 `phase_/phase_inc_` 由 `float` 改 `double`（波形运算仍 float）。纯正弦在「整秒 + 矩形窗 + 精确谐波 bin」下的离网能量 **−66 → −87 dB**（f32 相位累加是随机游走误差造成的裙边）；DSP 指纹未变（零兼容成本）；新增回归测试 `a_steady_sine_has_no_phase_noise_skirt`（断言 < −80 dB，回到 f32 会红）。
  - ✅ **第二步：度量终于可用**。上一版笔记里的「±23.4 Hz 乘性边带」是我自己的 Hann 窗泄漏假象（±23 bin 处旁瓣就在 −95 dB）；改用整秒 + 矩形窗 + 精确 bin 后发现底噪**不是稳态的**：起振后 21 ms 量是 −69 dB（限幅器峰值检波还在从起振瞬态恢复，那段慢增益变化就是被量到的东西），起振 0.53 s 后量是 **−90 dB**（比目标 −60 dB 低 30 dB）。新增回归测试 `hard_sync_keeps_the_slave_on_the_masters_grid`（稳定音符 + 精确 bin）。
  - 📊 **稳定测量下的真实数字**：未同步从振（1.41×）离网 **−0.0 dB**（度量确实在量「在不在网格上」）；硬同步锯齿 **−32 dB**、方波 −33 dB、三角 −50 dB；而**同音高的普通锯齿本来就在 −39 dB** 附近 —— 同步的真实混叠与「引擎自身锯齿的底子」同一量级。
  - ⏸ **第三步：暂时搁置（技术债，明确形态已定）**。两次尝试都失败并已回退（第一次用 DaisySP 的平滑值估台阶：−32 → −1.6 dB；第二次按建议改用**裸波形**估台阶：锯齿 −1.9 dB、三角 −1.9 dB、方波 −33.5 dB 等于没改善）。结论：**不要在 DaisySP 的输出上打补丁**——方波的两次跳变各自已被它的 polyBLEP 处理，再减一次裸台阶等于把带限好的信号切开；锯齿在重启点附近的平滑本身就是它带限的一半。正确形态是**给同步做一个专用带限振荡器**：直接输出朴素波形，在同一采样位置同时做「回绕的 BLEP」与「重启的 BLEP/BLAMP 残差」（位置用已验证正确的小数 `t`，幅度用同一套朴素波形差值），共享同一份相位判断。做完用稳定度量（整秒 + 矩形窗 + 精确 bin）复量，达标后把 `混叠 ≤ −60 dB` 写进门禁。两次尝试的实测数字与调试输出都在 `docs/notes/hard-sync-aliasing.md`。
  - 决策：先推进后面的批次（P5.3 起），P6.2 的这条验收作为**已知技术债**挂着；功能部分（同步 / sub / 噪声）已交付并有 Rust + 门禁 + E2E 用例保护。

**P6.3 滤波补全**（1 批 → 拆成 a/b 两批）
- **P6.3a SEM 连续多模** — ✅ v1.89.0 完成
  - 已做：`FilterType::Sem`（Rust 线格式 id **6**，追加在 Formant 之后）+ 新参数 `FILTER_MORPH`（id **145**，默认 0，其余类型忽略）；C 桥接层仍是同一个 SVF，按四规范点分段线性混合 `0 = L`、`1/3 = B`、`2/3 = L+H`（精确陷波）、`1 = H`；Rust→C 类型走显式 `bridge_id()`（`Sem → GS_FILTER_SEM = 4`），**不能用 `to_u32() as i32`**（`sem` 会静默变成低通——第一版就是这个状态，被 Rust 测试逮住）。
  - UI：滤波模块的类型选择加 `SEM`，且**只有**该档出现 MORPH 旋钮（其余六档不出现，避免假装有用）；`FilterCurve` 按 morph 画增益曲线（含陷波的下凹）；小标签写 `12dB/OCT · LP→BP→NT→HP`；分享码携带档位与位置。
  - 验收：频域（Rust 8 条 `sem_*`：四规范点响应、morph 必须是四个 tap 的**精确加权和**、两端 12 dB/oct 斜率、中心随 CUTOFF；真 wasm 门禁实测 `-11.68 dB` / `+12.19 dB`、带通中心高一个八度 **17 dB**、陷波中心 **−32.4 dB** 且两端 −0.4 dB）；时域（morph 与 cutoff 每 8/12 块急变不爆音、128/1024 两种块下 5 秒扫动有界，门禁实测峰值 0.128、最大样本步进 **0.040**）；E2E 2 条（桌面：旋钮只在该档出现 + 分享码往返；手机：可达且 ≥36 px）。
  - **两次会骗人的检查（已写进 `docs/notes/sem-filter.md`）**：① 默认补丁的调制矩阵里 `ENV→CUTOFF (0.55)` 与 `LFO→CUTOFF (0.8)` 是**开着**的，不清矩阵去量截止频率会得到「低通随频率上升 1.3 dB」；清掉后同一测量是 −11.96 dB / 两个八度。② 离线打开的坑与滤波无关，但同一轮发现（见 `docs/notes/pwa-offline.md`）。
  - 兼容：默认 `FILTER_TYPE` 不是 `sem`，旧音色连 `sem_mix` 都不进入；`test:dsp` 的 `rms 0.030806` 与 `verify:presets` 的 81 个指纹一字未动。
- **P6.3b 双滤波串联/并联 + 混合量** — ✅ v1.90.0 完成
  - 已做：参数 `FILTER_ROUTING`（146，0 关 / 1 串 / 2 并，默认 0）、`FILTER2_TYPE/CUTOFF/RES/DRIVE`（147–150）、`FILTER_BLEND`（151，并联线性混合）；C 桥接层每声部每侧第二份 SVF（`gs_voice_filter2_set/block`），第二级永远 12 dB（不复刻第一级的 24 dB 阶梯），comb/formant 按低通渲染（`FilterType::second_stage_id()`，**不能**用 `bridge_id()`——它带护栏断言）；并联时在进链路前保存"第一级看到的输入"，串联直接用第一级输出；**不再套第二个 DC 阻断器**（会让端点差出 0.05 %）。
  - UI：滤波模块加接法分段（OFF/SER/PAR），开启后出现第二级类型（LP/HP/BP/NT/SEM）与 CUTOFF 2/RES 2/DRIVE 2，并联时才出现 BLEND；`FilterCurve` 按「串联 = 两级偏离之和、并联 = 混合」画；小标签追加 `2-STAGE SER/PAR`。
  - 验收：Rust `src/dual_filter.rs` 13 条（端点逐位、加权和、串联乘积、逐带斜率、24 dB/oct、blend 单调、OFF 忽略第二级控制、时域无爆音）+ 真 wasm 门禁（串联乘积偏差 1.02 dB、一个 −26.6 dB vs 两个 −53.8 dB、blend 0.4→−27.5 dB 单调、切换峰值 0.172 / 最大步进 0.162）+ E2E 1 条（默认不出现 → SER 出现 → PAR 出现 BLEND → 分享码往返）+ 手机尺寸；详见 `docs/notes/dual-filter.md`。
  - 兼容：默认 `FILTER_ROUTING = 0` 时第二级完全不进入，`test:dsp` 0.030806 与 81 个预设指纹不变。

**P6.4 效果补强** — ✅ v1.92.0 完成（可选第三项瞬态整形未做）
- 已做：`crates/synth-core/src/fx_shaping.rs` —— **BitCrusher**（量化 + 采样保持 + 降采样前后各两级一阶 LP 抗混叠）与 **ShapingEq**（RBJ 低架/峰值/高架三段，f32 系数、`exp2` 代 `powf`、`#[inline(never)]` 去重）；参数 id **152–165**（`PARAM_COUNT` 166，`FxKind::Crush=7`/`Eq=8`），每节点一套 `crushers[6]`/`eqs[6]` 状态、音频线程零分配、默认全关；信号链与路由图两条路径都接入；UI 在 FX2 模块与路由图节点内联里可选，i18n 中英。
- 实测（真 wasm，先清调制矩阵）：1 kHz÷8 镜像 5000 Hz **−14.1 dB**、AA 再降 **20.1 dB**；8 kHz 折返 2 kHz **−0.8 → −195 dB**；干湿=0 镜像 **−152.1 dB**、EQ 架响应 **−0.00 dB**（Rust 另证逐位直通）；EQ 低架 +12@400 → 70/400/3.2k/16k = **+12.0/+6.0/0.0/0.0 dB**，峰 −9@1k → **−9.0/−2.2 dB**，高架 +9@3k → **+9.0/0.0 dB**；时域猛拉 peak **0.015**、最大步进 **0.010**、无 NaN。
- 测试：Rust **194**（`fx_shaping.rs` 10 条：量化网格、镜像随 divisor 移动、AA >12 dB、EQ 恒等与三段精度、mix 0 逐位直通、急变有界）+ `verify-audio` 新增 9 项 + E2E `e2e/fxgraph.spec.ts`（选 CRUSH→开关→mix→重开保持→再选 EQ，8 passed）。
- 兼容：`test:dsp` 0.030806 与 `verify:presets` 81 指纹均未动。
- **预算**：本特性 +17.3 KB（wasm +14.4、JS +2.9），dist 总量阈值 **1700 → 1712 KB**（`scripts/verify-budget.mjs` 有注释说明这笔账与 P8.5 要把它压回来）；首屏 JS 仍远低于 165 KB。
- 未做：瞬态整形（可选）。接手方式：照 BitCrusher 模式加 `Transient{attack_amt,sustain_amt,env}`，`params.rs` 从 166 起加 id 与 `FxKind` 变体，`engine.rs` 两条渲染路径照抄 Crush 的 arm，`verify-audio` 照抄「mix 0 无伪影 + 时域猛拉」两条。

**P6.5 过采样开关** — ✅ v1.93.0 完成
- 已做：参数 `OVERSAMPLE = 166`（`PARAM_COUNT 167`，默认 0），滤波模块 KBD 旁的 `2×` LED；`crates/synth-core/src/dsp/oversample.rs` 的 **63 抽头 Kaiser 窗低通**（fc=0.21、beta=8，对 2× 归一化）**同一系数表同时做插值与抽取**，round trip 是纯延迟；每声部滤波链（阶梯 `lp` + C 桥 SVF 家族 + P6.3b 第二级）整体在 2× 下跑，FX 链的 **DRIVE 插入**也在 2× 下跑（干路加同样的 31 样本延迟保证自身干湿对齐）；`comb`/`formant` 是线性滤波器，跳过。
- 实测（真 wasm，先清矩阵、满驱动、整秒矩形窗精确 bin + Parseval）：1× 非谐波能量 **−33.4 dB** → 2× **−59.5 dB**，**下降 26.1 dB**（要求 ≥12）；抽取器阻带单测：2× 域 30 kHz 不得变成 18 kHz 镜像。延迟补偿 **31 个 1× 样本（≈0.65 ms）**，`Engine::oversample_latency()` 上报并有单测。
- 指纹**双基线**：关 → `tests/dsp-baseline.json`（`rms 0.030806` 未动）；开 → 新 `tests/dsp-baseline-2x.json`（`rms 0.030946`，`npm run verify:dsp:2x`）；两条都进 `npm run verify`、CI 作业与 `verify-ci.mjs` 必需清单。
- 成本：`bench.mjs --oversampled`；16 音密集 patch **442 → 829 µs（16.6% → 31.1%）**，带 2 s IR 时 653 → 842 µs，仍在预算内；arena 3511 KB free、0 violations。
- 验收：`verify:audio` 新增 26.1 dB 门禁；Rust **201**（抽取器阻带、延迟上报、开关有界）；E2E `e2e/oversample.spec.ts`（默认关、双向可切、分享码/重载保持）；完整 `npm run verify` exit 0（dist 1679.9 ≤ 1712 KB）。文档：`docs/notes/oversampling.md`。
- **已知边界**：自由图 FX（`FX_GRAPH`）模式不过采样（缺逐节点延迟补偿，硬开会与干路错 31 样本成梳状；链模式为默认路径）；host 与 wasm 同场景混叠数字不一致（10.6 vs 26.1 dB，指向硬削波 codegen/末位差异），故 12 dB 硬线由 wasm 门禁持有、Rust 只钉 ≥8 dB；开关切换未做交叉淡化，整条路径一起移动 31 样本（不梳状）。

### P7 节点图二期与内存模型（中 / 高 / 3 批）

**P7.1 延迟与卷积的多实例** — ✅ v1.94.0 完成（池上限 2+2）
- 已做：`dsp/convolution.rs` 拆成**只读共享**的 `IrSpectra`（分区频谱 787 200 B + scratch 393 216 + 分析 FFT 32 768 = **1 213 264 B**）与每节点 `Convolver`（FDL 787 200 + in/out 24 576 + 变换 32 768 + acc 32 800 = **877 504 B**）；延迟每条线 **768 064 B**，在 `gs_init` 预留池（2 条 = 1 536 128 B），卷积缓冲推迟到**第一次 `gs_ir_import`（消息路径）**；按 slot 分配 + `sync_fx_pools`；`abi.rs` 导出 5 个池查询（**ABI 仍为 8**，无新参数 id）。
- **内存模型预研**（`docs/notes/fx-multi-instance.md`，实测 `gs_arena_free_bytes()`）：改动前 `gs_init` 后 3511.3 KiB → 现在未导入 IR **4770.2 KiB**（反而多 1258.9）；导入 2 s IR 后 **1871.5 KiB**；2 延迟+1 卷积 2728.4、1 延迟+2 卷积 2621.5，单实例增量与逐字节算值一致。**上限 2+2 而非 3+3**：3+3 导入 IR 后只剩约 258 KiB，低于 `bench:long` 的 512 KiB 断言（文档给出三种配置的账）。
- 验收：单测（两延迟实例与单独渲染**逐位相同**且时间线/反馈各自独立、第三个延迟直通且池报满、两卷积共享 IR 谱但尾部互不串音（静音那路 < 1e-6）、两节点输出为单节点 2 倍）；`verify-wasm` 新增池断言；`bench:long` arena 绿（4770 KB free、0 violations）；完整 `npm run verify` exit 0；E2E `fxgraph.spec.ts` 9 passed（含「两延迟并排、第三个被拒并显示原因、重开保持」）。
- **已知边界**：延迟 time/feedback 仍是**按种类**的全局参数（与仓库既有 FX 参数模型一致），本批实现的是**状态级独立**；要做每节点独立的 time/fb 需新增一批 per-node id 与旋钮，未做。导入 IR 后 arena 余量 1871.5 KiB，"最长 4 s 采样 + IR" 同时导入比过去更容易失败（导入路径已优雅返回 code 4 → 界面 `*.err.noRoom`，不会 abort）。链模式下含两个同类节点的旧 patch 从「复用一条线」变成「各自一条线」，工厂预设里不存在这种 patch（`verify:presets` 全绿）。
- 要点：**卷积**——IR 分区谱只读共享，每节点只分配 FDL 与输出缓冲；**延迟**——延迟线按「实例数 × 最长时长」的池在消息路径动态分配（音频线程零分配），UI 显示剩余可分配时长并封顶。
- 验收：单测（两个延迟节点时长/反馈互不影响、上限外拒绝并说明；两个卷积节点共享 IR 而尾部独立）；门禁：arena 断言 + `--long` 基准 + `verify-wasm` 越界检查。
- 风险：先做内存模型预研（Rust 原型 + 实测）再进 UI。

**P7.2 图内调制** — ✅ v1.95.0 完成
- 已做：参数 id **167–178**（4 条边 × SRC/DST/DEPTH，`MOD_SLOTS=4`、`GRAPH_GAINS=18`，`PARAM_COUNT 179`，depth 进 `is_continuous`）；引擎里 18 个节点增益各有一个一极平滑器，**有效增益 = clamp(base + Σ depth·src, 0, 4)** 每块解算一次；`graph_lfo/graph_lfo2` 是原始 ±1（不乘 `LFO_DEPTH`，那是 LFO 自己直达目标用的量），`graph_env` 是总线级包络（发声中声部 env 最大值，尾音仍开）；`gs_fx_mod_slots()` 新导出（**ABI 仍 8**）。UI：画布上 LFO1/LFO2/ENV 源卡片（位置进 `fxGraphPos`，`normalizeLayout` 白名单同步加 key）+ 每节点 I1/I2/O 三个目标端口 + 虚线调制线与深度 chip，外加键盘/手机可达的「MOD」4 行条。
- 边界（见 `docs/notes/fx-graph-modulation.md`）：**只有存在 live 边时**才走调制路径（并把 18 个增益过 ~20 ms 平滑器），**没有 live 边时直接用宿主值、零额外算术** → 深度 0 逐位直通（测试钉 `worstDiff === 0`）；dst 越界夹成 0=无边，结构上不可能成环（图仍是仅向前）；与 8 槽矩阵目的地集合不重叠、信号路径上相乘，二者并存。
- 验收：Rust **207**（+2）、Vitest **376**（fxgraph 10 个：深度 0 逐位直通、越界直通、两条边求和、**频域边带**（Hann/Goertzel，加边后 f0−lfo 边带 >5% 载波且 <载波）、极深 ±1 有界、与矩阵并存）、E2E `fxgraph.spec.ts` **11 passed**（拉线→线/条/深度可见→重开保持→改深度→删边；手机列表视图无边溢出）、完整 `npm run verify` exit 0（dist 1704.8 ≤1712）、`test:dsp` 0.030806 与 81 预设指纹未动。
- **已知边界**：效果参数（延迟 time/fb、混响 size/mix 等）按种类存、不是每节点，故不作为调制目标；「节点参数」= 节点自身的连线增益，每节点效果参数需另开一批 id 与旋钮。

**P7.2 图内调制**（1 批）
- 要点：LFO/ENV 作为节点，边带深度连到任意节点参数（与现有矩阵并存），区分音频率与块率调制。
- 验收：单测（图内调制与矩阵叠加正确、无环）；E2E（拉调制线 → 看得到变化 → 重开保持）。

**P7.3 图模板** — ✅ v1.95.0 完成（与 P7.2 同批发布）
- 已做：`src/state/fxtemplates.ts` —— `FxTemplate{id,name,nameKey?,params}` 存进**工作区** `LayoutState.fxTemplates`（`gs1:layout:v1`，**不进音色/分享码**），白名单 `FX_TEMPLATE_PARAM_IDS` 共 **49** 个（`FX_CHAIN1..6` + `FX_PARALLEL1..6` + `GRAPH_FROM_CHAIN_IDS`），明确排除 `FX_REVERB_MODE`/IR、各效果 on/mix、`FX_MOD*` 边与一切音色参数；读盘逐条夹取（kind 0..8、src 0..7、gain 0..4、开关 0/1、前向/自环读成未连接、第 3 条 delay 夹成 none 以守 P7.1 池上限 2；算法混响不占池故不夹），无可识别 id 的条目被拒绝、条目 id 不得遮蔽内置；`applyFxTemplate` 用 `setParams(...,{immediate:true})` **一次提交**（1 次通知 / 1 个 undo 步）；内置 5 例（经典串联、双延迟、并行混响、失真分路、空图）。
- UI：`FxGraphEditor` 头部模板 select + 「存为模板」+ 删除（i18n 16 个 key，`.fxg-tpl` 样式）。
- 验收：`fxtemplates.test.ts` 10 条（套用后白名单 49 个 id 与模板逐位一致、**非白名单 id 逐位不变**（`toBe` 非容差）、坏存档夹取/拒绝、存→新 store 读回→套用→删除、模板列表不进分享码且导入分享码不带进模板）；E2E `fxgraph.spec.ts` **13 passed**（+2：套用内置模板→图变化→fresh load 保持；存为模板→改图→再套用→重载后仍在列表并生效）；Vitest **391**、Rust 207、完整 `npm run verify` PASS、`bench:long` arena 绿。
- **已知边界**（见 `docs/notes/fx-templates.md`）：模板不在 scene 的 workspace 键里（scene 管模块排布，`resetLayout` 会清空模板列表，有意为之）；保存/套用跟随 store 的 `activeInstance`，而图编辑器显示实例 1 的 `snapshot`（既有的编辑器/实例显示不一致，本批未动）；分享码按现有语义仍会携带「被套用后的图参数」（它们就是 patch 参数），模板列表本身不进码。

**P7.3 图模板**（1 批，可与 P7.2 合并）
- 要点：把「图 + 节点参数」保存为工作区模板（不进音色），一键套用；内置 3–5 个示例（双延迟、并行混响、失真分路）。

### P8 工程与质量（中 / 低中 / 6 批，穿插做）

**P8.1 本地 WebKit 标准化** — ✅ v1.79.0 完成
- 已完成：本地默认 `npm run test:e2e:webkit:wayland`（headless Weston）、`test:e2e:webkit:desktop`（桌面会话最快）、nightly 自动选 Weston → Xvfb → headless 并在记录里带 display 列；Docker 路径实测不可用并记录；已写进 ROADMAP 与更新记录。
- 关键更正（v1.79.0）：慢的根因**不是**显示栈或内核——空白页上 Chromium/Firefox/WebKit 都是 60 fps；是应用页每帧成本（全屏模糊 + 画布每帧重绘 + 启动页动画）。修完后 Chromium 空闲 7.5 → 60 fps，本机全量 E2E 8.7 → 4.2 分钟。详见 `docs/notes/ui-frame-cost.md`。
- 新增守卫：`e2e/performance.spec.ts` 断言音频运行中界面 > 20 fps（抓「退回每帧重绘」，不考核机器性能）。

**P8.2 视觉回归** — ✅ v1.87.0 完成
- 已完成：`e2e/visual.spec.ts` —— 五个界面（模块网格 / 信号流 / 钢琴卷帘 / 播放器 / 启动页）× 深/浅配色 × 手机 390×844 / 桌面 1440×900 = **20 张基线**（`e2e/visual.spec.ts-snapshots/`，无损 PNG 入库）；阈值比较（单像素色距 0.05 + 像素占比 0.01，比 Playwright 默认紧一档），失败时留下 `-expected`/`-actual`/`-diff` 与「多少像素不同」的报错。
- 自证有效（两道）：套件内 `self-check › a painted style change is reported as a diff` 用 `addStyleTag` 刷品红并要求比较被拒绝；另做真实标定——`--accent` 单通道改 16/255 在默认阈值下**漏过**、在现在的阈值下**失败**（浅色桌面启动页 52 585 px / ratio 0.05），换色 `#ff4040` 则在深色桌面播放器失败（4 102 px / ratio 0.02）。
- 可选套件（`npm run test:visual` / `test:visual:update`）：文字栅格化是宿主字体栈的属性，本机基线不该判 CI runner 的对错，CI 的 `test:e2e` 会跳过它；详见 `docs/notes/visual-regression.md`（含「service worker 会喂上一个构建」这个实测坑与 `serviceWorkers: 'block'` 的修法）。
- 验收：基线入库 ✅；故意改样式让它失败 ✅（标定表 + 自证用例）。

**P8.3 音频指纹扩到预设** — ✅ v1.88.0 完成
- 已完成：`scripts/verify-presets.mjs` —— 81 个工厂预设各渲染同一句固定乐句（和弦 + 低音，1.8 s，每个预设独立 wasm 实例，跑法与 `store.applyPreset` 一致：params / routes / 第二层 + instance route），记录 26 个数字（rms、peak、左右平衡、24 个三分倍频程频段的 Goertzel 幅度），基线 `tests/preset-fingerprint.json`（每个预设一行，便于 review）；参数 ABI 变化先报错要求重生成。
- **变化必须显式确认**：`npm run verify:presets` 比较；`npm run presets:update -- --reason "..."` 才写新基线，理由存进 JSON。
- 实测敏感度（`pluck` 预设）：截止频率 −5 % 或包络衰减 +5 % 即失败（0.84 / 0.89 dB，比值 1.67 / 1.77），−1 % 微调通过；电平 −5 % 失败、−1 % 通过；同份 wasm 两次运行噪声底 **0.000 dB**。详见 `docs/notes/preset-fingerprint.md`。
- 验收：`verify:presets` 已进 `npm run verify` **与 CI verify 作业**（`verify-ci.mjs` 的必需清单同步，删步骤会红）；故意改一个预设参数实测失败 ✅。

**P8.4 解析器模糊测试** — ✅ v1.81.0 完成
- 已做：`src/fuzz.test.ts` 覆盖 8 类外部输入（分享码、补丁文件、`.gs1song`、MIDI、Scala、WAV、存储波形、Web MIDI 消息），每类 **10 000 个固定种子输入**（随机 + 合法文件变异 + 对抗性结构），断言「要么拒绝、要么合法、不抛未文档化异常、10 000 次 < 4 s（不卡死）」；失败信息带种子/序号/样本，复现即读错误信息。
- 修掉 5 个实际问题：MIDI 读取越界（截断文件抛 `RangeError`）、损坏字节造出 note 255/velocity 2.0、tempo=0 得 `Infinity` BPM、按声明轨道数分配（50 字节文件声称 65 535 轨 → 25 ms/数 MB，改为稀疏后 0.11 ms）、`decodeMidi` 对非 7 位数据返回越界 action。
- 结构调整：补丁文件解析抽成纯函数 `parsePatchFile`（`src/state/patchfile.ts`）+ 上限（参数 512、路由 64、名字 120、code 20 万）；每条修复在模块单测里留最小回归样本。文档：`docs/notes/parser-fuzzing.md`。
- 验收：Vitest 287 → **311**（模糊测试进 `npm test`，CI 每次跑这 10 万个输入，约 7 秒）；E2E 103 → **104**（补丁文件导入：导入成功 + 垃圾文件被拒 + 顶栏显示文件名）。

**P8.5 体积与启动预算** — ✅ v1.96.0 完成
- 已做：**真实节省** —— 图标 PNG24 → PNG8（75 423 → 25 271 B，**−48.97 KB**，RMSE ≤0.10% 肉眼不可分，尺寸/格式/manifest 引用不变；`scripts/gen-icons.mjs` 加 `shrinkPng()`，注释记下「临时文件必须用 `.png` 扩展名，`.png8` 会走质量差 12 倍的 PNG8 coder」这个坑）；**收紧阈值** —— dist 总量 1712→**1672 KB**、首屏 JS 165→**134 KB**、CSS 22→**21 KB**、最大 WASM 230→**70 KB**（均按实测 + 小余量，依据写在 `verify-budget.mjs` 注释里）；**新增首屏可交互时间门禁** —— `e2e/performance.spec.ts` 里用 `addInitScript` 在应用前装轮询、用页面自己的 `performance.now()`（零点=导航开始）测「`.start-btn` 在 DOM 且 enabled **且已发生 FCP**」（实测按钮 ~190 ms 进 DOM、首次绘制 ~1250 ms，只看 DOM 会报空屏时刻），FCP 由 `PerformanceObserver(paint, buffered)` 提供；阈值 **3200 ms**（整套并行最慢 2450 + ~30%）。
- 前后数字：dist 总量 **1711.7 → 1662.8 KB**；首屏 JS 131.2（不变）；启动可交互最慢 **2264 → 2096 ms**（整套并行 2450 ms）。
- **结论：`songs.ts` 不该拆**（实测记录在 `docs/notes/bundle-budget.md` 第四节）——用临时 manualChunks 量到 index.js raw −16.1 KB、新 chunk +16.2 KB，**dist 总量净 +93 B**，首屏 gzip 只 −3.7 KB；代价是 `midiLibrary` 是 eager 单例（构造函数里就 `midiPlayer.load` + persist），拆懒要把初始化改异步并动 store/PlayerPanel/两个 vitest，等于拿启动时间换 3.7 KB，不值。它在首屏的唯一路径：`App.tsx → store.ts → midi/library.ts → songs.ts`。
- **还能怎么省**（文档列出）：最大未利用项是 `wasm-opt -Oz`（两核 560 KB raw），本机无该二进制故未做。
- 验收：完整 `npm run verify` exit 0；Chromium E2E **124 passed / 5 skipped**；红线全绿（预设 81 不变、DSP 0.030806 / 2× 0.030946、零分配 0 violations、arena 4770 KB free）。

**P8.5 体积与启动预算**（1 批）
- 要点：初始 JS 150.8 → **140 KB gzip**（`songs.ts` 按需化或改曲包、指南/更新记录再拆）；新增「首屏可交互时间」预算（E2E 用 PerformanceObserver 测）。
- 验收：收紧后 `verify:budget` 仍绿；启动耗时不回退。

**P8.6 一键发布** — ✅ v1.79.0 完成
- 已做：`scripts/release.mjs` + `npm run release -- <version>`：发布前校验（版本/changelog 日期与中英双份/版本倒序/工作区干净）→ `verify` → Chromium E2E → `package` → `wrangler deploy` → 线上 `assets/index-*.js` hash 核对（含「边缘挂着旧清单就再部署一次」的重试）→ 附注 tag；任一失败即停，`--dry-run` 可演练。
- 同一套校验以 `npm run verify:release` 进本地 `verify` 与 CI verify 作业（CI 侧只要求日期真实且不在未来），文档见 `docs/notes/release.md`。
- 验收：dry-run 演练；失败路径（版本不符）实测退出码 1。

## 三、建议执行顺序（每批独立可交付）

| 批次 | 内容 | 依赖 | 预估 |
| :--- | :--- | :--- | :--- |
| 1 | P8.1 收尾 ✅ v1.79.0 + P8.6 一键发布 | — | 小 |
| 2 | P5.1 时间线编辑二期 ✅ v1.80.0 | — | 中 |
| 3 | P8.4 解析器模糊测试 ✅ v1.81.0 | — | 小 |
| 4 | P6.1 FM/PM + 环形调制 ✅ v1.82.0 | — | 中 |
| 5 | P5.2 片段编排 ✅ v1.83.0 | P5.1 | 中 |
| 6 | P6.2 硬同步 + sub 🔶 v1.84.0（P6.2b 待做） | — | 中 |
| 6b | P6.2b 混叠度量与非周期底噪 ✅ 度量已可用；专用带限同步振荡器 ⏸ 技术债 | P6.2 | 中 |
| 7 | P5.3 tempo map ✅ v1.86.0 | P5.2 | 中 |
| 8 | P8.2 视觉回归 ✅ v1.87.0 + P8.3 预设指纹 ✅ v1.88.0 | — | 中 |
| 9 | P6.3 滤波补全：P6.3a SEM 连续多模 ✅ v1.89.0；P6.3b 双滤波 ✅ v1.90.0 | — | 中 |
| 10 | P7.1 延迟/卷积多实例（预研 → 实现）✅ v1.94.0（池 2+2） | 内存模型设计 | 大 |
| 11 | P5.4 录音 take ✅ v1.91.0 | — | 中 |
| 12 | P6.4 效果补强 ✅ v1.92.0 / P6.5 过采样 ✅ v1.93.0 | — | 中 |
| 13 | P7.2 图内调制 ✅ v1.95.0 / P7.3 图模板 ✅ v1.95.0 | P7.1 | 中大 |
| 14 | P8.5 体积与启动预算（收尾）✅ v1.96.0 | 全部 | 中 |

## 四、风险与对策

| 风险 | 对策 |
| :--- | :--- |
| 时间线/片段改动动到播放器核心 | 先给数据模型加测试（对齐、循环、边界）再动 UI；片段进 schema 时带迁移样本 |
| FM/同步/过采样让 CPU 与混叠同时变差 | 每项都带时域+频域断言与基准门禁；过采样默认关，两种模式各记指纹 |
| 内存模型（P7.1）改坏 arena | 先原型与实测再实现；`--long` 基准的 arena 断言 + 越界检查 |
| 模糊测试挖出既有 bug | 每个发现留最小复现样本并修掉，进入解析器单测 |
| 本地 WebKit 慢导致夜间跑噪声 | 统一走 Weston；nightly 记录带 display 列；判据仍是空载整包 + CI |
| 视觉回归对字体渲染敏感 | 阈值化比较 + 只对关键视图做基线；差异产物保留 14 天 |

## 五、完成定义（每批通用）

- [ ] 实现 + 单元测试（Rust 与/或 Vitest）+（涉及交互时）Playwright E2E
- [ ] 涉及音频的批次：**时域与频域**都有断言；DSP 指纹变化需显式更新
- [ ] `npm run verify` 退出码 0（clippy / Rust / Vitest / lint / build / wasm / dist / 体积 / 音质 / 基准 / DSP）
- [ ] Chromium E2E 全绿；WebKit 用 `npm run test:e2e:webkit:wayland`（或桌面会话）跑相关用例，nightly 跑核心子集
- [ ] 小步提交（`feat|fix|test|docs(...)`），版本号随功能提交递增，更新记录与中文文档同步
- [ ] `npm run package` 产出 `release/gs1-synth-<ver>-{zip,dist.zip,tar.gz}`
- [ ] 应用有变化时部署 `synth.wangda.today` 并核对线上 hash 与 `dist/index.html` 一致
