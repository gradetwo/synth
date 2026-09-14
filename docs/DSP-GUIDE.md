# GS-1 声学与信号处理技术指南（DSP-GUIDE）

> 本文档面向**懂信号处理但不懂本仓库**的读者，目标是两件事同时成立：
> ① 把本软件涉及的**全部声学与信号处理概念、术语**讲清楚（中英对照）；
> ② 把**每一个模块的技术原理**落到本仓库的真实实现上——文件名、常量、参数 id、实测数字、
> 以及「为什么这么选」。
>
> 本仓库是 `GROOVE SYNTH GS-1`：一个 Rust + WebAssembly 的网页合成器。
> Rust 核心在 `crates/synth-core/`，浏览器胶水在 `src/audio/`，门禁在 `scripts/`，
> 工程笔记在 `docs/notes/`。

---

## 0. 阅读约定与数字纪律

### 0.1 数字的溯源纪律（**最重要的一节**）

本文出现的每一个**实测数字**都来自下列三类来源之一，并在文中用括号标注：

| 来源类型 | 标注形式 | 示例 |
| :-- | :-- | :-- |
| 源码常量 / 注释 | 文件路径 + 行号或符号名 | `crates/synth-core/src/engine.rs` `VOICE_GAIN` |
| 工程笔记 | `docs/notes/<file>.md` §小节 | `docs/notes/band-limited-oscillators.md` §P9.7 |
| 门禁输出 / 脚本 | `scripts/<file>.mjs` 符号或基线 JSON | `tests/dsp-baseline.json` |

三条硬规矩：

1. **不许编数字。** 任何无法溯源到上述三处的数值，本文一律写「**未验证**」或「**未实测**」，不做插值、
   不做四舍五入到「好看」的数。
2. **区分「实测值」与「门禁阈值」。** 门禁阈值通常是「实测最差 + 5 dB」之类的顶棚。
   文中凡出现阈值，都尽量同时给出当时实测值与阈值，并说明二者关系。
3. **区分「当前值」与「历史值」。** 本仓库的基线随批次演进被**记账式重录**过多次
   （`VOICE_GAIN 0.22 → 0.44` 一次性把所有 DSP 指纹乘了 ×2）。旧笔记里保留的是**当时**的数字，
   本文引用时标注为「历史」并给出当前值，避免把两代数字混用。

### 0.2 一个贯穿全文的例子：为什么「同一份代码」会有两个不同的数

`docs/notes/oversampling.md` §「教训二」记录了一次真实的分歧：同一个 2× 过采样场景，

| 构建 | 1× 非谐波能量 | 2× 非谐波能量 | 降幅 |
| :-- | --: | --: | --: |
| wasm 门禁（`scripts/verify-audio.mjs`） | −33.4 dB | −59.5 dB | **26.1 dB** |
| host `cargo test`（同一份源码） | −33.0 dB | −43.6 dB | **10.6 dB** |

1× 对得上，2× 差 **16 dB**，归因指向 host 与 wasm 在硬削波路径上的 codegen / `f32::exp2`
末位差异（该归因是**定性判断**，没有逐条反汇编证据——笔记原文如此）。
结论：**12 dB 的硬线由 wasm 门禁持有**，Rust 单测只钉方向（≥8 dB）与抽取器带宽。
这条纪律（「不同探针的数不能互相替代」）在第三部分会展开成一整节方法论。

### 0.3 术语写法

- 术语首次出现给「中文（English）」，附录 A 汇总成中英对照表（≥80 条）。
- 参数名一律用 `crates/synth-core/src/params.rs` 的 `id::*` 常量名（它同时是 UI 与分享码的线格式）。
- 代码标识符、文件名、常量名保持英文原样，不翻译。
- 「dB」在不特别说明时指**相对量**；「dBFS」指相对**数字满刻度**（full scale）的绝对电平。

---

## 目录

- [0. 阅读约定与数字纪律](#0-阅读约定与数字纪律)
- [第一部分 · 基础理论与术语（按知识分类）](#第一部分--基础理论与术语按知识分类)
  - [1. 数字音频基础](#1-数字音频基础)
    - [1.1 采样、采样率与奈奎斯特定理](#11-采样采样率与奈奎斯特定理)
    - [1.2 混叠与折回公式](#12-混叠与折回公式)
    - [1.3 量化、位深与抖动](#13-量化位深与抖动)
    - [1.4 dB、dBFS 与标度](#14-dbdbfs-与标度)
    - [1.5 浮点与定点、f32 与 f64 的分工](#15-浮点与定点f32-与-f64-的分工)
    - [1.6 真峰值（true peak）与采样峰值](#16-真峰值true-peak与采样峰值)
  - [2. 时域度量](#2-时域度量)
    - [2.1 峰值、RMS 与波峰因数](#21-峰值rms-与波峰因数)
    - [2.2 包络与检波器](#22-包络与检波器)
    - [2.3 最大相邻步进与 Bernstein 上界](#23-最大相邻步进与-bernstein-上界)
  - [3. 频域分析](#3-频域分析)
    - [3.1 DFT 与 FFT](#31-dft-与-fft)
    - [3.2 窗函数](#32-窗函数)
    - [3.3 频谱泄漏、旁瓣与 bin 分辨率](#33-频谱泄漏旁瓣与-bin-分辨率)
    - [3.4 精确 bin（exact bin）与整周期条件](#34-精确-binexact-bin与整周期条件)
    - [3.5 Parseval 与「非谐波能量」](#35-parseval-与非谐波能量)
    - [3.6 谐波失真：THD、THD+N 与互调](#36-谐波失真thdthdn-与互调)
  - [4. 插值、采样率转换与带限](#4-插值采样率转换与带限)
    - [4.1 插值器家族：最近邻、线性、三次、窗 sinc](#41-插值器家族最近邻线性三次窗-sinc)
    - [4.2 1/N² 律与其失效条件](#42-1n²-律与其失效条件)
    - [4.3 BLEP 与 BLAMP](#43-blep-与-blamp)
    - [4.4 过采样（oversampling）](#44-过采样oversampling)
    - [4.5 延迟补偿（PDC）](#45-延迟补偿pdc)
    - [4.6 mipmap 与分级带限](#46-mipmap-与分级带限)
  - [5. 滤波器](#5-滤波器)
    - [5.1 一阶滤波器与双二阶（biquad）](#51-一阶滤波器与双二阶biquad)
    - [5.2 ladder（阶梯滤波器）与零延迟反馈](#52-ladder阶梯滤波器与零延迟反馈)
    - [5.3 SVF / SEM 状态变量滤波器](#53-svf--sem-状态变量滤波器)
    - [5.4 梳状滤波器与共振器](#54-梳状滤波器与共振器)
    - [5.5 共振、自激、过渡带与阻带](#55-共振自激过渡带与阻带)
    - [5.6 群延迟、线性相位与串联/并联路由](#56-群延迟线性相位与串联并联路由)
  - [6. 非线性与动态处理](#6-非线性与动态处理)
    - [6.1 饱和、软削波与膝点](#61-饱和软削波与膝点)
    - [6.2 前瞻限幅器](#62-前瞻限幅器)
    - [6.3 释放时间与保持](#63-释放时间与保持)
    - [6.4 为什么「天花板」是绝对电平](#64-为什么天花板是绝对电平)
  - [7. 调制与包络](#7-调制与包络)
    - [7.1 ADSR 包络](#71-adsr-包络)
    - [7.2 LFO](#72-lfo)
    - [7.3 调制矩阵与调制总线](#73-调制矩阵与调制总线)
    - [7.4 控制率、块率与参数平滑](#74-控制率块率与参数平滑)
  - [8. 时间与调制类效果](#8-时间与调制类效果)
    - [8.1 延迟线、反馈与梳状滤波](#81-延迟线反馈与梳状滤波)
    - [8.2 算法混响与卷积混响](#82-算法混响与卷积混响)
    - [8.3 合唱、镶边与相位器](#83-合唱镶边与相位器)
  - [9. 失真类效果](#9-失真类效果)
    - [9.1 位粉碎（bit-crush）](#91-位粉碎bit-crush)
    - [9.2 驱动（drive / overdrive）](#92-驱动drive--overdrive)
    - [9.3 瞬态整形（transient shaping）](#93-瞬态整形transient-shaping)
  - [10. 合成法](#10-合成法)
    - [10.1 减性合成](#101-减性合成)
    - [10.2 波表合成与带限 mipmap](#102-波表合成与带限-mipmap)
    - [10.3 硬同步](#103-硬同步)
    - [10.4 FM 与环形调制](#104-fm-与环形调制)
    - [10.5 采样器](#105-采样器)
    - [10.6 复音、语音分配与等功率声像](#106-复音语音分配与等功率声像)
  - [11. 实时工程约束](#11-实时工程约束)
    - [11.1 块处理与渲染量子](#111-块处理与渲染量子)
    - [11.2 零分配与 arena](#112-零分配与-arena)
    - [11.3 SIMD 与标量双核](#113-simd-与标量双核)
    - [11.4 确定性](#114-确定性)
    - [11.5 体积、带宽与 wasm-opt](#115-体积带宽与-wasm-opt)
- [第二部分 · 本合成器的模块与设计原理](#第二部分--本合成器的模块与设计原理)
  - [12. 引擎总览与信号流](#12-引擎总览与信号流)
  - [13. 振荡器](#13-振荡器)
  - [14. 波表与单周期导入](#14-波表与单周期导入)
  - [15. 采样器与 mip 链](#15-采样器与-mip-链)
  - [16. 硬同步](#16-硬同步)
  - [17. 滤波器与双级路由](#17-滤波器与双级路由)
  - [18. 包络与调制矩阵](#18-包络与调制矩阵)
  - [19. 效果链与自由路由图](#19-效果链与自由路由图)
  - [20. 效果器逐个实现](#20-效果器逐个实现)
  - [21. 混响：算法与卷积](#21-混响算法与卷积)
  - [22. 位粉碎、整形 EQ 与瞬态整形](#22-位粉碎整形-eq-与瞬态整形)
  - [23. 限幅与输出级](#23-限幅与输出级)
  - [24. 声部分配、复音与双实例](#24-声部分配复音与双实例)
  - [25. 频谱分析与 UI 计量](#25-频谱分析与-ui-计量)
- [第三部分 · 测量与门禁方法论](#第三部分--测量与门禁方法论)
  - [26. 为什么需要两把独立的尺子](#26-为什么需要两把独立的尺子)
  - [27. 两把尺子的参数与失效模式](#27-两把尺子的参数与失效模式)
  - [28. DSP 指纹与预设指纹](#28-dsp-指纹与预设指纹)
  - [29. bench 与实时预算](#29-bench-与实时预算)
  - [30. 内容守卫](#30-内容守卫)
  - [31. 为什么只能同机同探针 A/B](#31-为什么只能同机同探针-ab)
  - [32. 本文档发现的既有文档 / 代码不一致](#32-本文档发现的既有文档--代码不一致)
- [附录 A · 中英术语对照表](#附录-a--中英术语对照表)
- [附录 B · 关键参数 id 索引](#附录-b--关键参数-id-索引)
- [附录 C · 已知边界与失败过的方案](#附录-c--已知边界与失败过的方案)
- [附录 D · 延伸阅读](#附录-d--延伸阅读)

---

# 第一部分 · 基础理论与术语（按知识分类）

---

## 1. 数字音频基础

### 1.1 采样、采样率与奈奎斯特定理

**采样（sampling）** 把连续时间信号 $x(t)$ 变成离散序列 $x[n] = x(n/f_s)$，$f_s$ 是**采样率
（sample rate）**。本合成器在浏览器 AudioWorklet 里按宿主的采样率运行，门禁统一用
**$f_s = 48000$ Hz**（`scripts/verify-audio.mjs` `SR = 48000`、`scripts/bench.mjs` 同）。

**奈奎斯特频率（Nyquist frequency）** 是 $f_s/2$，即 24 kHz @ 48 kHz。
**奈奎斯特定理（Nyquist–Shannon sampling theorem）**：若信号带宽严格小于 $f_s/2$，
则采样不丢信息，可用理想低通从样本重建原信号。

本仓库对 Nyquist 的处理有两个值得注意的实现细节：

- 滤波器截止**永远钳在 Nyquist 以下**。`LadderFilter::set` 用
  `freq.clamp(20.0, sr * 0.45)`（`crates/synth-core/src/dsp/ladder.rs`），注释说明原因：
  `tan()` 在 $f_s/2$ 处爆炸。`crates/synth-core/src/engine.rs` 在 2× 模式下把钳位改成
  `cutoff.clamp(20.0, sr_os * 0.45)`，因为「截止频率要贴着**滤波器实际运行的那个采样率**的
  一半 Nyquist」。
- 波表的**级选择**（mip level）直接由 Nyquist 判定：
  `Table::level_for` 检查 `freq_hz * max_harmonic <= nyquist`
  （`crates/synth-core/src/dsp/wavetable.rs`）。

### 1.2 混叠与折回公式

**混叠（aliasing）**：任何频率分量 $f > f_s/2$ 在采样后会被**折叠**回基带，落到

$$f_{\text{alias}} = \left| f - k \cdot f_s \right|, \quad k = \operatorname{round}(f / f_s)$$

等价写法：对**整数倍频**分量 $k f_0 > f_s/2$，它折回到 $|k f_0 - n f_s|$。
这条公式在仓库里是**可验证的**，不是教科书装饰：`docs/notes/band-limited-oscillators.md`
§P9.5 把 C7（$f_0 = 2093$ Hz）的折回谱线逐条算了出来：

> **4047 = 48000 − 21·2093**、**6140 = 48000 − 20·2093**、**8233 = 48000 − 19·2093**、
> **10326 = 48000 − 18·2093**、**1954 = 48000 − 22·2093 Hz**（出处：`docs/notes/band-limited-oscillators.md` §P9.5）

关键认知：**折回线不落在谐波网格上**。这一点决定了本仓库「非谐波能量」这把尺子的形状，
也决定了为什么不能用「半格 bin」去探测混叠（见 §3.4 与 §27）。

另一个常见陷阱是**采样率转换**中的混叠：把 48 kHz 录音加速 4 倍播放时，原始 8 kHz 的内容
跑到 32 kHz，越过 24 kHz 的 Nyquist，折回 16 kHz。这正是采样器需要 mipmap 的原因
（`crates/synth-core/src/dsp/sampler.rs` 模块注释第一段）。

### 1.3 量化、位深与抖动

**量化（quantization）** 把连续幅度映射到有限个电平。$b$ 位的均匀量化器步长（step size）是

$$\Delta = \frac{2}{2^{b}} \quad \text{（对 } [-1, 1) \text{ 的满幅范围）}$$

本仓库把这条公式**直接写进代码**：`crates/synth-core/src/fx_shaping.rs` 的位粉碎器用
`step = 2 / 2^bits`，`bits` 范围 4..16（参数 `FX_CRUSH_BITS`，id 153）。

**量化噪声（quantization noise）** 在理想情况下近似白噪声，其 RMS 约为 $\Delta/\sqrt{12}$，
信噪比近似

$$\text{SQNR} \approx 6.02\,b + 1.76 \ \text{dB}$$

（这条是教科书结论，本仓库没有单独的 SQNR 门禁——**未验证**。）

**抖动（dither）**：加入极低电平的随机/确定性噪声，把量化误差的**相关性**打散，
避免低电平信号变成「方波化的颗粒噪声」。

本仓库有一处**非常规用途的 dither**，值得单独记一笔：主总线上加了一个
**±1e-15 的交替（alternating）确定性扰动**，左右声道反号：

```rust
let dither = if i & 1 == 0 { 1e-15 } else { -1e-15 };
self.fx_l[i] = self.mix_l[i] + dither;
self.fx_r[i] = self.mix_r[i] - dither;
```

（`crates/synth-core/src/engine.rs`，主总线交接给 FX send 处）

它的**目的不是**改善量化，而是**避免非规格化数（denormal）**：注释原文

> The ±1e-15 alternating dither is **-300 dBFS** and inaudible, but it keeps the reverb/delay
> feedback paths out of denormal range, where wasm has **no flush-to-zero** and a decaying
> tail can cost **100x the CPU**.

也就是说：这是**实时工程**手段，不是音频质量手段。−300 dBFS 远低于任何可闻阈值。

### 1.4 dB、dBFS 与标度

**分贝（decibel, dB）** 是功率比的常用对数：$10\log_{10}(P_1/P_0)$；对幅度则是
$20\log_{10}(A_1/A_0)$。

**dBFS（decibels relative to full scale）**：数字域的绝对电平，0 dBFS = 满刻度。
本仓库的满刻度定义在 $|x| = 1$（`soft_limit` 的上界、`bench` 的 `peak <= 1.0` 断言）。

几个本仓库实际用到的电平锚点：

| 量 | 数值 | 出处 |
| :-- | --: | :-- |
| 静音计量下限 `METER_FLOOR` | `1.0e-6`（−120 dBFS） | `crates/synth-core/src/engine.rs` |
| 交替 dither | ±1e-15（约 −300 dBFS） | 同上 |
| 软削波膝点 `soft_limit` `KNEE` | `0.82`（约 −1.72 dBFS） | `crates/synth-core/src/dsp/util.rs` |
| 前瞻限幅器天花板 `LIMIT_CEILING` | `0.95`（约 −0.446 dBFS） | `crates/synth-core/src/engine.rs` |
| 2× 过采样模式的内建延迟 `OS_LATENCY` | 31 个 1× 样本 | `crates/synth-core/src/dsp/oversample.rs` |

关于「整机比满幅低多少」这件事，本仓库有过一次**公开的自我纠正**：
早期文档写「整机低约 13 dB」，后来实测发现干净满幅正弦只有 **−18.82 dBFS**，
那 5.6 dB 的差额来自等功率声像（−3.01）、振荡器正弦幅度 0.9（−0.92）
和 ladder 通带损失（≈−1.7）：

> (The often-quoted "-13 dB" ignored the last 5.6 dB.)
> （`crates/synth-core/src/engine.rs` `VOICE_GAIN` 注释；详见 `docs/notes/loudness.md`）

### 1.5 浮点与定点、f32 与 f64 的分工

本仓库**全部使用浮点**（定点只出现在「位粉碎器」这个刻意的效果里）。
但 f32/f64 的分工是一条**贯穿多个 bug 的工程主线**：

- **音频采样值**：f32（`gs_left_ptr` 返回 `*const f32`、WASM 线性内存里是 f32 数组）。
- **相位/位置累加器**：在**精度敏感**的地方用 f64。
  - 硬同步与 DaisySP 振荡器：`phase_` / `phase_inc_` 从 `float` 改成 **`double`**，
    纯正弦的离网能量从 **−66 dB** 降到 **−87 dB**（步进误差从 ~1e-7 到 ~1e-16，
    裙边整体下沉 **21 dB**）（`docs/notes/hard-sync-aliasing.md` §「第一步」）。
  - 采样器读位置 `ReadState.position` / `direction` 以及 `render` 的步进：**f64**，
    原因是它以「level 采样数」为单位、最长到 192000，f32 的 ULP 在末位约 **1.5e-2 个采样**；
    而波表的 `phase ∈ [0,1)` 精度高约 **10⁴ 倍**（`crates/synth-core/src/dsp/sampler.rs` `ReadState` 注释；
    `docs/notes/band-limited-oscillators.md` §P9.7）。
- **导入/分析路径的 FFT**：f64（`crates/synth-core/src/dsp/util.rs` `fft`），因为不在音频线程上。
- **查找表本身**：仍是 f32（`sampler.rs` 注释：「The table itself stays f32; only the accumulator
  and the wrap arithmetic need the wider type.」）。

f32 位置造成的伪影有**明确的签名**：因为它是一个**无缝 loop** 的读位置，误差不会平均掉，
而是以 **loop 重复率**为间隔形成一族**边带（sideband）**。实测（`docs/notes/band-limited-oscillators.md` §P9.5）：

- C7（2093 Hz）整段 loop 重复率 8.18 Hz → 边带在 **2084.84 / 2101.50 Hz**（= 2093 ∓ 8.2 Hz）；
- loop 减半后间距变 **±16.4 Hz**（**2076.60 / 2109.38**），地板从 **−35.3** 改善到 **−45…−48 dB**；
- JS 用 f32 位置重放得到 **−35.2 dB**，最强三条与引擎**逐 bin 相同**；换 f64 后 **−44.7 dB**，
  loop 边带**消失**，只剩插值像（**16605 = 48000 − 15·2093**）。

P9.8 版本（`position` 最长 192000、ULP ≈ 1.5e-2）的同一对照：f32 **−27.3 dB**、
最强离格线 **22882.69 / 22882.51 / 22882.87 Hz**（间隔 0.18 Hz = FFT bin）；f64 **−30.1 dB**，
线换成 **22883.97 / 22883.79 / 22884.16 Hz**——「与 f32 的那组**不再是同一批频率**」。

### 1.6 真峰值（true peak）与采样峰值

**采样峰值（sample peak）** 是样本绝对值最大值；**真峰值（true peak / inter-sample peak）**
考虑样本之间的连续波形，因为 D/A 之后的模拟信号可能超过所有样本点的幅度。

本仓库的估计方法极简（`crates/synth-core/src/engine.rs` 限幅器循环内）：

```rust
// True-peak estimate: the inter-sample peak of a linear ramp is the
// average of neighbouring samples, which catches most of what a
// sample-peak meter misses.
let interp = ((in_l + out_l) * 0.5).abs().max(((in_r + out_r) * 0.5).abs());
self.true_peak = self.true_peak.max(interp).max(out_l.abs()).max(out_r.abs());
```

即：**相邻样本的线性平均**作为样本间峰值的上界估计。
这是一个**廉价近似**，不是 ITU-R BS.1770 / EBU 定义的真峰值表（那种要 4× 过采样 + 相位补偿滤波器）。
诚实结论：**本仓库不实现标准 true-peak 表**，这个数只用于 UI 提示与「tail 是否真的静音」的断言。
`take_true_peak()` 是「取走并清零」的语义（since last call）。

---

## 2. 时域度量

### 2.1 峰值、RMS 与波峰因数

- **峰值（peak）**：$\max_n |x[n]|$。本仓库的 `simd::peak` 就是它。
- **RMS（root mean square，均方根）**：$\sqrt{\frac{1}{N}\sum x[n]^2}$，
  与信号功率成正比。本仓库的 DSP 指纹就是用 RMS（`scripts/dsp-baseline.mjs`）
  与 12 个 Goertzel 频带一起锁住「声音有没有变」。
- **波峰因数（crest factor）**：$\text{peak}/\text{RMS}$，常用 dB 表示。
  它决定了同样的 RMS 需要多少 headroom。门禁里
  `dense_chords_stay_clean` 断言的是**软削波样点占比**，
  这是波峰因数在「总线上限固定」时最直接的后果度量
  （`docs/notes/loudness.md` §「代价」）。

一个容易被忽略的事实：**RMS 是「廉价感知响度」的替身**。
`src/audio/preset-loudness.test.ts` 的注释直说：

> RMS of the phrase, in dBFS — a cheap stand-in for perceived loudness.

也就是说本仓库**不做 LUFS / ITU-R BS.1770 的 K 加权响度**，用乐句 RMS 代替。
这一点在文档里必须明说：**「LUFS」在本仓库中未实现**。

### 2.2 包络与检波器

**包络（envelope）** 是信号幅度的慢变轮廓。工程上通过**检波器（detector）** + **平滑
（smoothing）** 得到，实现通常是一阶（one-pole）低通：

$$y[n] = y[n-1] + \alpha\,(x[n] - y[n-1]), \qquad \alpha = 1 - e^{-\Delta t/\tau}$$

本仓库用这个形式的地方至少三处，各自的**时间常数**不同、目的也不同：

| 用途 | 时间常数 | 出处 |
| :-- | --: | :-- |
| 连续参数平滑 | `SMOOTH_TAU_S = 0.02`（约 20 ms） | `crates/synth-core/src/engine.rs` |
| 延迟时间移动（防 click） | `TIME_SLEW = 0.0008`（约 20 ms @48 kHz） | `crates/synth-core/src/dsp/delay.rs` |
| 瞬态整形整流平滑 | `RECT_HZ = 200`、`FAST_HZ = 60`、`SLOW_HZ = 4` | `crates/synth-core/src/fx_shaping.rs` |

**包络跟随器（envelope follower）** 在瞬态整形里被用来**构造「瞬态」本身**：
快跟随器领先、慢跟随器滞后，两者之差就是瞬态（详见 §9.3）。

### 2.3 最大相邻步进与 Bernstein 上界

这一节解释本仓库门禁里一个看起来奇怪、其实很漂亮的不变量。

对一个最高频率成分为 $f_{\text{top}}$、峰值为 $P$ 的带限信号，其导数满足

$$|x'(t)| \le 2\pi f_{\text{top}} P$$

（Bernstein 不等式的一个初等推论：$\sin$ 的导数上界是 $2\pi f$。）
以采样间隔 $1/f_s$ 离散化，**相邻样本的最大步进**满足

$$|x[n] - x[n-1]| \;\lesssim\; \frac{2\pi f_{\text{top}}}{f_s}\,P$$

**这正是本仓库门禁里 `π × peak` 写法的由来。** 当信号是**单一正弦**时，
$f_{\text{top}} = f_0$，把因子 2 吸收进「允许 2 倍余量」的写法，就得到代码里那句：

```javascript
const idealStep = ((2 * Math.PI * f0) / SR) * peak;
```

（`scripts/verify-audio.mjs` §3 「no click at render-block boundaries」）

它断言的是：**每个 render block 边界处不应该出现超过物理极限的步进**。
这条门禁的存在理由是一个**真实发生过的缺陷**：DaisySP 的 `LadderFilter` 在 wasm 构建下
**每个 block 边界丢一个样本**（每 128 个样本一次 click），而同样代码在 host 上干净
（`crates/synth-core/src/dsp/ladder.rs` 模块注释）。

同一节还包含一条**方法论上的关键设计**：门禁必须能失败。

```javascript
// Prove the detector works: the exact failure mode that motivated it — one
// sample dropped at the start of every block — must be reported as a click.
// A gate that cannot fail is not a gate.
const broken = Float32Array.from(frames);
for (let start = 0; start < broken.length; start += BLOCK) broken[start] *= 0.2;
```

即：**人为注入一个已知缺陷，断言门禁确实报警**（`the click detector can see a click`）。
本仓库把这种自证称为「正控（positive control）」，全文多处出现，是这套门禁体系最值得学习的地方。

**这个上界的两个实现级注意点**：

1. `π × peak` 里没有出现 $f_{\text{top}}$，但在**正弦场景**下测试会传入 $f_0$；
   在**多振荡器**场景下峰值本身包含了所有分量，所以这是一个**上界**而不是紧界。
2. 当总线增益变化（`VOICE_GAIN 0.22 → 0.44`）时，**绝对**步进阈值会失效，
   于是这类门禁被改成**相对于峰值**的写法。这是 `docs/notes/loudness.md` §「代价」里
   明确记录的一次重标定：`P96_STEP_BOUND 0.13 → 0.2123`、hard-sync `jump < 0.25 → 0.259`，
   **比值不变（×2.001）**。

---

## 3. 频域分析

### 3.1 DFT 与 FFT

**DFT（discrete Fourier transform）** 把 $N$ 个样本映到 $N$ 个频点：

$$X[k] = \sum_{n=0}^{N-1} x[n]\, e^{-j 2\pi k n / N}$$

**FFT（fast Fourier transform）** 是它的 $O(N\log N)$ 算法（本仓库只用 radix-2，所以 $N$ 必须是 2 的幂）。

本仓库有**三套独立的变换实现**，用途和精度各不相同——这不是重复代码，而是
**「音频线程 / 消息线程 / 门禁」三种约束**的产物：

| 实现 | 位置 | 规模 | 类型 | 用途 |
| :-- | :-- | --: | :-- | :-- |
| 就地迭代 radix-2，共享 | `crates/synth-core/src/dsp/util.rs` `fft` | 任意 2 的幂 | **f64** | 波表导入分析、卷积混响分析 |
| 就地 radix-2 + Hann 窗 + 对数分箱 | `crates/synth-core/src/fft.rs` `Spectrum` | `FFT_SIZE = 512` | f32 | 屏幕频谱分析仪（36 bin） |
| 门禁脚本自己的 FFT | `scripts/verify-audio.mjs` `fftInPlace` | 4 s 或 8192 | f64 | BH-7 尺子 |

`crates/synth-core/src/fft.rs` 的注释解释了 512 点的选择：
「512 points at 48 kHz gives **~94 Hz resolution**, which is plenty for a 36-band display.」
并且它是**唯一**在音频线程上跑的 FFT（每 `ANALYSIS_INTERVAL = 6` 个 block 一次，
约 16 ms @48k/128，`src/audio/worklet-processor.js`）。

### 3.2 窗函数

对有限长信号做 DFT 等价于对无限信号乘了一个**矩形窗（rectangular window）**。
矩形窗的频谱是 Dirichlet 核，**旁瓣按 $1/\text{bin}$ 衰减**——这对高动态范围测量是致命的。

本仓库使用四种窗，各有明确角色：

| 窗 | 系数 | 用途 | 出处 |
| :-- | :-- | :-- | :-- |
| 矩形（无窗） | 全 1 | 「整秒 + 精确 bin」的混叠测量 | `scripts/verify-audio.mjs` `binMagRect` |
| Hann | `0.5 − 0.5cos(2πn/N)` | 频谱分析仪、单频 Goertzel 探针、门禁中的 `binMag` | `crates/synth-core/src/fft.rs`；`scripts/verify-audio.mjs` `binMagHann` |
| 4 项 Blackman-Harris | `0.35875 / 0.48829 / 0.14128 / 0.01168` | 老的频谱检查（旁瓣约 −92 dB） | `scripts/verify-audio.mjs` `spectrum` |
| **7 项 Blackman-Harris（BH-7）** | `0.27105140069342, 0.43329793923448, 0.21812299954311, 0.06592544638803, 0.01081174209837, 0.00077658482522, 0.00001388721735` | **混叠尺子**（旁瓣 −180 dB） | `scripts/verify-audio.mjs` |
| Blackman（BLEP 核生成用） | — | 生成硬同步的 BLEP/BLAMP 核 | `crates/synth-core/src/c_bridge/gs_daisy.cpp` |
| 4 项 Blackman-Harris 窗 sinc | — | 采样器 mip 链低通 + 16 抽头插值核 | `crates/synth-core/src/dsp/sampler.rs` |
| Kaiser（β=6 / β=8） | 数值表 | 硬同步 95 抽头抽取器 / 2× 过采样 63 抽头 | `gs_daisy.cpp` / `dsp/oversample.rs` |

**注意区分两种「Blackman-Harris」**（这是本仓库里最容易读错的术语）：

- **4 项 BH 窗**用于**生成核**（采样器的窗 sinc 插值核、mip 链低通）；
- **7 项 BH 窗**只用于**测量**（门禁尺子），不参与任何音频生成。

门禁里对窗的选择有一段非常清楚的推理（`scripts/verify-audio.mjs` §P9.1a 注释）：

> A 7-term Blackman-Harris window has **-180 dB** sidelobes, so over four whole seconds the power
> that is not within eight bins (2 Hz) of a harmonic is the engine's own off-grid energy.
> The **4-term** Blackman-Harris is not enough: its **-92 dB** sidelobes leave a pure sine at
> **-104 dB**, above the **-105 dB** line this batch has to hold, while the 7-term one reads
> **-117 dB** and does not move when the exclusion band is widened to 16 Hz.

### 3.3 频谱泄漏、旁瓣与 bin 分辨率

- **bin 分辨率（bin spacing）**：$\Delta f = f_s / N$。4 s @48 kHz → **0.25 Hz**
  （`scripts/verify-audio.mjs`：`At four seconds a bin is 0.25 Hz`）。
- **频谱泄漏（spectral leakage）**：信号频率不落在 bin 中心时，能量散布到邻近 bin。
  加窗就是把泄漏的**形状**从矩形窗的慢衰减换成所用窗的形状。
- **旁瓣（sidelobe）**：窗频谱在主瓣之外的起伏。它是**测量下限**的来源：
  旁瓣越高，越容易被误认成「信号里的杂散」。

本仓库有一条**非常值钱的测量教训**，正是关于旁瓣的（`docs/notes/band-limited-oscillators.md` §P9.7）：

> 地板从 −30 压到 −100 dB 后，**矩形窗自己的 1/bin 旁瓣（每 bin 约 −13 dB 泄漏）已经不够用了**，
> 是**换尺子**而不是放宽阈值。

也就是说：当被测对象的杂散低于**测量工具自身**的旁瓣时，唯一正确的做法是**换工具**，
而不是「把阈值放松到工具能通过」——那会把门禁变成噪声检测器。

`scripts/verify-audio.mjs` 对同一条纪律有第二处表述（§P9.1a）：

> The window has to be this good: a Hann window's own sidelobes sit around **-46 dB** a few bins
> away from a strong partial, which is indistinguishable from real broadband junk.

### 3.4 精确 bin（exact bin）与整周期条件

如果被测信号在分析窗内**恰好包含整数个周期**，那么它的谐波**正好落在 bin 中心**，
此时**矩形窗没有泄漏**，单频探针（Goertzel / 单 bin DFT）可以做到极高动态范围。
这就是「**精确 bin（exact bin）**」的意义。

本仓库把这个条件**主动构造**出来：

- 整 4 s 的分析窗、$f_0$ 取音符频率，只要 $4 f_0$ 是整数 Hz，所有谐波都落在整 Hz 上。
- `scripts/verify-audio.mjs` §「第二把尺子」原文：

> C7 is the note whose 4 s hold **exactly 8372 cycles** (4 * 2093 = 8372), so at C7 every harmonic
> sits on a whole-Hz frequency and the gaps between them are several hundred Hz wide.

这条性质使 C7 成为**唯一的「谐波间空隙可以放探针」的音符**——这就是第二把尺子的立足点。

反过来，**不能用精确 bin 的前提去做差减**。`scripts/verify-audio.mjs` 记录了老尺子
（`total − Σ 2|X(k f_0)|²`）为什么失效：

> It is only readable when the tone sits on a whole number of analysis periods, and **no oscillator
> does**: `daisysp::Oscillator` computes its phase increment as `f * sr_recip_` in float, so
> "880 Hz" is really **879.999965 Hz** and every partial is off the probe by `k * 3.5e-5` Hz.
> The leftover leaks, and the **sign of the residual then depends on the tone's phase**.

而且「**把探针改到 f32 精确频率**」这条显而易见的修法被实测否掉了：
在同一场景下时而读 **−74 dB**、时而触到 `max(residual, 1e-30)` 的地板
（−2978「dB」），因为该度量是**两个大数相减**。结论是「**变的是尺子不是引擎**」
（`docs/NEXT-PLAN-2.md` §一 第 2 条）。

### 3.5 Parseval 与「非谐波能量」

**Parseval 定理**：时域能量 = 频域能量。用它可以把「不在谐波网格上的能量」写成

$$E_{\text{off}} = E_{\text{total}} - \sum_{k} E_{\text{harmonic}}(k)$$

本仓库的**主尺子**就是这么定义的（`scripts/verify-audio.mjs` `offGridFloor`）：

1. 对 4 s 渲染乘 **BH-7 窗**，零填充到下一个 2 的幂，做 FFT；
2. 把每个谐波 $k f_0$ **±8 bin**（即 ±2 Hz）范围内标记为「已排除」
   （窗自身的主瓣是 ±1.75 Hz，所以 8 bin 刚好盖住主瓣）；
3. 其余所有 bin 的功率和 / 总功率，取 10log₁₀。

```javascript
const exHz = (FLOOR_BINS * SR) / N;   // FLOOR_BINS = 8
for (let k = 1; k * f0 < SR / 2 + exHz; k++) { /* 排除 k*f0 ± exHz */ }
```

**为什么用 Parseval 而不是「探几个频点」？** 因为折回线 $n f_s - k f_0$ **不是网格的固定比例**。
`docs/notes/oversampling.md` §「教训一」原文：

> 对 110 Hz 的方波，折回落在 `n·fs − k·f0`，它**不是**栅格的固定比例（`fs/f0 = 436.36`），
> 半格 bin 全部落空，量到的是噪声底。正确做法是 **Parseval**：把全部谐波 bin 的能量
> （幅度读数是 A/2，功率 `2m²`）求和，从总能量里减掉，剩下的就是「不在谐波上」的能量，
> **落在哪里都能收到**。

一个实现细节值得抄下来：单频余弦幅度 $A$ 在 $N$ 点矩形窗 DFT 里读数是 $A/2$，
所以它的功率是 $2m^2$ —— 代码里 `harmonics += 2 * m * m` 的因子 2 就是从这里来的。

### 3.6 谐波失真：THD、THD+N 与互调

- **THD（total harmonic distortion，总谐波失真）**
  $\text{THD} = \sqrt{\sum_{k\ge2} A_k^2} \big/ A_1$，常用百分比。
- **THD+N**：把噪声也算进去，$\sqrt{\sum_{k\ge2}A_k^2 + N^2}/A_1$。
- **互调失真（IMD, intermodulation distortion）**：多音输入时产生的和/差频
  $|m f_1 \pm n f_2|$，听感上比同量 THD 更刺耳。本仓库**未实现 IMD 门禁**（**未验证**）。

本仓库的 THD 门禁在 `scripts/verify-audio.mjs` §4「distortion」：

```javascript
const fund = binMag(buf, 440);
let harmonics = 0;
for (let k = 2; k <= 12; k++) harmonics += binMag(buf, 440 * k) ** 2;
const thd = (Math.sqrt(harmonics) / Math.max(fund, 1e-9)) * 100;
check('filter drive stays musical', thd < 6, `THD ${thd.toFixed(2)}% at full drive`);
```

即：**滤波器驱动开满（`FILTER_DRIVE = 1`）时 THD 必须 < 6%**，
场景是 440 Hz 正弦 + `FILTER_TYPE = 0`（ladder）、`FILTER_CUTOFF = 12000`。
这条门禁的语义是「**失真应该像模拟暖声，而不是蜂鸣**」。

另一处 THD 相关的实现决策在 `crates/synth-core/src/dsp/ladder.rs`：

> A plain `tanh(v)` here coloured everything: at a perfectly ordinary **0.5** signal it was
> already compressing by **3%**, which the spectral gate measures as **-46 dB** of harmonic
> content on a sine.

于是输出级改成了「膝点以下完全线性」的 `soft_clip`（`SOFT_KNEE = 0.7`），
使滤波器「在真正被驱动之前是透明的」。这条是**「门禁反过来塑造 DSP 设计」**的极好例子。

---

## 4. 插值、采样率转换与带限

### 4.1 插值器家族：最近邻、线性、三次、窗 sinc

从一张表 / 一段录音里读**非整数位置**的样本，就是插值。本仓库实测过四种核的质量
（内容固定为一组 7 个谐波、16 点表，BH-7 尺子，见 `docs/notes/band-limited-oscillators.md` §P9.5）：

| 插值核 | 实测非谐波地板 |
| :-- | --: |
| 最近邻（nearest neighbour） | **−10.4 dB** |
| 线性（linear） | **−24.4 dB** |
| 4 点三次 Lagrange | **−30.4 dB** |
| **16 抽头 4 项 BH 窗 sinc** | 在同一位置（ν = 1/4）为 **−86 dB**，带内起伏 **< 0.01 dB** |

结论原文：

> 换线性只买 **6 dB**，不是终点。

**为什么三次在 ν = 1/4 处只有 −34 dB 而窗 sinc 有 −86 dB？** 因为多项式插值的频率响应
不是理想的，它会产生**镜像（imaging）**：把信号的高频分量以 $\nu$ 的函数形式折回可闻带。
而窗 sinc 逼近理想低通，带内平坦得多。`docs/notes/band-limited-oscillators.md` §P9.8 的对照：

| 方案 | ν（内容占自身 Nyquist 的比例） | 结果 |
| :-- | --: | --: |
| 三次，ν = 1/16 | 1/16 | **−70.5 dB** |
| 三次，ν = 1/8 | 1/8 | **−56.0 dB**（4186 Hz） |
| 三次，ν = 1/4 | 1/4 | **−34 dB** |
| **只**换窗 sinc（ν 仍贴 Nyquist） | 0.44 | **−54.7 dB** |
| 窗 sinc + ν = 1/4 | 1/4 | **−86.4 dB** |

**两条「只做一半更差」的教训**（这是本仓库最有价值的设计直觉之一）：

1. **只把级长拉长、不换核**：ν 下去了（1/16），但三次核本身的镜像成了瓶颈 → **−70.5 dB**。
2. **只换核、不拉长级长**：核好了，但内容贴在自身 Nyquist 上 → **−54.7 dB**。
3. **两者都做** → **−86.4 dB**。

### 4.2 1/N² 律与其失效条件

对**线性插值**读一张 $N$ 点的表，弦误差（piecewise-linear 折线对带限信号的逼近误差）
的能量随表长按 $1/N^2$ 下降，即**每加一倍表长降约 12 dB**。

本仓库实测的这条律（`docs/notes/band-limited-oscillators.md` §P9.5，
固定**同一组 7 个谐波**、只改表长）：

| 表长 N | 16 | 32 | 64 | 128 | 256 | 512 | 2048 |
| :-- | --: | --: | --: | --: | --: | --: | --: |
| 非谐波地板 | −24.4 | −34.0 | −46.4 | −58.5 | −70.6 | −82.6 | **−106.6 dB** |

`crates/synth-core/src/dsp/wavetable.rs` 的 `BASE_LEN` 注释把它写成了一句更好记的话：

> a short level read with linear interpolation is a piecewise-linear approximation of
> a band-limited signal, and the chord error is a train of high harmonics that folds back
> to `SR − k·f0`（**1/N²: -24 dB at 16 samples, -58 dB at 128**）

**这条律的失效条件（本仓库最重要的一次「直觉之误」）。**

「既然 1/N²，那就把最短的 mip level 加长」——这个外推被实测**直接推翻**：

| 方案 | min level 长度 | 最差实测 |
| :-- | --: | --: |
| 现状（逐级抽取变短） | 8 | −24.2 dB |
| 只把最短 level 抬到 64 | 64 | **−9.2 dB（更差）** |
| 只把最短 level 抬到 128 | 128 | **−8.4 dB（更差）** |
| 只把最短 level 抬到 256 | 256 | **−8.2 dB（更差）** |
| **全长 2048 × 9 级** | 2048 | **−113.6 dB** |

（出处：`docs/notes/band-limited-oscillators.md` §P9.7，离线复刻，同内容/同读法/BH-7/C8 = 4186 Hz）

原因是那条 1/N² 扫描**固定了谐波数**；而引擎里的 level 是**按表长带限**的
（$N$ 点表保留到 $N/2$ 次谐波）。把短 level 加长会**同时抬高它的谐波上限**，
于是 $h/N$ **一直顶在 Nyquist 上**，弦误差并不下降。笔记原文：

> 引擎里的 level 是**按表长带限**的…于是「把短 level 加长」会同时把它的谐波上限抬上去，
> `h/N` 一直顶在 Nyquist 上，插值的弦误差并不下降。

正确的修法是**让每个 level 都是全长表、只减少保留的谐波数**（P9.7 的做法，见 §14）。
C8 选中 level 只有 **4 次谐波**、装进 **2048 点**表里，「读一步只走 `4186/48000 = 0.087`
个表采样——插值几乎是逐样本，折回线自然没了」。

`crates/synth-core/src/dsp/wavetable.rs` 把这条教训写进了 **模块级注释**，
其数学表述值得逐字引用：

> a level of `N` samples holding `h` harmonics is read with a phase step of `2πh/N` per output
> sample, and the chord error is set by **that product**, not by `N` alone.

### 4.3 BLEP 与 BLAMP

**BLEP（band-limited step）** 与 **BLAMP（band-limited ramp）** 是一类
**在波形不连续处就地修正**的带限技术：

- 阶跃不连续（saw 的每个周期回绕、square 的跳变）→ 补一个 **step residual**（BLEP）；
- 斜率不连续（triangle 的折点）→ 补它的**积分**（BLAMP）。

关键纪律：**修正必须发生在不连续被生成的地方**。事后补救不行。
`crates/synth-core/src/c_bridge/gs_daisy.cpp` 原文：

> Correcting a step *after* the fact does not work (the two retired attempts in
> `docs/notes/hard-sync-aliasing.md` both patched DaisySP's already band-limited output and
> measured **-1.6 dB**): the discontinuity has to be band-limited **where it is generated**.

本仓库的实现细节（`gs_daisy.cpp`）：

- 核在 `gs_daisy_init` 启动时用**窗化 sinc 低通**生成（**Blackman 窗**，
  截止 **0.22 × 过采样率** = 96 kHz 下的 **21 kHz**，正好压在 95 抽头抽取器 19.2 kHz 通带之上）；
- 核支撑 **±32 个过采样样本**，是**非因果**的；因此桥接层用一个 **128 槽（2 的幂）环形累加器**
  把朴素信号**延迟 32 个过采样样本**，使修正在读取之前可见
  （`GS_SYNC_RING = 128`、`GS_SYNC_DELAY = GS_BLEP_N = 32`）；
- 「直接截掉前导半核只剩 **−41 dB**，这就是为什么必须延迟」；
- 核以 **`GS_BLEP_R = 128` 个点/样本**制表（`GS_BLEP_M = 2*32*128+1`，即 **8193** 项）。

关于**制表分辨率**的实测（这是「多快好省」取舍的好例子）：

| `GS_BLEP_R` | 3520 Hz 三角 | 110 Hz |
| --: | --: | --: |
| 无 BLAMP（历史） | −56 dB | — |
| 64 | −64 dB | −109 dB |
| **128（当前）** | **−70 dB** | **−121 dB** |
| 256 | 再 +6 dB | — |

结论：**表停在 128**——「Doubling again to 256 buys another 6 dB for twice the table,
so the table stays at 128: **64 KB of BSS** for both kernels」。

一个**极易踩的数值陷阱**（P9.6，v1.112.0）：查表位置 `t` 是**逐抽头 f32 累加**
（`t += GS_BLEP_R`），在 `t ≈ 4096` 处 f32 的 ULP 是 **4.88e-4**。
当真实位置落在节点下方半个 ULP 以内时，累加会**向上舍入到正好 4096**，
于是读到**右极限 `tab[OFF] = −0.498`** 而不是**左极限 `tab[OFF] + 1 = +0.502`**，
**整级错修**（`amp = 2`，所以环累加器上是一次满幅误差）。修法是用 **double** 算精确位置再比较：

```cpp
else if (i == GS_BLEP_OFF && t0_exact + GS_BLEP_R * k < GS_BLEP_OFF) v += 1.0f;
```

**这条 bug 的教训比 bug 本身重要**（`docs/notes/hard-sync-aliasing.md` §P9.6）：

> 触发窗只有 `xw < ~2e-6` 宽，按 4 s 窗随机采样约 **1/150**；而且**换一组初相就整体消失**。
> … **用随机抽签验证「密性」的修复，会系统性漏掉窄窗 bug；必须固定那个已知场景做确定性断言。**

于是门禁把相位**钉成绝对种子 707**（实测坏相位）——这依赖 `gs_init` **不复位**相位计数器，
所以**第 N 次 `gs_note_on` 的初相永远相同**（`scripts/verify-audio.mjs` `noteOns` 计数器的注释）。

### 4.4 过采样（oversampling）

**过采样**：把非线性运算放在**更高的采样率**下做，让非线性产生的谐波折回点从 $f_s/2$
移到 $2 f_s/2$，然后再**带限降回**原采样率。因为「折叠频率」被推远了，
折叠产物可以在抽取前被低通滤掉。

**为什么非线性必须过采样**：线性运算不会产生新频率；只有**饱和/削波/量化/波形整形**会，
而它们产生的谐波在 $f_s/2$ 以上会折回可闻带（§1.2）。

本仓库的 2× 过采样（参数 `OVERSAMPLE`，id **166**，默认 **关**）
用一份 **63 抽头 Kaiser 窗低通**（`fc = 0.21` 对 2× 采样率归一化、`beta = 8`），
**同一条系数表同时做插值与抽取**，因此整个 round trip 是**纯延迟**
（`crates/synth-core/src/dsp/oversample.rs`）。

实测频率响应（换算成 1× 频率，`docs/notes/oversampling.md`）：

| 频率 | 19.2 k | 21.1 k | 23.0 k | 24.0 k | 24.2 k | 25.0 k | 26.9 k |
| :-- | --: | --: | --: | --: | --: | --: | --: |
| 衰减 | −2 dB | −12 dB | −37 dB | −71 dB | **−97 dB** | −85 dB | −107 dB |

**为什么是 63 抽头而不是硬同步的 95？** 原文：

> 这条路径**每个声部都要跑**，63 抽头已经足够（24.2 kHz 处 −97 dB），而**成本只有一半**。

**为什么不用半带（half-band）滤波器？** 因为它**没有保护带**：

> 「刚好在 Nyquist 下面那个八度会折到自己身上」——和硬同步抽取器注释里记的是同一个坑。

**频域实测**（note 45 = 110 Hz、正弦、满量程 FX DRIVE、清调制矩阵、主音量 0.1 让主限幅器留在线性区、
1 整秒、矩形窗、精确 bin）：

| 模式 | 非谐波能量（相对信号 RMS） |
| :-- | --: |
| 1× | **−33.4 dB** |
| 2× | **−59.5 dB** |

→ **下降 26.1 dB**（门禁要求 ≥12 dB），基频只动 **−0.00 dB**（说明被拿走的是混叠，不是电平）。

**代价**：`docs/notes/oversampling.md` 的 bench（同机、host load 6.5/8，计时判定被 bench
自己标为不可信，看原始均值）：

| 场景 | 1× mean | 2× mean | 预算占用 |
| :-- | --: | --: | --: |
| 16 音密集 patch | 442 µs | 829 µs | 16.6% → **31.1%** |
| 同一 patch + 2 s IR 混响 | 653 µs | 842 µs | 24.5% → **31.6%** |

约 **1.9× CPU**。P9.4 又给自由图加了逐节点 2×（只有 DRIVE 节点参与）：
整链 16 声部 **p50 1099 → 1325 µs（1.21×）**，dist **+5.0 KB**、最大 wasm gzip **+0.6 KB**。

### 4.5 延迟补偿（PDC）

**PDC（plugin delay compensation）**：当一个处理支路引入了延迟（过采样往返、
线性相位 FIR、卷积分区），并行支路之间会出现**样本错位**，混在一起就是**梳状滤波**。
PDC 就是给**其他支路补上同样的延迟**，让它们在时间上重新对齐。

本仓库有两套 PDC：

**(a) 链模式（chain）**：整条声部滤波路径被**同一对 FIR** 延迟，所以路径之间不会梳状抵消；
DRIVE 插入的**干路被延迟同样多**（`delay_samples`），否则 1× 干声会和 2× 湿声错开 **31 个样本**。
`Engine::oversample_latency()` 把它报出来（开 **31** / 关 **0**），
Rust 单测断言该值与 `OS_LATENCY` 一致（`crates/synth-core/src/dsp/oversample.rs`、`engine.rs`）。

**(b) 自由图的逐节点 PDC（P9.4，v1.106.0）**：这是一个**按节点**而不是按全局的补偿，
源码在 `crates/synth-core/src/engine.rs` 的 `graph_latency_plan_for`，
一次前向遍历就是精确的拓扑解：

```text
arrival[v] = max over connected inputs of src_out        // dry bus = 0
src_out[v] = arrival[v] + own(v)                         // own = OS_LATENCY if 2x
w[v][e]    = arrival[v] - src_out(src)                   // never negative
dry_delay  = max over dry edges of w[v][e]
output_latency = max over nodes routed to output of src_out, and dry_delay
```

两条**踩过坑的不变量**（原文见 `crates/synth-core/src/engine.rs` 与该函数的文档注释）：

1. **`own(v)` 在节点内部，所以不进 `w`。** 一个 2× 节点的 up/down 往返是它自己的
   **输出**延迟，节点干/湿交叉淡化在**节点内部**（`drive_oversampled_node` 把干声也
   `delay_by(…, OS_LATENCY)`）已经补偿。**若 PDC 再把往返加到节点输入上，就会补两遍**：
   干腿 **+62**、湿腿 **+31** ⇒ `blend_node` 做 **31 样本错位**的交叉淡化 ⇒ 图输出被梳状染色。
2. **每条输入边要独占一条历史**（不能原地延迟节点缓冲：同一节点被两个读者以不同权重读取时会被叠加）。
   干声总线是共享缓冲，每块只按「本节点请求的最大干声权重」延迟一次，节点边只补差值。

第一次实现的症状非常有诊断价值（`docs/notes/oversampling.md` §「踩坑记录」）：

> 第一版把往返算了两遍，症状是**图模式 2× 的混叠比 1× 还差 25 dB**（**−33.0 → −7.1 dB**），
> 而**链模式同代码是下降 26 dB**；把真机的节点输入喂回两条路径，两者**逐位相同**，
> 所以「节点之后」被误当成嫌疑区。真正的诊断线索是**节点混合后的输出**，而不是往返输出：
> 往返正确、混合错误 ⇒ 一定在「节点内部的对齐」或「输入的额外延迟」上。

P9.4 修复后的实测（真 wasm，note 45、1 s、精确 bin / BH-7）：

| 场景 | 1× | 2× | 变化 |
| :--- | ---: | ---: | ---: |
| 链 DRIVE | −33.43 | −59.55 | **−26.12 dB** |
| 图 DRIVE（修前） | −33.43 | −33.43 | 0.00 dB（wasm 门禁读 −7.1） |
| 图 DRIVE（修后） | −33.43 | **−59.54** | **−26.11 dB** |
| 图 + 并联 EQ 支路 | −33.52 | −58.94 | −25.42 dB |

时域（**同一音符内**比较，因为 `gs_init` 不复位相位计数器，两次 `engine()` 调用不可逐样本比较）：
图 2× vs 链 2× 互相关 **1.000000 / 0.999983 at lag 0**；
图 2× vs 图 1× 为 **0.998292**，最佳 lag = **62** = `gs_oversample_latency()`
（61→0.997682、63→0.989140，峰正好在 62）。延迟上报 **62 样本 / 1.29 ms @48 kHz**（`OS_LATENCY + M`，M = 31）。

### 4.6 mipmap 与分级带限

**mipmap** 原本是纹理渲染术语：一张图按 1/2、1/4、1/8… 逐级缩小保存，按需选用。
音频里借用它是为了**分级带限**：为每个八度准备一份「只保留该八度允许的谐波」的表，
这样无论弹哪个音高，选中的表**在构造上就不可能混叠**。

本仓库有两处 mipmap，**设计哲学相反**，值得对照：

| | 波表（wavetable） | 采样器（sampler） |
| :-- | :-- | :-- |
| 级数 | `LEVELS = 9` | `LEVELS = 9` |
| 每级表长 | **全部 2048**（`BASE_LEN`） | **按该级带宽允许的长度**（`SR / 2^(k+1)` 个底采样） |
| 级间差别 | 只差**保留多少谐波**（`level_top(level) = (2048 >> level) / 2`） | 差**带宽**与**表长** |
| 为什么不同 | 工厂表由**谐波配方**合成，可以按需只生成前 $h$ 个谐波 | 采样由**录音**提供带宽，必须**滤掉**超出该级的部分 |

波表的做法（P9.7）：`crates/synth-core/src/dsp/wavetable.rs` 的 `BASE_LEN` 注释
——「Holding every level at [`BASE_LEN`] samples instead leaves the same harmonic content
in a table dozens of times longer than the pitch needs」。

采样器的做法（P9.8）：`crates/synth-core/src/dsp/sampler.rs` 的 `LEVEL_NYQUIST = 0.25`
及其长注释——「Making the level *longer for the same content* moves ν down」，
并且「**every level gets the widest band its own rate range allows**, and none of them is short」。

`level_top` 里有一个 **`/ 2`**，注释专门解释了它：

> Note the `/ 2`: a level holding `h` harmonics is safe to read while `h <= SR / (2 f)`,
> which is exactly what `Table::level_for` checks, and the engine clamps
> `f` to `SR / (BASE_LEN >> level)`. The harmonic *count* here is therefore
> `(BASE_LEN >> level) / 2`, not `BASE_LEN >> level`: **one octave of headroom** over that clamp.
> Without it level 8 would hold 8 harmonics and C8 (4186 Hz) would have its 6th–8th fold back
> to **22.9 / 18.7 / 14.5 kHz**.

即：这个 `/2` 是一个**整八度的余量**，防止边界上的谐波刚好压线折回。

---

## 5. 滤波器

### 5.1 一阶滤波器与双二阶（biquad）

**一阶低通**（one-pole）就是 §2.2 的那个递推。本仓库的一阶滤波器出现在：
延迟反馈阻尼（`DAMP_MIN = 0.05`）、噪声着色（pink/brown）、瞬态整形整流平滑、
`soft_limit` 的指数形状。

**双二阶（biquad）** 是二阶 IIR 的标准形式：

$$H(z) = \frac{b_0 + b_1 z^{-1} + b_2 z^{-2}}{a_0 + a_1 z^{-1} + a_2 z^{-2}}$$

本仓库的整形 EQ 用 **RBJ cookbook** 的三个 biquad 串联
（low shelf / peaking mid / high shelf），实现是 **direct form II transposed**，
并且「normalised by `a0`」（`crates/synth-core/src/fx_shaping.rs`）。
一个刻意的工程选择：系数用 **`exp2`** 而不是 `pow` 计算，注释说是
「so no libm `pow` is linked into the wasm for four EQ controls」——即**为了体积**。

**平坦 EQ 必须是数学恒等**（bit-exact），这是兼容性红线：
`crates/synth-core/src/fx_shaping.rs` 模块注释原文：

> A band whose gain is 0 dB comes out as a **mathematical identity**, so a flat EQ
> (or the wet/dry mix at 0, which skips the node entirely) is a **true bypass**.

### 5.2 ladder（阶梯滤波器）与零延迟反馈

**ladder** 指 Moog 风格的**四级级联一阶低通 + 反馈**，24 dB/oct。
本仓库的 `crates/synth-core/src/dsp/ladder.rs` 是**零延迟反馈（ZDF / TPT）** 实现：

- 四个一阶段在反馈环内；
- 每级用 TPT 形式 `y = g·x + (1−g)·z`，状态更新 `z_new = 2y − z_old`（双线性积分的梯形法）；
- 系数 `w = tan(π fc / fs)`、`g = w/(1+w)`；
- **反馈量** `feedback = res × 3.9`（`res` 是 0..1 的 UI 旋钮），即接近 4 时自激；
- **输入饱和**：`drive = 1 + drive_knob × 0.8`（即 1×..1.8×），
  且「Unity drive is transparent」——`drive > 1.0001` 时才过 `fast_tanh(input * drive) / drive`；
- **输出饱和**：`soft_clip`（`SOFT_KNEE = 0.7`，`fast_tanh` 是 tanh 的 Padé 近似
  `x(27+x²)/(27+9x²)`）。

**「零延迟反馈」为什么重要**（源码注释逐字）：

> Zero-delay feedback: solve the loop instead of feeding back the previous sample.
> **Without this the four-pole loop goes unstable well before full resonance**;
> with it, `feedback` near 4 self-oscillates cleanly.

解法就是那个 `u = (x - feedback * state_sum) / (1 + feedback * g^4)`：

```rust
let (g2, g3, g4) = (g * g, g * g * g, g * g * g * g);
let b0 = (1.0 - g) * self.state[0];  // …b1, b2, b3
let state_sum = g3 * b0 + g2 * b1 + g * b2 + b3;
let u = (x - self.feedback * state_sum) / (1.0 + self.feedback * g4);
```

**为什么这个 ladder 是自己写的 Rust 而不是 vendored DaisySP 的？**
因为 vendored 版本在 wasm 构建下**每个 render-block 边界丢一个样本**
（「a click per 128 samples, i.e. audible crackle on a simple patch」），
而同一份 C++ 在 host 上干净。两个级联 SVF 在 wasm 上是干净的，
所以问题只属于那个 translation unit。自持实现「removes the dependency and keeps the
behaviour identical on every target」。

**这个 wasm bug 的根因非常值钱，它不在滤波器里**（完整取证见附录 C.4）：
`daisysp::LadderFilter` 的**类内成员初始化器**使它非平凡默认可构造 ⇒
命名空间作用域数组 `g_voice[32]` 需要**动态初始化** ⇒ clang 生成
`_GLOBAL__sub_I_gs_daisy.cpp` 并注册进 `.init_array` ⇒ wasm-ld 折进 `__wasm_call_ctors`。
而 wasm 以 **command module** 构建（不导出 `__wasm_call_ctors`），
wasm-ld 于是给**每个导出函数**包一个 `.command_export` shim，先 `call __wasm_call_ctors`——
而这个函数**不幂等** ⇒ **每次调用任意 `gs_*` 都重跑全局构造**，
把 32 个 voice 里 ladder 的 `beta_`/`z0_`/`z1_` **全部清零**。

结论（原文）：

> The bug is **not** in `ladder.cpp` and **not** a clang/LLVM optimisation bug.
> It is a **link/execution-model issue**.
> ……the underlying hazard is **generic to any dynamically-initialised C++ global linked into this
> wasm module**.

修复分三层（去掉 NSDMI / `--export=__wasm_call_ctors` 保底 / CI 最小复现回归），
并有一条关键部署纪律：

> A *native* Rust `#[test]` alone would **not** catch this, because **native is always clean**.

**为什么输出级不是直接的 `tanh`？** 见 §3.6：普通 `tanh` 在 0.5 信号上已经压缩 3%，
光谱门禁读到 **−46 dB** 的谐波。`soft_clip` 在 `SOFT_KNEE = 0.7` 以下**完全线性**。
自激仍然被限住，因为自激幅度远在膝点之上。

**`FILTER_TRIM = 0.65`**：在**每声部滤波之前**施加的修剪，滤波后再补回同样的量。
原因（`crates/synth-core/src/engine.rs`）：

> The ladder's tanh stages saturate around unity, and the raw oscillator sum can reach
> **~1.2** at full level, so without this trim every loud note picked up intermodulation grit —
> very audible on clean patches such as the bell, which is nothing but two sines.

### 5.3 SVF / SEM 状态变量滤波器

**SVF（state variable filter，状态变量滤波器）** 同时输出 LP / BP / HP，
是 12 dB/oct 的拓扑，三个输出天然满足 $LP + HP = $ 输入（notch = LP+HP 的零点）。

本仓库的 C 桥（`crates/synth-core/src/c_bridge/gs_daisy.cpp`，vendored DaisySP `svf`）
提供 `hp / bp / nt` 三种固定类型；**SEM** 是本仓库新增的**连续多模**
（`FilterType::Sem`，线格式 id **6**，C 桥 id **4**）：

- `FILTER_MORPH`（id **145**）0..1 在四个规范点之间**线性斜坡**：
  **0 = low-pass，1/3 = band-pass，2/3 = notch（low + high 的精确零点），1 = high-pass**；
- 默认 `0`（low-pass 端），因此**所有老 patch 的声音不变**（`crates/synth-core/src/params.rs` `FILTER_MORPH` 注释）。

**一个真实的坑（值得写进任何 DSP 项目的历史）**：线格式 id 与 C 桥 id **故意不是同一个编号**。
`FilterType::bridge_id` 的注释逐字：

> Deliberately not `to_u32() as i32`: the enum above is the parameter wire format
> (append-only, shared with the UI), while the C bridge's ids are an implementation detail
> with their own numbering — `sem` is **6 on the wire** and `GS_FILTER_SEM` is **4** in
> `gs_daisy.h`. Casting between them silently lands on the wrong filter, **which is a bug that
> sounds like a feature** (a `sem` patch quietly becomes a low-pass).

第二级（`FILTER2_TYPE`）另有一个 `second_stage_id`：comb / formant 在第二级渲染为
**该 SVF 的 low-pass**，因为它们需要**每声部唯一**的延迟线状态，而那个状态第一级已经占用
（`crates/synth-core/src/params.rs` `FILTER2_TYPE` 注释与 `second_stage_id`）。

### 5.4 梳状滤波器与共振器

**梳状滤波器（comb filter）**：延迟 $D$ 样本并反馈，频响在 $f = k/D$ 处有峰，
像一把梳子。反馈型 comb 的**共振频率**由延迟长度决定。

本仓库的 `crates/synth-core/src/dsp/comb.rs` 把它做成一个**滤波器类型**：

- `FilterType::Comb`（线格式 id 4）：截止频率**决定 comb 音高**，共振决定其反馈；
- 它**替换**整个 ladder/SVF 链；
- 「The comb keeps **one delay line per voice**, so this filter type runs the **mono** path
  even when the oscillators are panned apart」（`crates/synth-core/src/engine.rs`）；
- 缓冲在设置采样率时**分配一次**，渲染循环内不分配；
- 最低频率 `MIN_FREQ_HZ = 30.0`、最高采样率 `MAX_SR = 96_000`、缓冲 `MAX_LEN = MAX_SR/MIN_FREQ_HZ + 4`
  （即 96 kHz 下 30 Hz comb 需要 3200 样本）。

`FilterType::Formant`（id 5）是**三个并联带通**调到元音 A-E-I-O-U，
截止旋钮在它们之间**对数**移动：`vowel = log2(cutoff/80) / log2(4000/80)`，
即 80 Hz = 「A」、4 kHz 及以上 = 「U」（`crates/synth-core/src/engine.rs`）。
两条路径后面都接了 **DC 阻断**（`gs_voice_dc_block`）。

### 5.5 共振、自激、过渡带与阻带

- **共振（resonance / Q）**：截止频率附近的增益提升。本仓库 ladder 的 `feedback = res × 3.9`；
  调制矩阵可以把共振推到**旋钮值的两倍**：
  `(res * (1.0 + mod_res) + mod_res * 0.25).clamp(0.0, 1.0)`（`engine.rs`）。
- **自激（self-oscillation）**：反馈 ≥ 1 时滤波器变成振荡器。
  ladder 的注释说 `feedback` near 4「self-oscillates cleanly」，
  并且**反馈路径内的饱和是让自激保持有界的原因**：
  「without it the loop grows until it is clipped by the master limiter instead」。
  Rust 单测 `full_resonance_stays_bounded` 在 800 Hz / res 1 / drive 1、2 秒内断言
  peak < **12.0** 且全部有限。
- **过渡带（transition band）/ 阻带（stopband）**：滤波器从通带到阻带的过渡区与衰减区。
  本仓库把它们当作**可测指标**：
  - 2× 过采样原型 63 抽头：平到 19 kHz、21 kHz −12 dB、基 Nyquist 已 −71 dB、再往上 < −85 dB；
  - 硬同步 95 抽头 Kaiser（β=6、cutoff 0.229）：通带平到 19.2 kHz、阻带 24 kHz 起 < −72 dB；
  - ladder 单测 `low_pass_attenuates_above_the_cutoff`：2 kHz 截止时 200 Hz 通过 > 0.8、
    8 kHz < 通带的 10%。

### 5.6 群延迟、线性相位与串联/并联路由

**群延迟（group delay）** 是相位响应对频率的负导数，物理上是**各频率分量经过器件的时延**。
对**线性相位 FIR**（系数对称），群延迟是常数 = $(N-1)/2$ 个样本：

- 硬同步 95 抽头抽取器：$(95-1)/2 = 47$ 个**过采样**样本 = $47/2$ = **23.5 个 1× 样本**
  （`GS_BL_DELAY_NUM/GS_BL_DELAY_DEN = 95/2`）——这就是 `gs_osc_bandlimit_latency()` 的值；
- 2× 过采样 63 抽头：$63/2 = 31$ 个过采样样本 = **31 个 1× 样本**（`OS_LATENCY = OS_CENTRE = 63/2`）。

**因果性代价**：注释直说「Zero would need a non-causal filter, so this is the price of the mode」。

**串联（serial）与并联（parallel）路由**：本仓库的双级滤波器（P6.3b）用
`FILTER_ROUTING`（id **146**）：

| 值 | 语义 | 备注 |
| --: | :-- | :-- |
| **0** | `Off`：第二级**不运行** | 所有 P6.3b 之前的 patch 都在这里，**必须是纯旁路** |
| 1 | `Serial`：第二级滤第一级的输出 | 两级 12 dB/oct 叠成更陡的斜率 |
| 2 | `Parallel`：两级看同一输入，输出按 `FILTER_BLEND` 混合 | `out = (1-b)·A + b·B`，**线性**律 |

`FILTER_BLEND`（id **151**）**刻意用线性律而不是等功率律**，理由（`params.rs` 注释）：

> linear rather than equal-power, so that **b = 0 is *exactly* stage 1 and b = 1 is *exactly*
> stage 2** and both endpoints can be asserted bit for bit.

这是「**可测试性驱动 API 设计**」的又一个例子。

第二级**只读自己的 cutoff/res/drive**，**不读**滤波包络、键盘跟踪与调制矩阵：

> those follow stage 1, the stage the player already has a knob for.（`params.rs` `FilterParams` 注释）

另外，`dual_filter.rs` 记录了**测试夹具本身的两个坑**，对任何做滤波器测量的人都有用：

1. 音高必须**按音高（pitch）**播放，`OSC1_PITCH` 钳在 ±48 半音（约 16 Hz..4.2 kHz），
   「a test grid outside that silently measures a different frequency」；
2. **默认调制矩阵把包络和 LFO 都路由到截止且都启用**，所以任何响应测量必须**先清矩阵**。
   P6.3a 为此浪费了一整轮：「with the routes live, a low-pass 'rose' with frequency where it
   has to fall」。

---

## 6. 非线性与动态处理

### 6.1 饱和、软削波与膝点

**饱和（saturation）** 指传递函数在大信号处压缩。实现上常见三类：

1. **硬削波（hard clip）**：`clamp(x, -1, 1)`，产生大量高次谐波，声音「炸」；
2. **解析饱和**：`tanh(x)`、`x/(1+|x|)` 等，全程非线性；
3. **膝点软削波（knee soft clip）**：低电平**完全线性**，超过膝点才平滑压缩。

**本仓库主线用第 3 类**，因为它让「正常演奏保持干净」与「瞬时峰值被抓住」同时成立。

`crates/synth-core/src/dsp/util.rs` 的 `soft_limit`：

```rust
const KNEE: f32 = 0.82;
let a = x.abs();
if a <= KNEE { return x; }                    // 膝点以下逐位透明
let over = (a - KNEE) / (1.0 - KNEE);
let shaped = KNEE + (1.0 - KNEE) * (1.0 - (-over).exp());   // 1 - e^{-over}
```

三点值得注意：

- **膝点以下逐位透明**（`soft_limit(x) == x`），有单测 `soft_limit_is_transparent_then_bounded`
  专门断言 `assert_eq!(soft_limit(x), x)`；
- 形状是 $1 - e^{-\text{over}}$，**单调、连续、有上界 1.0**；
- 它**从不超过 1.0**（`soft_limit(10.0) <= 1.0`、`soft_limit(INFINITY) <= 1.0`），
  即它是**绝对上限**（见 §6.4）。

`crates/synth-core/src/dsp/util.rs` 里还有一段关于**为什么不用 `soft_clip`** 的历史注释：

> `soft_clip` colours everything above **~0.3**, which is audible on a loud polyphonic bus;
> this one is bit-transparent below `KNEE` and only bends the last few dB before the hard ceiling.

`ladder.rs` 的 `soft_clip` 则用 `SOFT_KNEE = 0.7` + Padé tanh，
是把「透明区」设得更低以换取更强的自激限幅（见 §5.2）。

### 6.2 前瞻限幅器

**限幅器（limiter）** 是压缩比无穷大的动态处理器；**前瞻（lookahead）** 指
**把信号延迟一小段**，使增益计算可以先看到即将到来的峰值，
从而在峰值**到达输出之前**就已经衰减完毕——避免削波，也避免「pumping」。

本仓库的实现（`crates/synth-core/src/engine.rs`）参数：

| 常量 | 值 | 语义 |
| :-- | --: | :-- |
| `LIMIT_CEILING` | **0.95** | 天花板（绝对电平） |
| `LOOKAHEAD` | **128** 样本 | 前瞻窗口，「~2.7 ms at 48 kHz」 |
| `LIMIT_RELEASE_S` | **0.15** s | 释放时间 |
| `LIMIT_PEAK_HOLD_S` | **0.05** s | 峰值保持 |

算法逐样本循环（原文注释）：

```rust
// Sliding peak estimate: fast attack, ~60 ms hold-and-decay.
let abs = in_l.abs().max(in_r.abs());
self.limit_peak = if abs > self.limit_peak { abs } else { self.limit_peak * decay };

let need = if self.limit_peak > LIMIT_CEILING { LIMIT_CEILING / self.limit_peak } else { 1.0 };
// limit_target 是信号需要的增益：立刻下降、按 release 恢复；
// limit_gain 以线性 attack 追随它，并在前瞻窗口内落位。
if need < self.limit_target {
    self.limit_target = need;
    self.limit_slope = (self.limit_gain - need) / LOOKAHEAD as f32;
} else {
    self.limit_target = (self.limit_target + release_step).min(need);
}
if self.limit_gain > self.limit_target {
    self.limit_gain = (self.limit_gain - self.limit_slope).max(self.limit_target);
} else {
    self.limit_gain = self.limit_target;
}
// Delayed signal × gain.
let out_l = self.look_l[self.look_pos] * self.limit_gain;
```

前瞻由 `look_l` / `look_r` 两个长度 128 的环形缓冲实现；
`decay = exp(-1/(LIMIT_PEAK_HOLD_S · sr))`。

**关键的历史事实：这个限幅器「从不动作」。**

`docs/NEXT-PLAN-2.md` §一 原话：`gs_limit_reduction()` 恒为 **1.00（限幅器从不动作）**。
原因是**峰值在软削波那一级就已经被处理了**。`crates/synth-core/src/engine.rs` 的
`VOICE_GAIN` 注释把旧的错误解释明确写了下来：

> The old reason for the small value — "a dense chord sums to roughly **sqrt(N)** instead of **N**,
> so this leaves the bus inside the limiter's linear region" — **is not what actually bounds the
> level**: the lookahead limiter **never engages even at +9 dB**, because the peaks are caught by
> `soft_limit` (knee **0.82**), which was already working at the old gain.

这是一个**被实测推翻的设计假设**，也是一个非常好的教训：
**「我加了一个保护级」不等于「那个保护级在工作」**。门禁里因此有专门的诊断
`gs_limit_reduction()`（返回**线性增益**，1.0 = 不动作，**不是 dB**——这一点曾被父代理搞错，
见 `docs/NEXT-PLAN-2.md` §一 第 36 条）。

不过限幅器**确实有动作的场景**，出现在单测里（`docs/notes/loudness.md` §「代价」的重标定表）：
`limiter_catches_transients_without_clipping` 的 `limiter min_gain` 在 +6 dB 后是 **0.286（−10.9 dB）**，
即**瞬态测试场景下它在工作**，只是**音乐性素材（预设库）上不动作**。这两件事不矛盾，
文档里必须同时写出来，否则会误导读者。

### 6.3 释放时间与保持

- **释放时间（release time）**：增益从压缩状态恢复的速度。太短 → 失真（增益随波形波动），
  太长 → 「pumping」（可闻的电平呼吸）。
- **保持（hold）**：在开始恢复之前维持衰减的时间，避免在密集峰值之间反复起落。

本仓库用 `LIMIT_PEAK_HOLD_S = 0.05`（50 ms）+ `LIMIT_RELEASE_S = 0.15`（150 ms），
注释称峰值检波为「fast attack, **~60 ms hold-and-decay**」（50 ms 保持 + 指数衰减，
写成约 60 ms 的笼统说法）。

包络（ADSR）也有各自的 release：`time_coefficient(time_s, sr) = exp(-6.0/(time_s·sr))`，
即「一段覆盖其跨度的 **~99.8%** 所需的时间」（$e^{-6} \approx 0.0025$）。
注释解释了为什么用 6 而不是 1：

> so "release = 0.3 s" **sounds like** a 0.3 s release, not 3 s

（`crates/synth-core/src/dsp/adsr.rs` `time_coefficient`）。

### 6.4 为什么「天花板」是绝对电平

数字域的上限是 0 dBFS。任何**绝对**天花板（`LIMIT_CEILING = 0.95`、`soft_limit` 的
渐近 1.0）都必须按**绝对电平**定义，不能按「相对输入」定义——否则它就不是天花板。

这带来一个**结构性后果**，本仓库在 +6 dB 增益调整时被迫面对（`docs/notes/loudness.md` §「代价」）：

> 软削波的 knee **0.82** 与 `LIMIT_CEILING` **0.95** 都是**绝对电平**，所以抬高 6 dB 必然让
> 极端素材更多地进入软削波/限幅。**这是 +6 dB 的固有代价，不是 bug**。

具体数据（`docs/notes/loudness.md`）：最响预设 `phonk` 的 peak 从 −6.33 抬到 **−0.73 dBFS**，
**32 / 86400** 个样点轻触软削波膝（限幅器压 **−0.06 dB**，不可闻）；
而 `dense_chords_stay_clean` 的软削波样点占比门禁被**记账式放宽**（<0.1% → <5%），
实测 0.00 / 0.94 / 1.21 / **1.50%**；`limiter min_gain` 门禁从 >0.98 放宽到 >0.5，
实测 1.000 / 0.790 / 0.748 / **0.668**。

**「记账式重标定」是本仓库的一条方法论**：阈值不是「为了通过」而改，
而是**随一次有意的产品决策一起改，并把理由写进基线 JSON 的 `reason` 字段**
（`scripts/verify-presets.mjs` 的 `--reason` 是强制的，没有理由不让更新）。

---

## 7. 调制与包络

### 7.1 ADSR 包络

**ADSR** = Attack / Decay / Sustain / Release。

本仓库的 `Adsr`（`crates/synth-core/src/dsp/adsr.rs`）是**Rust 自持实现**，
不是 DaisySP 的 `Adsr`，原因（模块注释）：

> The engine needs one envelope *instance per voice* with an independent, **overridable release**
> (for smooth voice stealing), which a shared-parameter wrapper cannot express cleanly.

实现细节：

- **Attack 是线性斜坡**：`attack_inc = 1/(attack_s · sr)`，累加到 1.0 即进入 Decay；
- **Decay / Release 是单极点**：`decay_coef = exp(-6/(decay_s·sr))`；
- **Sustain 是保持**：`value = sustain`；
- **零 sustain 的 voice 在 Decay 结束时就进入 Idle**，即使键还按着
  （pluck / bell 行为）；注释强调「A note begins only through `gate_on()`; this prevents a
  zero-sustain voice from re-attacking itself while the key is still held」；
- **release 可被覆盖**（`set_release`），给**平滑偷声**用；
- 阈值：`|value − sustain| < 1e-4` 判定到达 sustain；`value < 1e-4` 判定 release 结束。

包络参数范围（`params.rs`，钳位值就是权威）：

| 参数 | id | 范围 | 默认 |
| :-- | --: | :-- | --: |
| `ENV_ATTACK` | 19 | 0.0005..8 s | 0.002 |
| `ENV_DECAY` | 20 | 0.001..12 s | 0.2 |
| `ENV_SUSTAIN` | 21 | 0..1 | 0.8 |
| `ENV_RELEASE` | 22 | 0.005..16 s | 0.3 |
| `FILTER_ENV_ATTACK` | 58 | 0.0005..8 s | 0.01 |
| `FILTER_ENV_DECAY` | 59 | 0.001..12 s | 0.3 |
| `FILTER_ENV_SUSTAIN` | 60 | 0..1 | 0.5 |
| `FILTER_ENV_RELEASE` | 61 | 0.005..16 s | 0.3 |

**注意「包络参数变化要重新算系数」**：`EnvParams` 的 **8 个参数**被 `is_env_param()` 列出，
配合 `env_dirty` 标志，只在**真的改了**时才 `apply_env_to_all()`
（`crates/synth-core/src/engine.rs`）。这是一个**把「参数写入」与「系数重算」解耦**的常见优化。

### 7.2 LFO

**LFO（low-frequency oscillator，低频振荡器）** 是频率在 0.02..40 Hz 的振荡器，
用来做周期性调制（颤音、震音、滤波扫频、PWM）。

本仓库有**两个全局 LFO**（`lfo` 与 `lfo2`），实现是 `crates/synth-core/src/dsp/lfo.rs`：

- 波形：sine / triangle / square / saw（`LfoWave`）；
- 增量 `inc = (rate_hz / sample_rate).clamp(0.0, 0.5)`（钳 0.5 即 Nyquist，避免混叠；
  LFO 本身不抗混叠，这是一个**刻意的简化**）；
- **每个 block 渲染一次**到 scratch 缓冲，所以逐样本目标（tremolo）不 click，
  逐 block 目标（cutoff）几乎免费（模块注释）；
- `sync` 模式：频率 = `tempo / 60`，即**一拍一个周期**（`engine.rs`）；
- `retrigger`：每个新音符重启相位（per-voice LFO）；
- `one_shot`：跑一个周期后**停在末尾值**，注释说「behaves like an extra envelope」。

参数：`LFO_RATE`（id 25，0.02..40）、`LFO_DEPTH`（26，0..1）、`LFO_WAVE`（24）、
`LFO_TARGET`（27）、`LFO_SYNC`（28）、`LFO_RETRIG`（74）、`LFO_ONESHOT`（75）；
LFO2 对应 id 62..66、76、77。

`LfoTarget` 有四个：`Cutoff / Pitch / Volume / Pwm`（`params.rs` `LfoTarget`）。

### 7.3 调制矩阵与调制总线

本仓库**有三套不同的调制机制**，覆盖三种不同的时间尺度与作用域——
**这是理解本合成器结构的关键**：

| 机制 | 参数 | slot 数 | 作用域 | 更新率 |
| :-- | :-- | --: | :-- | :-- |
| **调制矩阵**（per-voice） | `gs_set_mod_route(index, src, dst, amount, enabled)` | `MOD_ROUTES = 8` | 每声部 | 每 block |
| **图内调制边**（P7.2） | `FX_MOD{n}_SRC/DST/DEPTH`，id 167..178 | `MOD_SLOTS = 4` | **总线级节点增益** | 每 block + 一阶平滑 |
| **覆盖槽调制总线**（P9.3） | `FX_OVR_TARGET{n}` / `FX_OVR_DEPTH{n}`，id 207..222 | `OVR_MOD_SLOTS = 8` | **每节点效果参数** | 每 block |

**调制源**（`ModSrc`，8 个）：`Lfo`、`Env`、`ModWheel`、`Velocity`、`Lfo2`、`Aftertouch`、
`Random`（每音符一个随机值，**保持整个音符生命周期**，所以持续音不会抖）、
`KeyTrack`（相对中央 C，±48 半音映到 ±1）。

**调制目标**（`ModDst`，8 个）：`Cutoff`、`Pitch`、`Volume`、`Pwm`、`Pan`、`Resonance`、
`Fm`（相位调制深度）、`Ring`（环形调制量）。

**调制深度语义**：`ModRoute.amount` 钳在 **−1..1**（`set_route`），
且**共振目标可以把值推到旋钮的两倍**：
`resonance = (res * (1.0 + mod_res) + mod_res * 0.25).clamp(0.0, 1.0)`。

**图内调制边的三个坑**（都在代码/笔记里有记录）：

1. **边需要三个条件同时成立才「活着」**：`src != 0 && dst != 0 && depth != 0.0`
   （`graph_mod_active`）。任一为零就等于没有边——这保证了**新写的 patch 与老 patch 行为一致**。
2. **有活边时增益总和过一阶平滑，没有活边时原值返回**（不经平滑、不做算术）。
   这是「bit for bit identical」的兼容策略：
   > With no live edge the host values come back untouched — no smoother, no arithmetic —
   > which is what keeps a pre-P7.2 graph bit for bit identical.
3. **两条边可以落到同一个增益上，它们的量相加**（和覆盖槽总线一样）。

**覆盖槽调制总线**（P9.3）是**每节点效果参数**的调制，`ovr_scale` 的实现值得一读：
一个总线槽只有在 `ovr_target[index] == ovr_slot_code(node, slot)` 时才对该 (node, slot) 生效，
「which is what keeps a sweep from leaking into the other five nodes and the other three columns
of the same node」。**两个槽可以指向同一对 (node, slot)，它们的深度相加**
（注释：「exactly like two P7.2 in-graph edges landing on one gain」）。

**图内调制用的包络是「最高声部包络」**（`graph_env`，`engine.rs`）：

> There is one envelope per voice and the graph is a bus effect, so the edge sees the **highest
> level sounding** — a note that has been released still holds the edge open while its tail rings,
> which is what makes an envelope-drawn edge act like a **bus-level follower** instead of a
> per-voice route.

### 7.4 控制率、块率与参数平滑

三个时间尺度必须分清：

1. **采样率（audio rate）**：$f_s$ = 48 kHz。振荡器、滤波器、饱和在这里。
2. **块率（block rate）**：一次 `gs_process(frames)` 处理 128..1024 帧
   （`MAX_BLOCK_SIZE = 1024`，AudioWorklet 的 render quantum 是 128）。
   LFO、参数平滑、图增益、覆盖槽解析都在这里。
3. **控制率（control rate / k-rate）**：宿主每 block 推一次参数值。
   `src/audio/worklet-processor.js` 的注释：

   > AudioParam values are read once per render quantum (**k-rate**) and pushed into the engine —
   > the browser does the interpolation and thread sync.

**为什么参数必须平滑？** 因为宿主拖旋钮是**离散的块级跳变**，
直接写进 DSP 会产生**zipper noise（拉链噪声）**——每次跳变一个宽带脉冲。

本仓库的平滑是**一阶低通**，时间常数 `SMOOTH_TAU_S = 0.02`（约 20 ms）。
系数在每 block 按**实际帧数**算：

```rust
let coeff = 1.0 - (-(frames as f32) / (SMOOTH_TAU_S * sr)).exp();
```

（`crates/synth-core/src/engine.rs`，出现两次：参数平滑与图增益平滑）

**哪些参数被平滑、哪些不平滑**是一条**明确的分类**（`params.rs` `is_continuous`）：
连续量（音高、失谐、电平、脉宽、声像、截止、共振、驱动、包络时间、LFO 速率/深度、
混响 size/mix/damp/width/predelay、延迟 fb/mix、glide、tempo、弯音范围、总调音、
所有效果旋钮、瞬态量、图内调制深度、**全部覆盖槽值** 与**覆盖槽深度**）被平滑；
**离散/阶跃量**（波形、开关、同步、voice mode、图的 src/dst 编码、覆盖槽 target 编码）**立刻生效**。

`is_continuous` 的注释把理由写得很清楚：

> Continuous parameters are smoothed across blocks (one-pole, ~20 ms) so the host can drag a knob
> without producing zipper noise.

**一个重要的例外/细节**：`FX_OVR1_1` 这类覆盖槽值被平滑，其中**延迟时间**那一槽
「rides the same smoother and is one of the controls that most needs it」。

**平滑的「首块直通」语义**（图增益里）：`graph_gain_ready` 为 false 时**直接取目标值**，
不平滑；只有当活的调制边存在时才启用平滑，并且**深度回到 0 时把 ready 复位**：

> A depth that returns to zero has to snap next time rather than resume from a stale ramp.

---

## 8. 时间与调制类效果

### 8.1 延迟线、反馈与梳状滤波

**延迟线（delay line）** 是环形缓冲，读出位置相对写入位置偏移 $D$ 个样本。
**反馈（feedback）** 把输出按系数送回输入，形成无限重复；反馈 $g$ 的几何衰减使
第 $n$ 次回声电平为 $g^n$。**反馈 ≥ 1 会自激**，所以本仓库把反馈钳在 **0..0.95**
（`FX_DELAY_FB` id 34、以及 `DelayParams::feedback.clamp(0.0, 0.95)`）。

**分数延迟读（fractional read）**：为了能移动读抽头，读位置必须是浮点的，
并在两个相邻样本间线性插值（`Delay::read`）。**移动读抽头会 click**，
所以时间变化用一阶 slew：`TIME_SLEW = 0.0008`（约 20 ms @48 kHz）。

本仓库的延迟线（`crates/synth-core/src/dsp/delay.rs`）替换了 vendored Soundpipe delay，
理由是功能性的：

> That one was two independent mono lines with a hard-wired dry+wet sum, so it **could not
> cross-feed the channels** and its echoes **never got darker**; both are the difference between
> a slapback and a delay that sits in a mix.

两个新特性：

- **Ping-pong（乒乓）**：输入只进左线，两条线互相馈送，于是回声左右交替。
  一个重要细节：**先把输入求和到单声道**（`mono = (dry_l + dry_r) * 0.5`），
  「a hard-panned right signal would otherwise never reach the left line」。
- **阻尼（damping）**：反馈环内的一阶低通，**每次重复都比喂它的那次更暗**，
  而不是整条尾巴只滤一次：`damp_coeff = 1 - damp*(1 - DAMP_MIN)`，`DAMP_MIN = 0.05`。

长度上限 `MAX_DELAY_SECONDS = 2.0`、硬上限 `MAX_DELAY_SAMPLES = 192_000`
（注释：「so a 192 kHz host does not reserve 1.5 MB per channel」）。
buffer 在 `Engine::init` 里分配一次，渲染循环不分配。

### 8.2 算法混响与卷积混响

**混响（reverb）** 两类实现路线，本仓库**两条都有**（`FX_REVERB_MODE` id **94**：
0 = 算法、1 = 导入脉冲响应）：

**(a) 算法混响（algorithmic）**：用延迟网络合成。本仓库是 **Freeverb 拓扑**：
**每声道 8 个阻尼梳状滤波器（damped comb）+ 4 个全通扩散器（allpass）**，
加上经典立体声扩展、以及老 Soundpipe reverb 没有的三个控制
（**damping**、**pre-delay**、**stereo width**）（`crates/synth-core/src/dsp/reverb.rs`）。

三条设计决策：

1. **延迟线刻意是静态的**：
   > a moving tap inside a feedback loop **adds energy whenever the delay shortens**,
   > which **pumps the tail** instead of decaying it.
2. **预延迟缓冲 100 ms @96 kHz**（`reverb_predelay` 钳 0..0.1 s）。
3. **输出修剪**：梳状组 + 四个全通有「a large resonant gain（**up to ~25x** at a comb resonance）」，
   所以原始和远高于干声；一个固定 trim 把全湿拉回约 unity。

**(b) 卷积混响（convolution）**：与录制/合成的**脉冲响应（IR, impulse response）**做卷积。
直接卷积是 $O(N \cdot M)$，代价不可接受，所以用**分区频域卷积（partitioned FFT convolution /
uniform-partition overlap-save）**：把 IR 切成 $P$ 个长度 $H$ 的分区，
每一个用 FFT 在频域做乘法，用**频域延迟线（FDL, frequency-domain delay line）**累加历史。

本仓库的参数（`crates/synth-core/src/dsp/convolution.rs`）：

| 常量 | 值 | 语义 |
| :-- | --: | :-- |
| `HOP` | **1024** | 每个分区的样本数，也是湿声路径的**延迟** |
| `FFT_SIZE` | **2048** | 一个 hop 的历史 + 一个 hop 的新输入 |
| `BINS` | 1025 | `FFT_SIZE/2 + 1` |
| `MAX_PARTITIONS` | **96** | 最长 IR = 96 × 1024 = 98304 样本 ≈ **2.05 s @48 kHz** |
| `MIN_IR_SAMPLES` | **32** | 再短就是 click，不是空间 |
| 分区工作切片数 | **8** | 「matches the usual 128-frame render quantum」，每块承担 1/8 的工作 |

「**P9.4 式的分摊（spread）**」是这里的核心工程量：如果分区工作不摊开，
「one block in every eight pays for all of it」，最坏块会跳出分布。
`scripts/bench.mjs` 专门检查它：

```javascript
// Spread, not spiky. Every call is the same 128 frames and the convolver's hop
// is 1024, so the blocks fall into eight repeating phases …
// One phase is allowed to be busy: the transforms cannot start until the hop
// is complete, so the boundary block always carries them. Every *other* phase
// must look alike — if the partition work were concentrated, one phase would
// stand out from the rest by a wide margin.
```

**关键共享策略**：IR 的分区谱被**所有卷积节点只读共享**，
「so a patch with three reverb nodes in impulse-response mode holds **one** response, not three」。
但**每个节点的 FDL 是独立的**，「so two nodes never share a tail」。
IR 的**能量归一化**（unit-energy）让不同长度的响应得到可比的湿声电平；
`FX_CONV_TRIM`（id **95**）是它的输出修剪，因为「whose level depends on the response rather
than on a `SIZE` control」。

**为什么不用 Soundpipe 的 revsc？** `docs/notes/` 与源码注释显示本仓库把算法混响改为
Freeverb 拓扑以换取 damping/predelay/width 三个控制；IR 路径则是**自研**，
理由是内存与分摊的可控性（以及 arena 的确定性分配）。

### 8.3 合唱、镶边与相位器

三者都是**短延迟调制**，靠**时间变化的相位**产生运动感：

| 效果 | 物理机制 | 本仓库参数 |
| :-- | :-- | :-- |
| **合唱（chorus）** | 多个**略微失谐**的延迟拷贝叠加（模拟多个演奏者） | `FX_CHORUS_ON/DEPTH/RATE/MIX`（43..46） |
| **镶边（flanger）** | **单个短延迟**（通常 < 10 ms）+ **反馈**，产生移动的梳状零点 | `FX_FLANGER_ON/RATE/FB/MIX`（47..50） |
| **相位器（phaser）** | 级联**全通（allpass）**滤波器，产生移动的**相位**零点（不是梳状） | `FX_PHASER_ON/RATE/FB/MIX`（51..54） |

三者都是 **insert**，也就是说「wet/dry 交叉淡化」（`FxKind::can_be_parallel` 列出可并联的种类）。
参数范围（`params.rs`）：

- 合唱深度/混音 0..1、速率 0.02..10 Hz；
- 镶边反馈 0..**0.95**、速率 0.02..10、混音 0..1；
- 相位器反馈 0..**0.95**、速率 0.02..10、混音 0..1。

C 桥接口（`crates/synth-core/src/c_bridge/gs_daisy.h`）：
`gs_fx_chorus_set(slot, depth, freq, delay_ms, feedback)`、
`gs_fx_flanger_set(...)`、`gs_fx_phaser_set(slot, depth, freq, feedback, poles)`。
相位器有一个 **`poles`** 参数，即全通级数（决定零点个数/梳齿密度），
这是一个**未在参数面板暴露**的实现细节（**未验证**其具体取值）。

---

## 9. 失真类效果

### 9.1 位粉碎（bit-crush）

**位粉碎**是刻意的**低比特/低采样率**效果，由两级组成
（`crates/synth-core/src/fx_shaping.rs` 模块注释）：

1. **量化器（quantiser）**：`bits`（4..16），步长 `step = 2/2^bits`；
2. **采样保持（sample-and-hold）**：降采样除数 `down`（1..64），
   即采样率除以 `down`。

**为什么降采样会产生混叠**：一个 $f$ 的正弦在降采样后获得
**$k \cdot (sr/down) \pm f$** 的镜像，其中高于降采样 Nyquist 的部分会**折回**。

**抗混叠控制 `aa`（0..1）**：在分频器**之前**混入**两级级联一阶低通**
（拐点在降采样 Nyquist），在它**之后**再混入两级来**插值台阶**
（「two more *after* it to interpolate the staircase」）。
`aa = 0` 就是原始的有混叠版本，这正是「the mirror falls as aa rises」这类断言有意义的前提。

参数：`FX_CRUSH_ON` `FX_CRUSH_BITS` `FX_CRUSH_DOWN` `FX_CRUSH_AA` `FX_CRUSH_MIX`
（id 152..156），范围分别是 开关 / 4..16 / 1..64 / 0..1 / 0..1。
`MAX_DIVISOR = 64.0`。

**一个非常有教益的 bug**（`docs/NEXT-PLAN-2.md` §一 第 30 条）：
预设 `crushbass` **几乎无声**，内容守卫读到 middle C 的 peak = **0.0020**
（断言要求 ≥ 0.003）。根因**不是 trim 太小**，而是**湿声路被量化成零**：

> `quantise` 的 `step = 2/2^bits`，4 bit ⇒ **0.125**，预设前置电平峰值只有 **~0.044**
> ⇒ `round(<0.5) = 0`，听到的只是 `1-mix = 10%` 干声泄漏（**0.00195 = 0.1×干声**）。

修法：`FX_CRUSH_BITS 4 → 6`（step **0.03125**）+ `PATCH_GAIN 0.442 → 0.36`。
middle C peak **0.00195 → 0.02258**，乐句 **−43.96 → −40.98 dBFS**。

**这个 bug 最有价值的部分是它的门禁互斥结论**：

> 只调 `PATCH_GAIN` 不行（需 gain **≈1.2–1.5**，spread 涨到 **19.8 dB** 破 `preset-loudness`）
> ⇒ **4 bit 下两个门禁互斥**。

也就是说：一个「响度均匀」门禁和一个「不能无声」门禁，在 4 bit 量化下**无法同时满足**。
修法必须是**改 DSP 参数**（bit 深度），不能只改增益。
另一条教训：**和弦掩盖了它**——坏版本的和弦 RMS 读 **0.088**（正常），
而单音只读 **0.0020**。于是和弦 RMS 门槛从 **1e-4（−80 dB）提到 1e-3（−60 dBFS）**。

### 9.2 驱动（drive / overdrive）

**驱动**是波形整形：`y = f(g·x)`，$f$ 非线性。本仓库的 DRIVE 有两处：

- **FX 链 / 图中的 DRIVE 插入**（`FxKind::Drive`）：厂商（vendored DaisySP）`Overdrive`，
  `FX_DRIVE_AMT`（id 56）0..1、`FX_DRIVE_MIX`（57）0..1；
- **滤波器前级的 drive 输入饱和**（`FILTER_DRIVE` id 16，见 §5.2）。

**DRIVE 是唯一被认定为「必须过采样」的效果节点**
（`Engine::node_oversampled(kind) = Drive`）：

> DRIVE 是无记忆波形整形、本质折叠频率；CRUSH 同类，本批未开；
> EQ/延迟/混响/合唱/镶边/移相/瞬态整形是线性或纯增益律，**只补偿不上采样**。
> （`docs/notes/oversampling.md` §P9.4）

这条分类很重要：**不是所有非线性都需要过采样，但无记忆波形整形一定需要**；
而线性/增益类效果过采样只有成本、没有收益。`comb` / `formant` 在声部滤波路径里
也被明确跳过，理由相同（「neither has a saturator」）。

### 9.3 瞬态整形（transient shaping）

**瞬态整形**不改变稳态电平，只改变**起音（attack）**与**衰减（sustain）**段的增益，
用来「加冲击力」或「加延音」。

本仓库的实现（`crates/synth-core/src/fx_shaping.rs`）：

- **快包络跟随器** vs **慢包络跟随器**之差 = 瞬态；
- 三个时间常数：`RECT_HZ = 200`（整流平滑，高于所有音符载频）、
  `FAST_HZ = 60`（快跟随）、`SLOW_HZ = 4`（慢参考）；
- `ATTACK_DB = 8.5`（attack = 1 时满幅起音的 dB 增益）、`SUSTAIN_DB = 22.0`；
- **增益 = `2^(dB/6)`**，即**恰好 dB 分贝**，用 `exp2`（wasm 指令）而不是 `powf`；
- 增益硬钳在 **[0, 8]**，「so no combination of controls can invert the signal or send it to
  infinity」；
- **两个量为 0 是数学恒等**（增益恰为 1、输出等于输入），
  所以默认 patch（两个量都是 0）**逐位不变**；
- `MIX = 0` 完全跳过节点，「which keeps the dry path bit for bit」。

**为什么 `SUSTAIN_DB`（22）远大于 `ATTACK_DB`（8.5）？** 源码解释了：

> The detector's excursion on a release is only about **a quarter** of its excursion on an onset —
> the fast follower has the slow one's tail to fall through — so the release needs a much larger
> number of decibels per unit for `sustain = ±0.5` to land in the **same ±3 dB window** as
> `attack = ±0.5`.

**为什么整流要平滑到 200 Hz？** 否则「the shaper would gain-modulate a steady note at twice its
own frequency and the gate would read it as harmonic distortion」。
而**慢参考跟随的是快跟随器、不是原始信号**，因此「a held note relaxes back to unity within a few
tens of milliseconds instead of staying lifted for the length of the note」。

参数：`FX_TRANSIENT_ON`（179）、`FX_TRANSIENT_ATTACK`（180，−1..1）、
`FX_TRANSIENT_SUSTAIN`（181，−1..1）、`FX_TRANSIENT_MIX`（182，0..1）。

---

## 10. 合成法

### 10.1 减性合成

**减性合成（subtractive synthesis）**：用谐波丰富的源（saw / square / pulse / noise），
再用滤波器**减掉**不需要的部分。这是本合成器的主线架构：
振荡器 → （同步 / FM / 环形调制）→ 混合 → **滤波器** → 声像 → 总线。

### 10.2 波表合成与带限 mipmap

**波表合成（wavetable synthesis）**：存一个周期的波形，按音符频率循环读出。
朴素实现**必然混叠**（表里含高于 Nyquist 的谐波）。
本仓库的解法是 §4.6 与 §14 的 **mipmap 分级带限**。

工厂波表不是采样，而是**谐波配方（recipe）**：

| 名称 | 配方（谐波号, 幅度） |
| :-- | :-- |
| `ORGAN` | (1, 1.0) (2, 0.5) (3, 0.35) (4, 0.25) (6, 0.12) (8, 0.08) |
| `HOLLOW` | (1, 1.0) (3, 0.33) (5, 0.2) (7, 0.14) (9, 0.11) (11, 0.09) |
| `VOCAL` | (1, 1.0) (2, 0.4) (3, 0.9) (4, 0.7) (5, 0.6) (6, 0.2) (7, 0.1) |
| `METALLIC` | (1, 1.0) (3, 0.5) (5, 0.4) (8, 0.3) (11, 0.25) (15, 0.2) (19, 0.15) |
| `GLASS` | (1, 1.0) (2, 0.2) (5, 0.5) (9, 0.35) (14, 0.25) (20, 0.18) (27, 0.12) (35, 0.08) |

（`crates/synth-core/src/dsp/wavetable.rs`）

**配方而不是采样**的好处（模块注释）：

> a recipe is a handful of numbers, the mipmaps are derived from it, and "**band-limited**" is
> then a property of the **generator** rather than of a careful resampling step.

**选择哪张表**用的是**脉宽旋钮**（`OSC1_PW` / `OSC2_PW`）：
`recipe = round(pw * 4)`，即 0.05..0.95 映到五张表。
设计理由（`engine.rs`）：

> so one knob covers "which table" without a new parameter and without a new UI control

导入的单周期波形是**另一条路**（`Table::from_cycle`）：重采样到 2048、去 DC、
一次正向 FFT，然后**每一级只从自己 Nyquist 以下的 bin 重建**（理想砖墙，**含相位**），
再逆变换——「Same guarantee, measured the same way」。

**必须保留相位**，单测 `an_imported_cycle_keeps_its_phase` 说明了原因：

> A **cosine** and a **sine** have the same magnitude spectrum, so a **magnitude-only** import
> would pass the balance test above and still play the **wrong waveform**.

### 10.3 硬同步

**硬同步（hard sync）**：从振（slave）的周期被主振（master）**强制重启**。
在重启瞬间波形出现**不连续**（saw 的阶跃、triangle 的斜率折点），
这是一个宽带事件，**朴素实现会严重混叠**。

本仓库的实现要点（`crates/synth-core/src/c_bridge/gs_daisy.cpp`、`engine.rs`）：

- OSC **2 是主**、OSC **1 是从**（`OSC1_SYNC` id 139）；
- 需要**两个振荡器都是 DaisySP 波形振荡器**——「a wavetable, a sample or noise has no cycle
  to restart」（`engine.rs`）；
- 从振**发出朴素波形**并在**每个不连续处**补核：从振自身回绕（saw/square 用 BLEP、
  triangle 用 BLAMP）+ 主振回绕造成的重启（值跳变用 BLEP、斜率折断用 BLAMP）；
- **过采样 `GS_SYNC_OS = 2`** + **95 抽头 Kaiser 抽取器**（§4.4）；
- 延迟比普通带限路径多 `GS_SYNC_DELAY = 32` 个过采样样本，因为「its ring accumulator holds the
  naive signal 32 oversampled samples ahead of the read head」；
- 频率必须**除以 `GS_SYNC_OS`** 传入：注释记录了一个真实错误——
  「passing it multiplied ran the pair at **OS² times the pitch**」。

**unison 与 sync 的组合语义**（`engine.rs`）：

> One pass per sub-voice: the **slave's stack sets the detuning and the master follows it**,
> so a sync'd unison stays one period.

**效果**（`docs/notes/hard-sync-aliasing.md`，真 wasm 门禁）：锯齿 **−32.1 → −72.3 dB**、
方波 **−33.5 → −71.1 dB**、三角 **−49.5 → −75.7 dB**；
未同步的从振读 **−0.0 dB**（全部离网），即「同步把从振拉回主振网格是有效的」。
门禁断言 `< −60 dB`、未同步 `> −3 dB`、周期相关 `> 0.95`、峰值 `≤ 1`、步进 `< 0.25`。

**残留技术债**（`docs/notes/hard-sync-aliasing.md` §P9.1c）：
修复后 **12/12 场景、396/396 个 4 s 窗全部 ≥ −60 dB，最差 −88.1 dB**，
但 `≥30 s 离散度 < 3 dB` 这条**只有三角达到（0.2–0.8 dB）**，
锯齿与方波是 **4.3–16.4 dB**；要压到 3 dB 需**更高过采样（4×）或重做核**。
另外 **44.1/96 kHz 的包络周期仍没有定量解释**：48 kHz 的 ~24 s 与
「11 值星形旋转一格 = 24.1 s」吻合，但同一模型给 44.1 kHz 31 s、96 kHz 12 s，
实测 **21 s、6 s**。

### 10.4 FM 与环形调制

- **FM / 相位调制（phase modulation, PM）**：用调制器改变载波的**相位**。
  本仓库用**相位调制**（不是频率调制），因为「The phase is *placed* for each sample rather than
  added, so the carrier keeps running at its own frequency and the 0..1 range the band-limited
  shapes need is never left」（`gs_daisy.h`）。
- **环形调制（ring modulation）**：两信号**相乘**，产生和频与差频，
  抑载波。本仓库在**两个完成的 block 上**做，「so it applies to every wave」
  （包括噪声与采样器）。

参数：`OSC_FM`（id **137**，0..1）、`OSC_RING`（**138**，0..1）。
调制矩阵也能调制这两者：`ModDst::Fm` 与 `ModDst::Ring`。

**FM 指数的形状**（`crates/synth-core/src/engine.rs`）：

```rust
/// Full-scale phase-modulation index, in carrier cycles (P6.1). Two cycles is a
/// bright, clangorous FM tone with sidebands well past the twentieth harmonic,
/// and the **squared curve** below keeps the bottom of the knob's travel usable
/// for the subtle end.
const FM_MAX_CYCLES: f32 = 2.0;
// …
let fm_cycles = FM_MAX_CYCLES * fm_depth * fm_depth;   // 平方曲线
```

即：**满刻度是 2 个载波周期**，且旋钮到指数的映射是 `depth²`——这是一个
**感知/可用性**决策（让旋钮下半程可精细调节），不是数学必然。

**调制器优先渲染**：`let order: [usize; 2] = if modulator { [1, 0] } else { [0, 1] };`
——OSC 2 必须先算出整块，才能拿去调制 OSC 1。**「A silent OSC 2 is still rendered when it
modulates: its level is how loud it is in the mix, not how much it modulates.」**

**波表的相位调制只加在读取相位上**：

```rust
// The offset is added to the read phase only: the oscillator keeps running at
// its own frequency, so a deep index cannot pull it out of tune or out of the table.
let read = match pm { Some((m, cycles)) => (phase + m[i] * cycles).rem_euclid(1.0), None => phase };
```

### 10.5 采样器

**采样器（sampler）** 用一段录音作为振荡器源：`rate = note / root`。
它天然会混叠（加速播放会抬高所有频率），所以用**mipmap**（§4.6、§15）。

本仓库的采样相关参数（`params.rs`）：

| 参数 | id | 语义 | 范围 |
| :-- | --: | :-- | :-- |
| `SMP_ROOT` | **96** | 采样以录制音高播放时的 MIDI 音符 | 0..127 |
| `SMP_MODE` | **97** | 0 = one-shot、1 = loop、2 = ping-pong | 0..2 |
| `SMP_LOOP_START` | **98** | loop 起点（**归一化 0..1**，不是样本号） | 0..1 |
| `SMP_LOOP_END` | **99** | loop 终点 | 0..1 |

**loop 点存成分数而不是样本号**，理由（`sampler.rs` 模块注释）：

> loop points are stored as fractions of the sample so they land in the **same place on every
> level**.

容量：`MAX_BASE_SAMPLES = 192_000`（**4 s @ 48 kHz**），
`MIN_BASE_SAMPLES = 64`，文件在 JS 侧**截断**到 4 s。
采样**出厂没有任何内容**——「采样是乐器级导入状态」，没有导入时**诚实静音**，
而不是给一个替代音色（`engine.rs`：「With nothing imported there is nothing to play:
silence is the honest answer, and the UI is where the player finds out why.」）。

### 10.6 复音、语音分配与等功率声像

**复音（polyphony）** 上限 `MAX_VOICES = 32`（`params.rs`），默认 `max_polyphony = 16`
（`VoiceManager::new`）。**unison** 每个振荡器最多 `MAX_UNISON = 7` 个子声部。

**语音分配（voice allocation）** 与**偷声（voice stealing）**：
当所有槽位都在忙时，选一个「最没价值」的受害者，
**强制它进入一段短释放**，并把新音符放进一个小**待处理队列**，
等槽位真正空闲再重触发——所以偷声**从不产生硬 click**（`voice.rs` 模块注释）。

受害者的判分函数（`find_victim`）：

```rust
let quiet = v.env_value.max(0.0);
let released_bonus = if v.released { -1.0 } else { 0.0 };
let age_penalty = v.age as f32 * 1e-6;
let score = quiet + released_bonus + age_penalty;   // 越小越该偷
```

即排序优先级：**已释放且安静** > 已释放 > 安静 > 最老。
单测 `stealing_prefers_released_and_quiet_voices` 把这三条都钉住了。

- 待处理队列容量 `PENDING_CAPACITY = 8`；队列满时 `NoteOnResult::Dropped`；
- **同一个受害者不会被重复排队**（`if !self.voices[victim].stealing`）；
- `STEAL_RELEASE = 0.02`（20 ms）：注释解释「20 ms is inaudible as a note ending but spreads
  the discontinuity over a **thousand samples**」——这直接关系到 §2.3 的步进门禁；
- **弹性复音（elastic polyphony）**：`force_release_excess(limit)` 保留**最新的** `limit` 个声部，
  其余走释放（prd.md §7.1 要求）。

**等功率声像（equal-power panning）**：

```rust
let angle = (pan + 1.0) * core::f32::consts::FRAC_PI_4;   // pan ∈ [-1,1] → angle ∈ [0, π/2]
let (pan_l, pan_r) = (angle.cos(), angle.sin());
```

因为 $\cos^2 + \sin^2 = 1$，总功率与位置无关。**代价是中心位置每声道 −3.01 dB**
（这就是 §1.4 里「−3.01」那一项的来源）。
**每个振荡器有自己的声像**，所以在立体声模式下是两个独立的等功率律；
**单声道模式下两个 PAN 按电平加权合并成一个位置**：

```rust
((osc_level[0] * params.osc[0].pan + osc_level[1] * params.osc[1].pan) / levels + mod_pan + voice_pan)
```

一个声部自身的位置 `voice_pan` 叠加在 patch 的声像之上（「a song layer can be placed in the
image without touching the preset」）。

**unison 的电平补偿**：栈内每个子声部增益 `1/sqrt(n)`（`gain = 1.0 / n.sqrt()`），
理由（`engine.rs`）：「so adding voices does not just make the patch louder」。
失谐范围：`spread × 35.0` 音分，对称分布在标称音高两侧。

---

## 11. 实时工程约束

### 11.1 块处理与渲染量子

**块处理（block processing）**：一次处理 $N$ 帧而不是逐样本，用来摊薄 FFI/函数调用开销。
本仓库模块注释：

> The render loop is block based: `gs_voice_*_block` calls into the vendored C/C++ DSP
> **amortise FFI overhead over 128..1024 frames**, exactly as prd.md §2.2 prescribes.

| 常量 | 值 | 出处 |
| :-- | --: | :-- |
| `MAX_BLOCK_SIZE` | 1024 | `params.rs` |
| 门禁 / bench 用的块 | 128 | `verify-audio.mjs` / `bench.mjs` |
| AudioWorklet 量子 | 128（浏览器给定） | Web Audio 规范 |
| 实时预算（128 帧 @48 kHz） | **2666.67 µs** | `BUDGET_US = (BLOCK/SR)*1e6` |

引擎对传入帧数**先钳位**：`let frames = frames.clamp(1, MAX_BLOCK_SIZE);`
（`engine.rs` `process`）。

### 11.2 零分配与 arena

这是本仓库最严格的一条实时约束：**音频线程绝不触发 `memory.grow`**。

做法（`crates/synth-core/src/alloc_arena.rs`）：在**静态内存**里放一个
**12 MiB、16 字节对齐**的 arena，用一个**首次适配（first-fit）+ 地址序合并（address-ordered
coalescing）**的空闲链表服务**所有**分配——Rust 自己的**以及** vendored C 的 `malloc`。
一旦模块实例化，线性内存**永不增长**，而且**每次分配都可计数**，用于零分配门禁。

```rust
pub const ARENA_SIZE: usize = 12 * 1024 * 1024;   // 12 MiB (P9.8)
```

**为什么是 12 MiB？** 注释给出了完整的算术（这是一段非常诚实的工程量记录）：

> P9.7 shipped **8 MiB**, which held the Soundpipe reverb/delay working set (~150 KB), the DSP
> scratch and the old sampler mipmap (~1.5 MB for a 4 s sample) with room to spare. P9.8's sampler
> levels are **~1.5× longer** (they cost **11.875 bytes per base sample** instead of ~8), and a
> 4 s sample plus a **96 KB** response — a combination `verify-audio.mjs` exercises — **left 169 KB
> free and then failed a later message-path allocation outright**. … the worst measured occupancy
> is a 4 s sample imported over another one, which peaks near **9.0 MB**, so 12 MiB leaves
> **~3 MB of headroom** while keeping the wasm module's linear memory comfortably under the
> **32 MB** `bench --long` bound.

也就是说：**arena 从 8 → 12 MiB 不是预先设计，而是被一次真实的 trap 逼出来的**
（`docs/NEXT-PLAN-2.md` §一 也记了同一件事）。这是一个**「测量驱动容量决策」**的范例。

**零分配门禁**：全局分配器在实时循环期间每做一次分配就累加一次 violation
（`enter_process` / `leave_process` + `IN_PROCESS` 原子标志）；
门禁断言 `gs_alloc_violations() == 0`（`scripts/bench.mjs`、`verify-audio.mjs`），
并且 `gs_alloc_count()` / `gs_arena_free_bytes()` 作为诊断暴露。

**arena 耗尽时的行为是「优雅拒绝」，不是崩溃**：

- `SampleError::NoRoom` → `gs_sample_import` 返回 **4** → UI toast（`smp.err.noRoom`）；
- `IrError::NoRoom` → `gs_ir_import` 返回 **4**；
- IR 的 `try_reserve_exact` 失败时「Returns false when the arena is full, so the host can
  **refuse the file instead of aborting**」；
- **拒绝时旧采样保留、不 trap**，且 `gs_sample_capacity()` 仍是 4 s。

自证（`docs/notes/band-limited-oscillators.md` §「自证 3」）：把 `ARENA_SIZE` 临时改成
**5 MiB** 重建 → 4 s 采样得到 `code 4 / noRoom`、**不 trap**、已加载的 0.1 s 采样仍在、
之后 200 块渲染无 trap 且 `gs_alloc_violations() == 0`。

**Arena 的测试约束**：`alloc_arena.rs` 的测试模块注释说明测试**必须串行**
（`--test-threads=1`，已接进 `npm run test:rust`），因为测试共享进程全局 arena，
一个测试的 `init()` 可能重置另一个测试持有的指针。

### 11.3 SIMD 与标量双核

**SIMD（single instruction, multiple data）** 在 wasm 上是 `simd128`（128 位 = 4 个 f32）。
本仓库提供**两份 wasm 产物**：

| 产物 | 路径 | 目标特性 |
| :-- | :-- | :-- |
| 主核 | `src/generated/synth_core.wasm` | `simd128` |
| 标量回退 | `src/generated/synth_core_scalar.wasm` | 无 `simd128`（老 Safari） |

`crates/synth-core/src/dsp/simd.rs` 的策略（模块注释）：

> prd.md §5.2 asks for SIMD **without the alignment traps** of raw `v128_load`.
> The stable route on `wasm32-unknown-unknown` is `core::arch::wasm32` **with a scalar fallback**,
> so the same code runs in `cargo test` on the host. Buffers are always 16-byte aligned
> (static arrays / arena payloads), and **the tail is handled scalar** so no out-of-bounds load
> can ever occur.

三个原语：`accumulate`（`out += in*gain`）、`scale_into`（`out = in*gain`）、
`mix2_into`（`out = a*ga + b*gb`），全部 `while i + 4 <= n { … }` + 标量尾巴。
单测 `mix2_handles_non_multiple_of_four` 专门测 13 元素（不是 4 的倍数）。

**标量回退不只是「另一种编译」**：`dsp/fmath.rs` 在**没有 `simd128`** 时用
位操作 + Newton-Raphson 实现 `sqrtf`（因为 wasm 的 `f32x4_sqrt` 不可用），
见 §11.4。

### 11.4 确定性

**确定性（determinism）** 指同一输入产生逐位相同的输出。本仓库在多个层面保证它：

1. **随机数是自持的 xorshift32**（`dsp/util.rs` `Rng`），
   `new(seed)` 把 0 换成 `0x9e3779b9`，`next_bipolar` 是 `[-1,1)`。
   **不依赖宿主 `Math.random`**：noise 路径用引擎自己的 RNG。
2. **无库调用（no libcalls）**：`dsp/fmath.rs` 模块注释解释了为什么必须自己实现数学函数：

   > On `wasm32-unknown-unknown`, Rust's `f32::sin`/`exp`/`log`/... lower to libcalls named
   > `sinf`/`expf`/..., so a shim that simply forwards to them would **recurse into itself**.
   > These implementations use only integer bit manipulation, wasm SIMD intrinsics
   > (sqrt/floor/ceil/trunc/nearest) and minimax/Taylor polynomials, so the vendored DSP can run
   > **with no libc at all**.

   精度目标：**~1e-7 相对误差**，且「Every function is unit-tested against `std` on the host」。
3. **`gs_init` 不复位相位计数器**：这不是疏忽，而是**门禁的依赖**——
   「the Nth note-on always starts on the same phases」，P9.6 因此能把相位钉成绝对种子 707。
   代价是**两次 `engine()` 调用不可逐样本比较**（见 §4.5 的时域探针设计）。
4. **arena 分配确定性**：固定 12 MiB + 首次适配，没有随机性。
5. **门禁层的确定性纪律**：`gs1.render`（规划中的 LLM 接口）要求
   「同输入两次**逐字节相同**（带 `sha256`）」、「所有随机入口吃 `seed`」、
   「渲染不用挂钟」（`docs/LLM-INTERFACE.md` §五）。

### 11.5 体积、带宽与 wasm-opt

网页合成器的分发约束是**首屏字节数**。本仓库把体积当作**门禁**而不是事后优化：

- `wasm-opt -Oz`（P11.1，v1.105.0）：raw **−31% / −35%**、dist **−195.5 KB**
  （`docs/NEXT-PLAN-2.md` §一 第 6 条）；
- 首屏文案裁剪（P11.2，v1.110.0）：首屏 JS gzip **134.65 → 123.75 KB（−10.89 KB）**、
  阈值 **136 → 125 KB**；
- **一个反直觉的实测结论：gzip 对 raw 不单调。** 合并两个滤波循环后
  raw **−360 B** 但 gzip **+51 B**；`#[inline(never)]` 在 `prepare_kernel`/`load` 上
  试过反而 gzip **+20 B**（已撤）。
  而把 `read_wrapped` 标 `#[inline(never)]` **省了 71 gzip 字节**
  （`docs/notes/band-limited-oscillators.md` §「体积」）。
  **纪律就是：每次体积改动都要真跑 `verify-budget`，不能靠推理。**
- **压线记录的坦诚**：1C 第一版 raw **212.5 KB** / gzip **75.05 KB**，
  **超 75.0 KB 线 51 字节**；抽出 `read_wrapped` 后 **74.98 KB（76 780 B）**，
  「**余 20 字节**」。这种数字必须原样保留在文档里，否则后来者会以为余量很大。
- `bench --long` 的线性内存上限：**32 MB**（实测 15.1 MB @ load 1.13 的安静窗口；
  11.1 MB 是 P9.7 时期的值）。
- `arena` 是 `.bss` 数组，所以**wasm 文件本身不变大**——
  12 MiB 的 arena 对下载体积的影响是「**raw −0.7 KB、gzip 74.5/75 未变**」
  （`docs/NEXT-PLAN-2.md` §一 第 16 条）。这是一个**容易误判的点**：
  运行时内存 ≠ 分发体积。

---

---

# 第二部分 · 本合成器的模块与设计原理

> 本部分每个模块统一按 **目标 → 信号流位置 → 算法 → 为什么这么选 → 实测数字 → 已知边界** 组织。
> 「实测数字」全部标注来源；凡未实测的都写明。

---

## 12. 引擎总览与信号流

### 12.1 目标

一个**在浏览器里实时运行、逐位可复现**的双振荡器减性合成器，带自由效果路由图、
采样/波表导入、双实例层叠，并且每个 DSP 决策都能被**两把独立的尺子**验证。

### 12.2 信号流（一次 `gs_process`）

`crates/synth-core/src/engine.rs` 的 `Engine::process(frames)`：

```text
1. frames = frames.clamp(1, MAX_BLOCK_SIZE=1024)
2. alloc_arena::enter_process()          ← 开始零分配监视
3. update_smoothing(frames)              ← 连续参数一阶平滑（SMOOTH_TAU_S = 0.02）
4. flush_pending()                       ← 提升被偷声排队的音符
5. apply_env_to_all()（若 env_dirty）     ← 包络系数重算
6. 全局 LFO 1 / LFO 2 → lfo_buf / lfo2_buf（每块渲染一次）
7. mix_l / mix_r 清零
8. for slot in 0..MAX_VOICES: 若 active → render_voice(slot, …)
9. graph_env = max(所有发声 voice 的 env_value)   ← 图内包络源的「总线级 follower」
10. fx_l[i] = mix_l[i] + dither;  fx_r[i] = mix_r[i] - dither    ← ±1e-15 交替，防 denormal
11. apply_fx(frames)                     ← 链模式或自由图模式
12. master_volume 线性斜坡 → lookahead limiter → soft_limit → out_l/r（+ NaN 计数）
13. 输出 RMS 累加（loudness_rms）
```

`alloc_arena::leave_process()` 在末尾关闭监视。**任何在此区间发生的分配都会让
`gs_alloc_violations()` 增加**，从而让零分配门禁失败。

### 12.3 每个声部内部（`render_voice`）

```text
a. 音高：pitch_hz_with(note, master_tune, tuning) × glide × bend × mod_pitch
b. 包络：envs[slot].process(gate)  →  amp
c. 滤波包络：filter_envs[slot]      →  env_last（也喂给调制矩阵）
d. 振荡器：
   - 若 OSC1_SYNC 且两振荡器都是 DaisySP 波形 → gs_voice_osc_sync_block（2× 联动）
   - 否则（FM 时先渲染 OSC2）render_oscillator ×2（含 unison / sub）
   - 环形调制（两块相乘）在两者都完成之后
   - 噪声混入（NOISE_MIX）
e. mix2_into(a, b, voice_buf, level_a, level_b)
f. FILTER_TRIM = 0.65 预衰减
g. 滤波：
   - 可选 2× 上采样（os_active = OVERSAMPLE && 非 comb/formant && env_last >= SILENT_VOICE）
   - Comb（Rust）或 Formant（DC 阻断，C 桥）或 ladder/SVF（含第二级）
   - 第二级路由 Off / Serial / Parallel（FILTER_BLEND 线性律）
   - 2× 下采样（os_active 时）
   - 补回 makeup（FILTER_TRIM 的倒数）
h. 声像（等功率）：gain = VOICE_GAIN × patch_gain；stereo 时每振荡器独立，mono 时按电平加权
i. 若 !gate && !env.is_active() → vm.release_slot(slot) 并复位包络
```

**性能捷径**：第 g 步的 `audible = env_last >= SILENT_VOICE`（`SILENT_VOICE = 0.002`，约 −54 dB）。
不可闻的声部**跳过整个滤波链**（连 2× 往返一起跳过），只累加 `silent_blocks` 计数。
理由：

> Release tails are the expensive half of a long-release patch: a dense song keeps a dozen voices
> ringing well below **-50 dB**, and filtering them cannot be heard.
> （`crates/synth-core/src/engine.rs`）

这个计数器**本身是门禁的一部分**：`song-quality` 检查 `silentBlocks > 100`，
确保这个「快捷路径确实在密集歌曲上生效」——即**优化必须真的触发**，而不是只写在代码里。

### 12.4 ABI 与导出面

`crates/synth-core/src/abi.rs` 定义 `extern "C"` 面。**`ABI_VERSION: u32 = 8`**，
版本历史（源码注释）：

| 版本 | 增加的内容 |
| --: | :-- |
| 2 | true-peak / loudness / limiter 计量 |
| 3 | 单周期波表导入 |
| 4 | 脉冲响应导入 |
| 5 | 采样导入 |
| 6 | 第二实例（参数 + 键/力度路由） |
| **8** | （当前）覆盖槽 + 覆盖槽调制总线（P9.3）等 |

导出函数分组（全部 `gs_*`）：

| 组 | 代表 | 备注 |
| :-- | :-- | :-- |
| 生命周期 | `gs_init(sample_rate, max_polyphony)`、`gs_reset` | `gs_init` **不复位**参数块/调制矩阵/相位计数器 |
| 渲染 | `gs_process(frames)` → 活跃声部数 | `frames` 被钳到 `MAX_BLOCK_SIZE` |
| 缓冲指针 | `gs_left_ptr` / `gs_right_ptr` / `gs_spectrum_ptr` | 原始指针进静态缓冲 |
| 查询 | `gs_spectrum_bins`(=36)、`gs_max_block_size`(=1024)、`gs_max_voices`(=32)、`gs_abi_version`(=8) | |
| 波表 | `gs_wavetable_import_ptr/capacity/import/clear/has` | `import` 返回 0 ok / 1 too short / 2 silent / 3 not finite |
| 采样 | `gs_sample_import_ptr/capacity/import/clear/has` | `import` 另加 **4 = arena 装不下（NoRoom）** |
| 脉冲响应 | `gs_ir_import_ptr/capacity/import/clear/has` | 同样有 **4 = NoRoom** |
| 参数 | `gs_set_param(id, value)`、`gs_set_param_inst(instance, id, value)` | `id` 是 0..`PARAM_COUNT-1` |
| 调制矩阵 | `gs_set_mod_route(index, src, dst, amount, enabled)` | `MOD_ROUTES = 8` |
| 效果池 | `gs_fx_slot_count`(=6)、`gs_delay_pool_capacity/used`、`gs_delay_max_seconds`、`gs_conv_pool_capacity/used`、`gs_fx_graph_sync`、`gs_fx_mod_slots`(=4) | 编辑器用它算出「还能分配多少延迟时间」 |
| 音符 | `gs_note_on/note_off/all_notes_off/pitch_bend/mod_wheel/aftertouch`、`gs_note_on_pan` | |
| 实例路由 | `gs_set_instance_route(mode, split_note, a_lo, a_hi, b_lo, b_hi)`、`gs_instance_voices` | |
| 诊断 | `gs_peak_l/r`、`gs_take_true_peak`、`gs_loudness_rms`、`gs_limit_reduction`、`gs_silent_voice_blocks`、`gs_active_voices`、`gs_nan_events`、`gs_oversample_latency` | |
| 分配诊断 | `gs_alloc_count`、`gs_alloc_violations`、`gs_reset_alloc_violations`、`gs_arena_free_bytes` | |

**`PARAM_COUNT = 224`**、**`MAX_VOICES = 32`**、**`MAX_BLOCK_SIZE = 1024`**、
**`SPECTRUM_BINS = 36`**、**`MOD_ROUTES = 8`**、**`MAX_UNISON = 7`**、**`FX_SLOTS = 6`**、
**`MOD_SLOTS = 4`**、**`OVR_SLOTS = 4`**、**`OVR_MOD_SLOTS = 8`**
（`crates/synth-core/src/params.rs`）。

**参数 id 的「只追加」纪律**：注释反复强调 id 是**分享码的线格式**，
所以新参数**永远追加在末尾**，而不是插到语义相邻的位置。最清楚的一处原文：

> How far OSC 2 pushes OSC 1's phase around, 0..1 (P6.1). 0 keeps the oscillators exactly as they
> were before this existed, which is why **the parameter is appended here rather than slotted in
> next to the other oscillator controls: ids are the share-code wire format.**

### 12.5 双核（SIMD / 标量）

构建产出两份 wasm（`crates/synth-core/build.rs` + `scripts/build-wasm.mjs`）：
`src/generated/synth_core.wasm`（simd128）与 `src/generated/synth_core_scalar.wasm`（回退）。
**两份必须在行为上一致**，因为 `npm run test:wasm` 会检查 features 与两者都在。

### 12.6 已知边界

- `gs_init` 不复位相位计数器 ⇒ **两次 `engine()` 调用不可逐样本比较**（门禁因此在同一音符内做时域探针）。
- `gs_init` 不复位参数块与调制矩阵 ⇒ **门禁各 section 之间有顺序依赖**（见 §31）。
- `graph_param_field` 的 `base <= id < base + FX_SLOTS` 让节点参数区与其它参数**编号重叠**
  （`FX_NODE_OUT_GAIN+1 == FX_DELAY_MIX`、`FX_NODE_TO_OUT+5 == FX_PARALLEL3`、
  `FX_NODE_IN1+5 == FX_EQ_ON`），后果是**宿主无法把 6 个节点全部清干净**
  （JS 探针出现「节点 2 读节点 1」的双驱动，**rms 是链的 2 倍**）。修它要动参数编号，
  属「相容红线级」，**已知但未修**（`docs/notes/oversampling.md`；`docs/NEXT-PLAN-2.md` §一 第 11 条）。

---

## 13. 振荡器

### 13.1 目标与信号流位置

产生两个（可选 unison 叠加的）波形块，支持 sine / triangle / saw / square / pulse / noise /
pink / brown / wavetable / sample，外加 sub 振荡器、相位调制、环形调制与硬同步。
位置：信号链最前端，在包络与滤波之前。

### 13.2 算法与「三条振荡器路径」

本合成器有三条**不同质量/成本**的振荡器路径，`render_wave` 按波形分派：

| 路径 | 波形 | 实现 | 实测最差非谐波地板 |
| :-- | :-- | :-- | --: |
| **1. DaisySP 原生** | 仅 `sine` | C 桥 `dsp::Oscillator` | **−119.4 dB**（正弦没有可折的谐波） |
| **2. 带限朴素 + BLEP/BLAMP + 2×** | saw / square / pulse / triangle | `gs_voice_osc_bandlimit_block`（P9.1b） | 锯齿 **−100.8**、方波 **−111.3**、三角 **−72.9 dB**（同一批的门禁注释把三角的最差记为 **−73.1 dB**——同一指标两次记录差 0.2 dB） |
| **3. 硬同步联动** | 上述波形两两组合 | `gs_voice_osc_sync_block`（P6.2/P9.1c） | 12 场景最差 **−88.1 dB** |
| **4. Rust 侧** | noise / pink / brown / wavetable / sample | `crates/synth-core/src/engine.rs` | 见 §14、§15 |

**路径分派的判据**（`is_bandlimited_wave`）：

```rust
matches!(wave, Wave::Saw | Wave::Square | Wave::Pulse | Wave::Triangle)
```

注释解释了为什么 sine 不走带限路径：

> The report's section 4.2 pins the two-point polyBLEP's folding floor on the shapes with a
> discontinuity or a slope kink: saw/ramp, square/pulse and triangle. **A sine has no harmonics to
> fold (its apparent floor is the ruler)**, and the wavetable, sample and noise paths are not
> generated by DaisySP's oscillator at all.

**延迟补偿**：带限路径有**固定 23.5 个 1× 样本**的延迟（95 抽头对称 FIR 的群延迟 = 47/2）。
「其余所有路径都比它早 23.5 样本」，所以**非带限路径被主动延迟**以对齐：

```rust
// Every path but the band-limited one is 23.5 samples early now.
if !bandlimited { gs_voice_osc_delay_block(…) }
```

原语是「23 样本整数延迟 + 4 抽头 cubic Lagrange 半样本插值」。
理由：「Mixing an undelayed sine with a delayed band-limited saw **would comb**」。

### 13.3 unison

`OSC1_UNISON` / `OSC2_UNISON`（id 70 / 72），范围 **1..`MAX_UNISON`(=7)**
（`Params::set` 里 `clamp(1, MAX_UNISON)`）。实现：

```rust
let n = unison as f32;
let gain = 1.0 / n.sqrt();                        // 电平补偿：不是让 patch 变响
let max_cents = params.spread.clamp(0.0, 1.0) * 35.0;   // spread 0..1 → ±35 音分
for sub in 0..unison {
    let t = (sub as f32 / (n - 1.0)) * 2.0 - 1.0;  // 对称分布在 [-1, 1]
    let detune = semitone_ratio(t * max_cents / 100.0);
    let sub_freq = (freq * detune).clamp(0.25, 24_000.0);
    …
}
```

要点：

- **失谐是对称分布在标称音高两侧**的，`spread = 0.35` 是默认（约 ±12 音分）；
- 每个子声部的增益是 `1/sqrt(n)`，**不是** `1/n`——这是「等功率叠加」的常见约定；
- 每个子声部是**独立状态**（`gs_voice_osc_set(slot, which, sub, …)`），
  所以 C 桥为每个 (voice, osc, sub) 维护一份相位与 mip 历史；
- **unison 叠加后再做一次延迟补偿**：
  > The stack is a sum, so delaying it once is the same as delaying every sub-voice:
  > the compensation is **one call, not one per voice**.

### 13.4 sub 振荡器

`OSC1_SUB` / `OSC1_SUB_LEVEL`（id 140/141）、`OSC2_SUB` / `OSC2_SUB_LEVEL`（142/143）。
`sub` ∈ {0 关, 1 低一个八度, 2 低两个八度}，实现在 Rust（`add_sub`）：

```rust
let step = freq / (1u32 << octaves) as f32 / sample_rate;
*value += (p * TAU).sin() * level;
```

三条设计理由（源码注释）：

1. **一个正弦就够**：「A sine has no harmonics to alias and needs no filter」；
2. **每个振荡器一个 sub，不是每个 unison 子声部一个**：
   「a sub that is detuned with the unison stack would only muddy the bottom」；
3. **sub 跟随振荡器的电平**：「It rides the oscillator's own level, so fading the oscillator out
   fades its sub with it」。

**sub 在硬同步下依然存在**：sync 分支结束后单独调用了两次 `add_sub`，
注释说「so turning sync on does not silently take them away」。

### 13.5 相位调制（FM）

见 §10.4。核心要点重述为工程决策：

- **指数 = `FM_MAX_CYCLES(=2.0) × depth²`**，平方曲线是为了「keeps the bottom of the knob's
  travel usable for the subtle end」；
- **调制器（OSC 2）必须先渲染整块**（`order = [1, 0]`）；
- **波表的 PM 只偏移读取相位**（不改变振荡器自身频率），
  「so a deep index cannot pull it out of tune or out of the table」；
- **噪声与采样器忽略 PM**（「not periodic in the same sense」）。

### 13.6 环形调制

在**两个完成的 block 上**做乘法，「so it applies to every wave」（包括噪声与采样器）。
`OSC_RING`（id 138）0..1 线性混合：

- `0` = 普通混合（`a·levelA + b·levelB`）；
- `1` = 只有乘积。

### 13.7 实测数字与门禁

`scripts/verify-audio.mjs` 的 §3c「aliasing across the wave list」对每个谐波丰富的波形在
键盘顶部测量，阈值（注释给出实测最差）：

| 波形 | 断言阈值 | 实测最差 |
| :-- | --: | --: |
| triangle | −68 dB | −73.1 dB |
| saw | −95 dB | −100.8 dB |
| square | −105 dB | −111.3 dB |
| sine | −105 dB | −119.4 dB |

另有「**8 个全新场景的离散度 < 20 dB**」这一条**不是逐位相同**的断言。
原因（`docs/notes/band-limited-oscillators.md` §P9.1b）：

> 旧「同一个场景连做 8 次逐位相同（当时读 0.00 dB）」在带限路径上**语义不再成立**
> ……改成「8 个全新场景的离散度 < 20 dB」（拦 P9.1c 那种 86 dB 爆发），
> 实测锯齿 **7.26** / 方波 **4.65** / 三角 **0.61 dB**。

### 13.8 已知边界

- **DaisySP 2 点 polyBLEP 的 −40 dB 折叠地板**是路径 1/2 分家的原因；
  带限路径把它压到 −100 dB 量级。
- **三角最差**（−72.9 dB @3520 Hz）是所有波形里最低的，
  因为它的 BLAMP 修正是**平滑斜坡**，对制表分辨率更敏感（见 §4.3）。
- 带限路径的 CPU 成本（`docs/notes/band-limited-oscillators.md`，1/4/8/16 声部）：
  **1.44× / 1.98× / 2.28× / 2.55×**（34/61/97/170 µs → 49/121/221/434 µs，同机交替跑取最好值）。

---

## 14. 波表与单周期导入

### 14.1 目标

用少量参数提供五种出厂音色，并允许玩家导入任意单周期波形，**两者都不混叠**。

### 14.2 五张出厂表与「配方」思想

见 §10.2 的配方表。选择哪张表用的是**脉宽旋钮**：

```rust
let recipe = ((pw.clamp(0.0, 1.0) * 4.0).round() as usize)
    .min(crate::dsp::wavetable::RECIPES.len() - 1);
```

即 `round(pw × 4)`，0.05..0.95 映到 `organ / hollow / vocal / metallic / glass`。
`WT_USER`（id 79）为 1 时优先使用**导入的单周期表**（`Table::from_cycle`）。

### 14.3 P9.7 的核心修法：每级全长、只降谐波上限

| 常量 | 值 | 含义 |
| :-- | --: | :-- |
| `BASE_LEN` | **2048** | **每一级**的表长（P9.7 之后） |
| `LEVELS` | **9** | mip 级数（8/16/…/2048 谐波上限的对数） |
| `MIN_CYCLE` | **64** | `from_cycle` 接受的最短周期 |

谐波上限：

```rust
fn level_top(level: usize) -> u32 { ((BASE_LEN >> level) / 2).max(1) as u32 }
```

`/2` 是**一个整八度的余量**（理由见 §4.6 引文）。
`level_for(freq, sr)` 选出**满足 `freq × level_top(level) <= sr/2` 的、level 最小（表最长）的那一级**。

### 14.4 两条构建路径

**(a) 配方（`from_recipe`）**：正弦求和 + 峰值归一化。高次谐波直接**不生成**——
「that *is* the band-limiting, and it is why a high note cannot alias」。

**(b) 导入单周期（`from_cycle`）**：

1. `< MIN_CYCLE` → `TooShort`；含非有限值 → `NotFinite`；
2. 线性重采样到 2048（`step = cycle.len()/2048`，环绕索引）；
3. 去 DC（减均值）；`rms <= 1e-4` → `Silent`；
4. 一次 f64 正向 FFT；
5. **每一级**：把 `bin == 0` 或 `bin > level_top(level)` 的 bin 清零，
   其中 `bin = if k <= n/2 { k } else { n - k }`（**把上半个谱折到它的镜像，一个测试覆盖两侧**）；
6. 逆 FFT（**不做抽取——逆变换本身就是那一级**）；
7. **每级独立峰值归一化**（「so switching level as the pitch rises cannot jump in loudness」）。

**保留相位**是关键：

> Each level is then rebuilt from the bins below its own Nyquist — DC and everything above dropped,
> **nothing else touched** — so the levels are brick-wall band-limited *and* keep the original phase,
> which is what makes an imported saw still look like a saw rather than like a pile of cosines.

对应的单测 `an_imported_cycle_keeps_its_phase` 用「余弦 vs 正弦同幅度谱」构造反例：
「a magnitude-only import would pass the balance test above and still play the **wrong waveform**」。

### 14.5 实测数字

**P9.5（修前，未达标）**：验收线是「≥1 kHz 非谐波能量 ≤ −60 dB」，
实测最差 **−25.8 dB**（vocal 表 @ C8 = 4186 Hz）。逐源（dB）：

| 音源 | 1047 Hz | 2093 Hz | 3520 Hz | 4186 Hz | 最差 |
| :-- | --: | --: | --: | --: | --: |
| organ | −46.7 | −37.7 | −32.4 | −31.0 | **−31.0** |
| hollow | −41.8 | −36.6 | −34.1 | −32.8 | **−32.8** |
| vocal | −40.9 | −30.2 | −26.9 | −25.8 | **−25.8** |
| metallic | −34.4 | −33.9 | −30.9 | −30.0 | **−30.0** |
| glass | −33.8 | −32.8 | −40.7 | −37.3 | **−32.8** |
| 用户单周期锯齿 | −38.1 | −34.8 | −32.6 | −31.2 | **−31.2** |
| 采样 | −30.4 | −29.9 | — | −31.0 | **−29.9** |

对照：**同一把尺子上的纯正弦读 −117.8 dB**——所以这 80+ dB 的差**不是尺子的账**。

**(P9.7 修后)** 逐音高（65 / 131 / 1047 / 2093 / 3520 / 4186 Hz，括号为改前）：

| 音源 | 65 | 131 | 1047 | 2093 | 3520 | 4186 | ≥1 kHz 最差 |
| :-- | --: | --: | --: | --: | --: | --: | --: |
| organ | −112.8 | −115.3 | −112.3 (−46.7) | −109.6 (−37.7) | −102.1 (−32.4) | −108.3 (−31.0) | **−102.1** |
| hollow | −106.7 | −113.8 | −107.8 (−41.8) | −109.8 (−36.6) | −119.7 (−34.1) | −110.0 (−32.8) | **−107.8** |
| vocal | −107.9 | −116.4 | −108.7 (−40.9) | −104.9 (−30.2) | −103.9 (−26.9) | −104.8 (−25.8) | **−103.9** |
| metallic | −94.7 | −104.4 | −98.1 (−34.4) | −104.3 (−33.9) | −116.3 (−30.9) | −108.4 (−30.0) | **−98.1** |
| glass | −88.5 | −96.6 | −98.0 (−33.8) | −107.5 (−32.8) | −103.5 (−40.7) | −111.0 (−37.3) | **−98.0** |
| 导入单周期锯齿 | — | — | −101.8 (−38.1) | −107.5 (−34.8) | −105.4 (−32.6) | −108.2 (−31.2) | **−101.8** |

**验收线达到**：≥1 kHz 全部在 **−98.0 … −119.7 dB**，比 −60 dB 线低 **38 dB 以上**。
一条值得注意的旁证：同一条全谱锯齿在 **33 Hz 从 −48.6 降到 −119.0 dB**；
而 **glass 在 65 Hz 只到 −88.5 dB**，原因是

> 65 Hz 时全部工厂谐波都在引擎自己的 18 kHz 低通以内，**地板是滤波器的阻带**，不是表。

### 14.6 为什么工厂表**不是**采样（一个可复用的设计结论）

「配方」路线让「带限」成为**生成器的性质**，而不是「一次小心的重采样步骤」的结果。
代价是：

- 表总量 **5 × 4088 = 20440 采样（80 KB）→ 5 × 18432 = 92160 采样（360 KB）**；
- `gs_init` 的 best-of-9 时间 **3.82 ms → 12.06 ms（+8.2 ms）**；
- 引擎 arena 余量 **4655 KB → 4375 KB（−280 KB）**。

### 14.7 已知边界

| 边界 | 数字/说明 | 出处 |
| :-- | :-- | :-- |
| 表在 .bss/静态区，加载变慢 | +8.2 ms @ `gs_init` best-of-9 | `docs/notes/band-limited-oscillators.md` §P9.7 |
| level 8 只覆盖键盘之外 | 级 8（速率 128–256×）只有 **93.75 Hz** 内容，「任何门禁范围都不覆盖它」（**无实测 dB**） | 同上 |
| 源文注释与笔记的**口径差** | `wavetable.rs` 注释写「worst factory bank … to **−105 dB**」，而门禁笔记的实测最差是 **−98.0 dB** | 见 §32.3 |
| 客观音色变化 | 五张表 ≥1 kHz 的「谐波网格 / 非谐波」差从 **~26 dB 拉到 ~100 dB 以上**；C8 峰值 vocal **0.092 → 0.107**、organ **0.096 → 0.114**（约 +1.3…+1.5 dB）；81 条预设里**只有 4 条**（`wtorgan`/`wtvocal`/`wtmetal`/`wtglass`）动 | 同上 |

---

## 15. 采样器与 mip 链

### 15.1 目标

把一段玩家导入的录音当作音源，按音符速率播放，**同时避免加速播放造成的混叠**，
并且在 arena 装不下时**优雅拒绝**而不是崩溃。

### 15.2 常量与约束

| 常量 | 值 | 含义 |
| :-- | --: | :-- |
| `MAX_BASE_SAMPLES` | **192000** | 4 s @ 48 kHz（**内存**上限，也是音乐上限） |
| `MIN_BASE_SAMPLES` | **64** | 重采样后接受的最短长度 |
| `LEVELS` | **9** | mip 级数：1/1、1/2 … 1/256 的速率 |
| `MIN_LEVEL_LEN` | **256** | 最短 mip 级（「a few hundred samples still loop smoothly」） |
| `LEVEL_NYQUIST` | **0.25** | 内容在自身 Nyquist 中的位置（P9.8 核心） |
| `CHAIN_TAPS_EARLY` | **192** | 建 level 1..3 的滤波器抽头 |
| `CHAIN_TAPS_LATE` | **96** | 建 level 4..8 的滤波器抽头 |
| `KERNEL_TAPS` | **16** | 播放插值核抽头（4 项 BH 窗 sinc） |
| `KERNEL_PHASES` | **1024** | 相位表列数 |
| `KERNEL_ROWS` | **1025** | 相位表**行数**（= phases + 1，见 §16.4） |
| `FIRST_TAP` | **−7** | 核第一个抽头相对读取位置整数部分的位置 |

### 15.3 级长公式（P9.8 的核心）

两个约束同时成立：

1. level `k` 必须**带限到 `SR / 2^(k+1)`**（否则速率到 `2^k` 会折回）；
2. 它的内容必须落在**该级表的 `LEVEL_NYQUIST = 0.25`** 处（否则插值核的镜像会回来）。

**这两条约束合起来确定该级的表长。** 但请注意：源码注释与工程笔记对**这个长度的表达式**
给出的写法**不完全一致**，此处如实并列，并说明我没有独立推导验证：

| 来源 | 表长的写法 |
| :-- | :-- |
| `crates/synth-core/src/dsp/sampler.rs`（`LEVEL_NYQUIST` 注释） | 一般式 `SR / 2^(1 + log2(1/LEVEL_NYQUIST) − k)` 个样本，并断言「**which is `SR / 2^(k+1)` for this value**」 |
| `docs/notes/band-limited-oscillators.md` §P9.8 | 「存在 **`SR / 2^(k-1)`** 的表里」 |

把 `LEVEL_NYQUIST = 0.25` 代进一般式得 `SR / 2^(3−k)`，它与源码自己给出的
`SR / 2^(k+1)` 只在 **k = 1** 时相等，与笔记的 `SR / 2^(k-1)` 只在 **k = 2** 时相等。
**三个写法不可能同时成立**；我**没有**独立推导来判定哪一个正确
（需要精细地对齐「表采样率 / 读步进 / 内容带宽」三者的单位），
因此本文**不给出一个确定的公式**。可确定的是**设计意图**（原文）：

> **every level gets the widest band its own rate range allows**, and none of them is short.

以及**可实测的结论**（`docs/notes/band-limited-oscillators.md` §P9.8）：
每级输出带宽 **12–24 kHz**、级 1/2 收窄到 **3–12 kHz**（见 §15.9）、
`mipmap_samples(N) = 2.9921875·N`（即 **11.875 B / 底采样**，见 §15.7）
——池大小是**实测**的，不依赖上面那条公式。

对应的读取速率换算（这个在源码里没有歧义）：

```rust
pub const fn level_shift(level: usize) -> usize { if level == 0 { 0 } else { level - 1 } }
```

即读步进 = `rate / 2^level_shift(level)`，**而不是** `rate / 2^level`——
「P9.8's levels are longer than their index implies」（`engine.rs` 的注释）。

### 15.4 链式滤波：为什么前 192 后 96

`CHAIN_TAPS_EARLY/LATE` 的注释就是一份完整的取舍记录：

- **前段（建高音读的 level）**：滤波器的**过渡带**才是折回源。
  「at 192 taps a harmonic just above the level's band is **40-60 dB further down** than at 96
  （2960 Hz read **−87.5 dB** with 192, **−66.6** with 96）」；
- **后段（建短表）**：表只有几百样本，loop 起点在几个样本内，
  「a 192-tap filter's edge-clamped region covers the whole loop and the seam folds back
  （8372 Hz read **−58.1 dB** with 192 taps, **−80.2** with 96）」；
- **全键盘实测最差**：**192/192 −58.1 dB、96/96 −66.6 dB、192 前 + 96 后 −77.3 dB**。

门禁里专门有一行钉住这个选择（`scripts/verify-audio.mjs`）：

> This row is what pins the chain's per-stage filter length: with 192 taps everywhere
> **8372 Hz folds back to −58 dB**, with the shorter late-stage filters it is **−81 dB**.
> **Without it that choice could be undone silently.**

### 15.5 16 抽头窗 sinc 插值核

- 4 项 Blackman-Harris 窗 sinc，**1025 行 × 16 抽头**的相位表，
  相位间**线性插值**；
- 在**导入路径**预计算（「one `sin`/`cos` per tap per phase, **never in `process`**」）；
- 平坦度：**带内 0.01 dB**；在 ν = 1/4 处成像 **−86 dB**（三次只有 −34 dB）。

**为什么 1/4 是可达的、而不是更保守的 1/16？**

> That quarter is only affordable because the read is a 16-tap windowed sinc rather than a cubic;
> the four-point kernel needs the content down at a **sixteenth**.

### 15.6 实测数字

**P9.5（修前）**：采样 **−30.4 / −29.9 / — / −31.0 dB**（最差 **−29.9**）。
**P9.7**：`position`/`direction`/`step` 改 **f64** + 线性 → **4 点三次 Lagrange**：
**−29.9 → −33.4 dB**（note 84/96/108 = **−40.3 / −36.9 / −33.4**）。
**P9.8（最终）**：

| 门禁行 | 顶棚（=实测最差 +5 dB） | 实测最差 |
| :-- | --: | --: |
| 高音 84/96/108 | **−81 dB** | **−86.4 dB** |
| 键盘顶端 114/120 | **−75 dB** | **−81.0 dB** |
| 低音 36/48/60 | **−77 dB** | **−82.0 dB** |
| 第二把尺子（Hann Goertzel @C7 空隙） | **−120 dB**（且 BH-7 < **−85**） | **−147.9 dB**（BH-7 −90.1） |

逐音高：1047 **−86.4** / 2093 **−90.1** / 4186 **−92.7 dB**（1A 阶段是 −75.3/−73.8/−70.5），
**全键盘最差 −81.0 dB**（1A 阶段 −46.6）。带宽**每级 12–24 kHz 全拿回**。

### 15.7 池大小与内存（**「实测驱动容量」的范例**）

`mipmap_samples(N) = 2.9921875·N`，即**每个底采样 11.875 B**（P9.7 抽取链约 8 B）。
逐档池（`docs/notes/band-limited-oscillators.md` §P9.8）：

| 底表 | 池采样数 | 池大小 | P9.7 抽取链 | Δ |
| --: | --: | --: | --: | --: |
| 32768（门禁样本） | 98048 | **383 KB** | 256 KB | +127 KB |
| 12000（0.25 s） | 35906 | **140 KB** | 94 KB | +46 KB |
| 48000（1 s） | 143625 | **561 KB** | 373 KB | +188 KB |
| 96000（2 s） | 287250 | **1122 KB** | 747 KB | +375 KB |
| **192000（4 s 上限）** | 574500 | **2244 KB（实测）** | 1497 KB | **+747 KB** |

**P9.7 曾估计 4 s 需要 ≈18 MB（会爆 8 MiB arena）；实际 2.24 MB，小 8 倍。**
最坏占用：老池 2244 + 新池 2244 + staging 750 + 引擎 ~3817 ≈ **9.1 MB**，
所以 **12 MiB 留 ~3 MB**；模块线性内存 **11.1 → 15.1 MB**（`bench --long` 上限 **32 MB**）。
关键：**arena 是 `.bss` 数组，wasm 文件本身不变大**（体积门禁不受影响）。

### 15.8 `NoRoom`：优雅拒绝

`SampleError::NoRoom` → `gs_sample_import` 返回 **4** → UI 走 `smp.err.noRoom` toast。
设计原则（源码注释）：

> Refused with a reason rather than truncated: **a short chain would silently play the wrong
> level, and with it the wrong band.**

并且**拒绝时旧采样保留、不 trap**，`gs_sample_capacity()` 仍是 4 s。
自证：把 `ARENA_SIZE` 临时改成 **5 MiB** 重建 → 4 s 采样得到 `code 4 / noRoom`、不 trap、
已加载的 0.1 s 采样仍在、之后 200 块渲染无 trap 且 `gs_alloc_violations() == 0`。

### 15.9 已知边界

| 边界 | 说明/数字 |
| :-- | :-- |
| **级 1/2 的输出带宽被换掉了** | 级 1/2（速率 **1–4×**）输出带宽收窄到 **3–12 kHz**（P9.7 抽取链是 10.6–21 kHz）；级 3 及以上更宽；**根音及以下逐字未变**。补回级 1 的 6–12 kHz 需 **+0.77 MB**（4 s 上限），代价是那一档地板从 **−79** 抬到 **≈−60**。当前选择保持现状（**10 dB 余量**） |
| **级 8 无门禁覆盖** | 级 8（速率 128–256×）只有 **93.75 Hz** 内容，「任何门禁范围都不覆盖它」（**无实测 dB**） |
| **导入耗时的绝对数字不可跨会话比** | 4 s 导入 **273.9 ms**（P9.8 记录）与同机 **157.6 ms** 差 **1.74×**；纪律是「**同机同探针的改前/改后**」 |
| **导入在消息路径上会卡顿** | 4 s 样本 mipmap 构建 **273.9 ms**（后来同机 157.6 ms、141.1 ms）；filter 16–64 → 192 抽头；32768 点 26.4 ms、1 s 39.3 ms |
| **>4 s 文件在 JS 侧截断** | `src/audio/userSample.ts` 注释确认 4 s 上限 |
| **无出厂采样** | 采样是**乐器级导入状态**；没有导入时**诚实静音**（不替代音色） |

---

## 16. 硬同步

### 16.1 目标与失败史（**本文档最值得细读的一节**）

**硬同步（hard sync）**：OSC 2 是主、OSC 1 是从；主振每次回绕都**重启从振的周期**。
从振波形在重启瞬间出现不连续（saw/square 的值跳变、triangle 的斜率折点），
这是一个宽带事件，**朴素实现严重混叠**。

本仓库的这段历史是「三次修正、两次失败、两次根因误判」的完整案例：

| 阶段 | 版本 | 做了什么 | 结果 |
| :-- | :-- | :-- | :-- |
| 起点 | v1.84.0 | 交付硬同步/sub/噪声 | P6.2 的「≤ −60 dB」验收**没有达成、也没有被门禁断言** |
| 第一步 | — | vendored `Oscillator` 的 `phase_`/`phase_inc_` `float → double` | 纯正弦离网能量 **−66 → −87 dB**（步进误差 1e-7 → 1e-16，裙边下沉 **21 dB**） |
| 第二步 | — | 发现「底噪」其实是**起振瞬态**（限幅器峰值检波从起振恢复，保持 50 ms + 释放 150 ms） | 起振后 21 ms 读 **−69 dB**；0.53 s 读 **−90 dB** |
| 失败 1 | v1.85.0 | **在 DaisySP 已带限输出上叠两样本 polyBLEP 残差** | **反而更糟**：锯齿 −32 → **−1.6**、方波 −33 → **−2.4**、三角 −50 → **−2.6 dB**，已回退 |
| 失败 2 | v1.86.0 | **用裸波形估残差** | **同样失败**：锯齿 −32 → −1.9、方波 −33 → −33.5（**等于没改善**）、三角 −50 → −1.9 dB |
| 第三步 | v1.92.0 | **专用带限同步振荡器**（自己发朴素波形 + BLEP/BLAMP） | 锯齿 **−32.1 → −72.3**、方波 **−33.5 → −71.1**、三角 **−49.5 → −75.7 dB** |
| 更正 | v1.99.0（P9.1a） | 发现第三步的「达标」**是抽到了好窗** —— 同一持续音内 8 个 4 s 窗为 **−109.2 / −36.5 / −48.3 / −56.3 / −105.3 / −111.5 / −117.0 / −36.1 dB**，坏窗可达 **−33 dB** | 承认前一版数字不可复现 |
| 修复 | v1.100.0（P9.1c） | 找到真根因（`g_blep` 表在 `d=0` 处跨跳变取错边） | **12/12 场景、396/396 个 4 s 窗全部 ≥ −60 dB，最差 −88.1 dB** |

**「在 DaisySP 的输出上打补丁这条路走不通」**——这句结论是本仓库最贵的一条经验：

> Correcting a step *after* the fact does not work: **the discontinuity has to be band-limited
> where it is generated.**（`crates/synth-core/src/c_bridge/gs_daisy.cpp`）

**失败 1 的诊断过程**特别有教育意义。调试输出显示：

```text
t=0.8716 inc=0.003231 before=-0.6983 value=0.2395 step=0.9378
t=0.2352              before=-0.6983 value=0.9397 step=0.7647
t=0.5989              before=-0.6983 value=0.6388 step=0.4613
t=0.9625              before=-0.6983 value=0.0733 step=-0.1065
```

即 `before` 稳定在 **0.176**，但 **`value` 在每个周期剧烈变化（0.24 / 0.94 / 0.64 / 0.07…），
而它本应稳定在 +1 附近**。结论：

> 原因是 DaisySP 自己的 polyBLEP 在 `t < inc` 时把波形值从 +1 拉向 −1，
> **我再用它去修正就成了二次修正，于是把一个周期信号修成了非周期**。

### 16.2 最终实现

`gs_voice_osc_sync_block(slot, sub, modulator, depth, master_out, slave_out, frames)`：

- **不再调用 DaisySP 的 `Process()`**，而是自己发出**朴素波形**；
- 在**同一套相位判断**上同时补两类不连续：
  - 从振自身回绕（saw/square 用 BLEP、triangle 用 BLAMP）；
  - 主振回绕造成的重启（值跳变用 BLEP、斜率折断用 BLAMP）；
- **过采样 `GS_SYNC_OS = 2`**，共享 **95 抽头 Kaiser 抽取器**；
- 核：`g_blep`（step residual）与 `g_blamp`（其积分），
  由 Blackman 窗 sinc 低通生成（截止 `0.22 × 过采样率` = 96 kHz 下的 **21 kHz**，
  「正好压在 95 抽头抽取滤波器的 19.2 kHz 通带之上」）；
- **核支撑 ±32 过采样样本**（非因果），桥接层用 **128 槽（2 的幂）环形累加器**
  把朴素信号**延迟 32 个过采样样本**；
  「直接截掉前导半核只剩 **−41 dB**，这就是为什么必须延迟」；
- **主振仍走 DaisySP 带限输出**，但桥接层用 double 跟踪其相位；
- **硬同步的延迟比普通带限路径多 `GS_SYNC_DELAY = 32`** 个过采样样本。

**频率必须除以 `GS_SYNC_OS`**——这里记录了一个真实错误：

> Each `Process()` call is one *oversampled* step and the block makes `SYNC_OVERSAMPLE` of them per
> output sample, so the oscillator's own frequency has to be divided by that factor —
> **passing it multiplied ran the pair at OS² times the pitch.**

**unison × sync 的语义**：

> One pass per sub-voice: the **slave's stack sets the detuning and the master follows it**,
> so a sync'd unison stays one period.

**前置条件**（`engine.rs`）：`params.osc_sync && osc[0].on && osc[1].on &&
osc[0].wave.daisy_id().is_some() && osc[1].wave.daisy_id().is_some()`，
即「a wavetable, a sample or noise has no cycle to restart」。

### 16.3 P9.1c 的真根因（一个教材级的数值 bug）

**错误猜测**（写在工作记录里，后被否掉）：

> 初判机理是「重启点落在 2× 网格上的**亚样本位置缓慢滑移**」。

**推翻方式**：原生 harness 打印每次重启的亚样本位置 `xm`，其小数部分
**每 11 次重启逐位复现**（例如 `0.36365350612991465` 在 **0/11/22** 处完全相同）。

**真根因**：`g_blep` 表在 **`d = 0`** 处有一个真实跳变：
`i == GS_BLEP_OFF` 的节点是**右**极限，其下面的节点是**左**极限。
旧代码对整张表用**同一种线性插值**，于是任何落在 **`d ∈ [−1/64, 0)`** 的查询
**跨过跳变取错边**，拿到「**反号、近乎满幅**的修正」，
残余爆到「朴素锯齿自身的 **−33 dB** 水平，再慢慢回到 **−110 dB**」。

**触发量**：主振增量的 f32 量化（DaisySP 的 `f * (1.0f / sr)`），
让 `xm` 在**一个 11 值星形**上走，**每 11 次重启整体旋转 `1.88567e-4`**。

**消融表**（这是「确定根因」的证据链）：

| 消融 | 结果 |
| :-- | :-- |
| `minc` 换精确 double `11/4800` | 爆发消失，64 s 内稳定 **−105…−111 dB** |
| `minc` 误差缩到 **1e-9**（f32 的 1/40） | 64 s 内不爆（**1e-10** 更干净） |
| 扫描主振初相 `p1` | 坏点**精确对应 `xm ≈ 0`**；`xm ≈ 1` 一律好 |
| 扫描从振初相 `p0` | **完全无影响** |
| 只杀重启 BLEP | 退化到 **−26…−34 dB** |
| 只杀从振回绕 BLEP | 退化到 **−26…−34 dB** |

**修复**：在 `!slope && i == GS_BLEP_OFF - 1` 处 `v += f`。
「BLAMP 是残差的积分、本身连续，所以不受影响」。
代价：**+196 B/核 wasm**，`dist` 阈值显式 rebase **1676 → 1678 KB**。

### 16.4 姊妹 bug（P9.6）：f32 表游走舍入到节点上

`sync_emit` 的查表位置 `t` 是**逐抽头 f32 累加**（`t += GS_BLEP_R`），
在 `t ≈ 4096` 处 f32 的 ULP 是 **4.88e-4**。
当真实位置落在节点下方**半个 ULP 以内**（`xw < ~2e-6`）时，
累加**向上舍入到正好 4096**，`i` 变成 `GS_BLEP_OFF` 而不是 `GS_BLEP_OFF - 1`：
这一抽头读到**右极限 `tab[OFF] = −0.498`** 而不是**左极限 `tab[OFF] + 1 = +0.502`**，
「一个抽头整级错修（`amp = 2`，所以环累加器上是一次满幅误差）」。

修复用 **double** 算精确位置再比较，并且**严格小于号**：

```cpp
else if (i == GS_BLEP_OFF && t0_exact + GS_BLEP_R * k < GS_BLEP_OFF) v += 1.0f;
```

> 先写成 `t0 <= 常数` 的那版就是在这里**误伤了每一个 `x == 1` 的包裹**，
> **150/150 场景掉到 −31 dB**。

**为什么 P9.1c 没发现它？** 触发窗只有 **`xw < ~2e-6`** 宽，
按 4 s 窗随机采样约 **1/150**；而且**换一组初相就整体消失**：

> **用随机抽签验证「密性」的修复，会系统性漏掉窄窗 bug；必须固定那个已知场景做确定性断言。**

于是门禁把相位**钉成绝对种子 707**。这依赖一个**看似缺陷的设计**：
`gs_init` **不复位**相位计数器，所以「第 N 次 `gs_note_on` 的初相永远相同」
（`scripts/verify-audio.mjs` 的 `noteOns` 计数器就是为此存在）。

### 16.5 实测数字与门禁

**修复后（真 wasm，BH-7，4 s 窗、1 s 步进、36 s）**：

| 波形 | ×1.41 | ×1.7 | ×2.0 | ×3.3 |
| :-- | --: | --: | --: | --: |
| saw 最差 | −102.9 | −106.8 | −107.0 | −110.9 |
| saw 离散度 | 16.4 | 11.5 | 10.2 | 7.2 |
| square 最差 | −112.8 | −107.3 | −117.8 | −100.0 |
| square 离散度 | 8.9 | 12.3 | 4.3 | 6.1 |
| triangle 最差 | −93.9 | −95.6 | −94.3 | −88.1 |
| triangle 离散度 | 5.4 | 0.4 | 0.8 | 0.2 |

**12/12 场景、396/396 窗全部 ≥ −60 dB，最差 −88.1 dB（余量 ≥28 dB）**；
改前同一场景最差 **−33.2 dB**、37 个窗里 **19 个超标**。
时域：周期相关 **0.9988…0.9999**、峰值 **≤0.136**、最大相邻步进 **≤0.129**、无 NaN。
16 次连续 `note_on` 的离散度从 **84 dB 降到 18.8 dB**。

门禁断言（`scripts/verify-audio.mjs`）：3 波形 × 4 比值 × 每场景 3 个 4 s 窗，
`worst < −60`；未同步从振 `> −3 dB`（**用来证明度量确实在量「在不在网格上」**）；
周期相关 `> 0.95`、峰值 `≤ 1`、步进 `HARD_SYNC_STEP_RATIO = 1.8 × peak`。

### 16.6 已知边界（**原文承认的技术债**）

| 边界 | 数字 |
| :-- | :-- |
| `≥30 s 离散度 < 3 dB` **未完全达到** | 只有 triangle × 1.7/2.0/3.3 达到（**0.2–0.8 dB**）；锯齿与方波是 **4.3–16.4 dB**。要压到 3 dB 需**更高过采样（4×）或重做核** |
| **44.1/96 kHz 的包络周期没有定量解释** | 48 kHz 的 **~24 s** 与「11 值星形旋转一格 = **24.1 s**」吻合，但同一模型给 44.1 kHz **31 s** / 96 kHz **12 s**，实测 **21 s / 6 s** |
| 采样率依赖 | 只换采样率就改变爆发周期（48 kHz ~24.5 s、44.1 kHz ≈21 s、96 kHz ≈6 s） |
| 从振比值必须覆盖多档 | 1.41 / 1.5 / 1.7 / 2.0（整数）/ 3.3× 全部出现过坏窗——所以门禁要求「≥4 个比值」 |

---

## 17. 滤波器与双级路由

### 17.1 目标与信号流位置

每声部一个滤波器（可选第二级），提供 24 dB/oct ladder、12 dB/oct SVF 家族、
连续多模 SEM、comb 共振器、formant 元音滤波，并支持串联/并联与混合。

### 17.2 `FilterType` 线格式（**注意：与 C 桥 id 不同**）

| 线格式 id | 名称 | Rust 实现 | C 桥 id |
| --: | :-- | :-- | --: |
| 0 | `Lp` | **Rust ladder**（24 dB/oct + tanh） | 0 |
| 1 | `Hp` | C 桥 SVF | 1 |
| 2 | `Bp` | C 桥 SVF | 2 |
| 3 | `Notch` | C 桥 SVF（用 SVF 自己的 `notch_`） | 3 |
| 4 | `Comb` | **Rust comb** | 无（`bridge_id` 有 `debug_assert!(false)`） |
| 5 | `Formant` | C 桥三并联带通 | 无 |
| 6 | `Sem` | C 桥 SVF 连续多模 | **4**（`GS_FILTER_SEM`） |

```rust
/// Deliberately not `to_u32() as i32`: … `sem` is **6 on the wire** and `GS_FILTER_SEM` is **4** …
/// Casting between them silently lands on the wrong filter, **which is a bug that sounds like a
/// feature** (a `sem` patch quietly becomes a low-pass).
pub fn bridge_id(self) -> i32 { … }
```

**`second_stage_id()`** 是第二级专用的映射：comb / formant → **0（LP）**，
因为「both keep a single per-voice state that stage 1 already owns」，
「Calling `bridge_id` would trip its debug assertion — which is there to catch a *stage one* patch
quietly becoming a low-pass, not to forbid a stage two that has nowhere else to put a delay line.」

**不要用 `to_u32() as i32`**——这条纪律在笔记里被明确记为一次**差点过关**的 bug：
「`sem` 会被夹成 LP，听起来像功能正常（这正是第一版的状态，被 Rust 测试逮住）」
（`docs/notes/sem-filter.md`）。

### 17.3 ladder（Rust，ZDF/TPT）

参数与公式（全部来自 `crates/synth-core/src/dsp/ladder.rs`）：

| 量 | 公式/值 |
| :-- | :-- |
| 截止钳位 | `fc = freq.clamp(20.0, sr × 0.45)`（`sr = sample_rate.max(1000.0)`） |
| 一阶系数 | `w = tan(π·fc/sr)`；`coeff = (w/(1+w)).clamp(0.0, 0.999_99)` |
| 反馈 | `feedback = res.clamp(0.0,1.0) × 3.9` |
| 输入驱动 | `drive = 1.0 + drive_knob.clamp(0.0,1.0) × 0.8`（1.0…1.8） |
| 输入饱和 | `drive > 1.0001` 时 `fast_tanh(input×drive)/drive`，否则**恒等** |
| ZDF 解环 | `u = (x − feedback·state_sum) / (1 + feedback·g⁴)` |
| 状态更新 | 每级 `y = g·v + (1−g)·z_old`；`z_new = 2y − z_old` |
| 输出饱和 | `soft_clip(v)`，`SOFT_KNEE = 0.7`，Padé `fast_tanh` |
| 输出微调 | `PASSBAND_TRIM = 1.0` |

`fast_tanh` 是 tanh 的 Padé 近似：`x·(27 + x²)/(27 + 9x²)`。

**为什么输出级不是直接 `tanh`**（门禁反过来塑造设计的例子）：

> A plain `tanh(v)` here coloured everything: at a perfectly ordinary **0.5** signal it was already
> compressing by **3%**, which the spectral gate measures as **−46 dB** of harmonic content on a
> sine. A filter should be **transparent until it is actually driven**.

**关于 `PASSBAND_TRIM` 的一处内部不一致**（写文档时必须指出）：
常数**当前是 `1.0`**，而它的注释描述的是被替换的 vendored 版本
「ran with a 0.5 passband gain, so every existing preset was balanced against a low-pass that sat
about **4 dB** below unity」。
数学上 $20\log_{10}(0.5) = -6.02$ dB，注释写 ~4 dB——**注释里的数字与 0.5 不相符**（见 §32）。

**为什么自激不会发散**：

> The saturation inside the feedback path is what keeps the self oscillation bounded;
> **without it the loop grows until it is clipped by the master limiter instead.**

Rust 单测门限：

| 单测 | 断言 |
| :-- | :-- |
| `stays_continuous_on_a_sine` | 最坏步进 < **理想步进 × 2.5** |
| `low_pass_attenuates_above_the_cutoff` | 2 kHz 通带 > 0.8；8 kHz < 通带的 10% |
| `resonance_lifts_the_cutoff` | res 0.9 > res 0 的 **1.5 倍** |
| `full_resonance_stays_bounded` | 800 Hz / res 1 / drive 1、2 s，peak **< 12.0** 且全部有限 |
| `is_transparent_below_the_knee` | 18 kHz 截止、res 0.05，2..12 次谐波合计 **< −70 dB** |

### 17.4 SVF 与 SEM

C 桥用 DaisySP 的「**Double Sampled, Stable State Variable Filter**」
（来源：Andrew Simper；稳定性限制：Laurent de Soras；正确 notch：Stefan Diedrichsen）。
关键系数（`vendor/daisysp/Source/Filters/svf.cpp`）：

```text
fc_ = clamp(f, 1e-6, sr/3)
freq_ = 2 * sin(PI * min(0.25, fc_ / (sr * 2)))          // 双采样
damp_ = min(2*(1 - res^0.25), min(2, 2/freq_ - freq_*0.5))
drive_ = pre_drive_ * res_
```

每样本 `Process()` 跑**两遍**，输出是两遍各 0.5 的均值；
`notch_ = input − damp_·band_`，输出 `notch_` **就是** SVF 自己的 `notch_`，
**不是** `low_ + high_`（这一点被笔记明确记录：`docs/notes/sem-filter.md`）。
桥接层用 `SetRes(res × 0.97)`——一个**留 3% 稳定余量**的做法。

**SEM 的连续多模**（`FILTER_MORPH` id 145，0..1）：
每个样本**只跑一次** SVF，然后**三路 tap 加权混合**（保留极点、移动零点）。
四个规范点与段内线性律（`gs_daisy.cpp`）：

```text
0      = SVF Low（12 dB/oct LP，不是 24 dB 的 ladder lp）
1/3    = Band
2/3    = Notch（L + H）
1      = High

m <= 1/3 : (1-t)·L + t·B            t = 3m
m <= 2/3 : (1-t)·B + t·(L+H)        t = 3m-1
else     : (1-t)·(L+H) + t·H        t = 3m-2
```

**为什么必须把 notch 单列一个规范点**：

> 两线写法下 `wL = 1-2m`、`wH = 2m-1` **互为相反数**，`L+H` 永远取不到。
> 第一版就是两线写法，被验收里的「LP/HP/BP/NT 连续可变」挡下了。

**SEM 的测量陷阱（P6.3a 因此浪费了一整轮）**：默认 patch 的调制矩阵里
`ENV→CUTOFF (0.55)` 与 `LFO→CUTOFF (0.8)` 是**开着的**，
所以第一版门禁在 `FILTER_CUTOFF = 400` 处量斜率，得到的是
「低通端点随频率**上升 1.3 dB**」——**量到的是包络调制，不是滤波器**。
清矩阵（`gs_set_mod_route(i, 0, 0, 0, 0)`）后同一测量 = **−11.96 dB / 两个八度**。

**SEM 实测**（真 wasm，`scripts/verify-audio.mjs`）：两个八度斜率
**−11.68 dB**（LP 端）/ **+12.19 dB**（HP 端）；带通中心比一个八度下高 **17 dB**；
陷波中心 **−32.4 dB** 且两端相差 **−0.4 dB**；
急变峰值 **0.128**、最大相邻样本步进 **0.040**。

### 17.5 双级路由（P6.3b）

| 参数 | id | 语义 |
| :-- | --: | :-- |
| `FILTER_ROUTING` | **146** | 0 = Off（默认，**纯旁路**）、1 = Serial、2 = Parallel |
| `FILTER2_TYPE` | **147** | 第二级类型（comb/formant 读作 LP） |
| `FILTER2_CUTOFF` / `_RES` / `_DRIVE` | 148 / 149 / 150 | 第二级自己的三个旋钮 |
| `FILTER_BLEND` | **151** | 并联混合量（**线性律**，0 = 恰好第一级、1 = 恰好第二级） |

**第二级永远是独立的 12 dB SVF**，每声部每侧一个实例；
第一级类型不影响它——ladder 低通/梳状/共振峰**都不复制**。

**实现上的四个坑（笔记逐条记录）**：

1. **Off 时不能「顺手跑一下」第二级**：第一版把两级都渲染出来再混合，
   默认关闭时也在混合里带进了第二级的输出（它的系数还没被设过），
   于是「**所有旧音色**的音色都变了——**9 条既有测试同时变红**」。
2. `bridge_id()` 对 comb/formant 有 `debug_assert!(false)`，第二级必须用 `second_stage_id()`。
3. **并联要「第一级看到的输入」**（`filter2_in_buf`，按 makeup 前保存、用时乘回）。
4. **不要再套 DC 阻断器**，否则「并联 blend 0」与单级差 **0.05%**、**端点不再逐位相同**。

**Rust 测试夹具的两个坑**（对任何做滤波器测量的人都有用）：

- 第一级 `lp` 是 **24 dB ladder + tanh**（既不线性也不是 12 dB/oct），
  所以「乘积」类断言**必须用 `sem`**（morph 0 的线性 SVF LP）；
- 每次测量都带着**音源电平**，所以「乘积」要在**除以同一个宽开参考之后**再乘，
  否则会差出一个电平因子——**第一版差了 26 dB**。

**实测（真 wasm）**：

| 项 | 数字 |
| :-- | :-- |
| 串联 = 两级响应之和（dB） | 600/1500/4000 Hz 三点最大偏差 **1.02 dB** |
| 两级 12 dB 低通同截止（两个八度） | 一个 **−26.6 dB**、两个 **−53.8 dB**（斜率翻倍） |
| 并联混合量单调（1500 Hz） | **0.4 → −2.2 → −5.9 → −12.6 → −27.5 dB** |
| 时域（切路由 + 扫第二级截止/类型） | 峰值 **0.172**、最大相邻步进 **0.162**（阈值 0.5） |

**Rust 侧门限**：串联乘积误差 **< 0.6 dB**；单级两八度 ≈ −12±3 dB、串联 ≈ −24±4 dB 且
`chained < single − 6.0`；并联端点 `worst_difference == 0.0`（**逐位相同**）；
blend 中间最坏 `< level×1e-4`；`Routing::Off` 忽略第二级全部控制（`worst == 0.0`）。

### 17.6 comb 与 formant

- **comb**（`crates/synth-core/src/dsp/comb.rs`）：反馈 comb 共振器，
  `MIN_FREQ_HZ = 30.0`、`MAX_SR = 96_000`、`MAX_LEN = MAX_SR/MIN_FREQ_HZ + 4`（≈3204）。
  它**替换整个 ladder/SVF 链**，并且因为「keeps one delay line per voice」，
  这个类型**走单声道路径**（即使振荡器声像分开）。输出后接 DC 阻断。
- **formant**：三并联带通调到元音 A-E-I-O-U，`FILTER_CUTOFF` 在它们之间**对数**移动：
  `vowel = log2(cutoff/80) / log2(4000/80)`，即 80 Hz = A、4 kHz 及以上 = U。
  输出后接 DC 阻断。

### 17.7 已知边界

| 边界 | 说明 |
| :-- | :-- |
| comb / formant 不能做第二级 | 二者需要**每声部唯一**的延迟线状态，而第一级已占用（读作 LP） |
| comb 强制单声道 | 一个延迟线 per voice，声像信息丢失 |
| SVF 不自激 | DaisySP 的 SVF 是「stable」设计，`SetRes` 文档要求 0..1 以保证稳定——**与 ladder 的 near-4 自激不同** |
| ladder 自激有界但**不等于干净** | 靠反馈路径内的软削波限住，峰值断言 < 12.0（不是 < 1.0） |
| 默认调制矩阵污染测量 | 见 §17.4；**任何响应测量都必须先清矩阵** |

---

## 18. 包络与调制矩阵

### 18.1 包络（见 §7.1）

本仓库的 `Adsr` 是 Rust 自持实现，**线性 attack + 单极点 decay/release**，
`time_coefficient(t, sr) = exp(−6/(t·sr))`（覆盖 ~99.8% 跨度）。
每声部两个：**幅度包络**（`envs[slot]`）与**滤波包络**（`filter_envs[slot]`）。

**「冻结」优化**：`is_env_param()` 列出 **8 个** 包络 id（幅度 4 个 + 滤波 4 个），
配合 `env_dirty` 标志，**只在真的改过时**才 `apply_env_to_all()`。

### 18.2 调制矩阵（8 槽）

`MOD_ROUTES = 8`，通过 `gs_set_mod_route(index, src, dst, amount, enabled)` 写入。
`ModRoute { src, dst, amount, enabled }`，`amount` 钳在 **−1..1**。

**默认值**（`Params::new`，注意**默认就有两条启用**——这是很多测量陷阱的来源）：

| # | src | dst | amount | enabled |
| --: | :-- | :-- | --: | :-- |
| 0 | `Lfo` | `Cutoff` | **0.8** | **true** |
| 1 | `Env` | `Cutoff` | **0.55** | **true** |
| 2 | `Lfo` | `Pitch` | 0.18 | false |
| 3 | `ModWheel` | `Cutoff` | 0.4 | false |
| 4..7 | `ModRoute::empty()` | | 0.0 | false |

**调制深度的应用方式**（举例，`engine.rs`）：

```rust
// 音高：以半音为单位的调制，再 exp2
// 截止：cutoff *= exp2(mod_cutoff * 4.0)          ← 最多 ±4 个八度
// 共振：resonance = (res * (1.0 + mod_res) + mod_res * 0.25).clamp(0.0, 1.0)
//       ↑ 「The matrix can push resonance up to twice the knob value (clamped)」
let resonance = (params.filter.res * (1.0 + mod_res) + mod_res * 0.25).clamp(0.0, 1.0);
```

注意截止用 `exp2(... × 4.0)` 是**指数（音乐性）映射**，共振是**线性 + 加性偏置**。

### 18.3 三种调制机制的对照（本合成器的核心结构）

| | 调制矩阵 | 图内调制边（P7.2） | 覆盖槽调制总线（P9.3） |
| :-- | :-- | :-- | :-- |
| 参数 id | 不是 AudioParam，走 `gs_set_mod_route` | `FX_MOD{n}_{SRC,DST,DEPTH}`，**167..178** | `FX_OVR_TARGET{n}` / `FX_OVR_DEPTH{n}`，**207..222**；`FX_OVR_SRC` = 223 |
| 槽数 | **8**（`MOD_ROUTES`） | **4**（`MOD_SLOTS`） | **8**（`OVR_MOD_SLOTS`） |
| 作用域 | **每声部** | FX **总线**的 18 个节点增益（`GRAPH_GAINS = 6×3`） | **每节点的 4 个效果参数槽** |
| 源 | LFO1、LFO2、Env、ModWheel、Velocity、Aftertouch、Random、KeyTrack | 仅 LFO1 / LFO2 / Env | 同图内边（一个 src 对整个总线） |
| 目标 | Cutoff、Pitch、Volume、Pwm、Pan、Resonance、Fm、Ring | input1 gain / input2 gain / output gain | 由 `ovr_slot_base(kind, slot)` 决定 |
| 更新率 | 每块每声部 | 每块 + 一阶平滑 | 每块 |
| 深度存储 | 矩阵行上的 `amount` | 边上（`mod_depth`） | 每个总线槽（`ovr_depth`） |

**三者可以共存且互不重叠**，所以互不干扰、直接相乘/相加。

### 18.4 图内调制边（P7.2）的四条纪律

1. **活着需要三个条件**：`src != 0 && dst != 0 && depth != 0.0`（`graph_mod_active`）；
2. **没有活边时「原值返回，不平滑、不做算术」**
   ——这是 pre-P7.2 patch 逐位不变的关键；
3. **有活边时总和过同一个一阶平滑**（`SMOOTH_TAU_S`，约 20 ms）
   ——「so drawing an edge onto a playing graph ramps instead of stepping」；
4. **两条边落到同一增益上，它们的量相加**，最后统一 `clamp(0.0, 4.0)`。

**源的值域**：LFO 是**原始值 −1..1**（**不乘** `LFO_DEPTH`——这是一个容易误解的点）；
包络是**所有发声 voice 里最大的 `env_value`**（总线级 follower）。
`engine.rs` 的注释解释了为什么用「最大」：

> There is one envelope per voice and the graph is a bus effect, so the edge sees the **highest
> level sounding** — a note that has been released still holds the edge open while its tail rings,
> which is what makes an envelope-drawn edge act like a **bus-level follower** instead of a
> per-voice route.

**越界目标读作「无边」**：`mod_dst_code` 把无效值夹到 0（不 wrap 到别的节点的增益）。

**验证**（`src/audio/fxgraph.test.ts` 与 Rust 单测）：
depth 0 逐位一致；越界 dst 逐位一致；同一增益两条边求和 `0.3 + 0.2 = 0.5` 到 **1e-6**；
depth 0.5 / base gain 0.5 → `f0 ± f_lfo` 的边带幅度是**载波的一半**
（Hann 窗 Goertzel at `f0/8`）；未调制渲染的边带 bin < 载波的 **2%**；
depth ±1 有限且峰值 < 2（base gain 0）。

### 18.5 覆盖槽与 `UNSET` 哨兵（P9.3）

**问题**：效果参数原本按 **kind** 存（`FX_DELAY_FB` 等），所以「同一种效果的两个节点
无法有不同的参数」。P9.3 加了 **每节点 4 个覆盖槽**。

**哨兵设计（本仓库最优雅的一处兼容设计）**：

```rust
/// The value that means "this slot is not overridden, use the kind's own knob".
///
/// Deliberately below every legal range ([`ovr_slot_range`] starts at -1), so a slot that is set
/// can always be told from one that is not, even for the controls whose range reaches -1:
/// `Params::set` stores override slots **verbatim** (including this sentinel) instead of clamping
/// them, so the flag cannot be rounded or clamped away.
pub const FX_OVR_UNSET: f32 = -2.0;
```

**「逐字存储」是关键**：`Params::set` 对覆盖槽**不钳位**，
因为一旦钳位，未设置（−2.0）就会被夹到合法范围的下限，**「未设置」就消失了**。
钳位只发生在**真正使用**的那一刻，且只有一处（`ovr_slot_range`）。

**解析语义**（`resolve_ovr`）——「不混合，二选一」：

```rust
if scale == 0.0 {
    if stored == FX_OVR_UNSET { return base; }      // 用 kind 级旋钮
    let (lo, hi) = ovr_slot_range(kind, slot, max_delay_seconds);
    return stored.clamp(lo, hi);                     // 用覆盖值
}
// 有扫动时：起点 + scale×source×范围，再钳位
let start = if stored == FX_OVR_UNSET { base } else { stored };
(start + scale * source * (hi - lo)).clamp(lo, hi)
```

注释说明了这个「二选一」为什么必要：

> Every returned cell is either **exactly** the kind-level value the engine always used, or the
> override — **the two are never blended**, which is what keeps an unset slot bit for bit its old self.

**槽语义共享**：4 列在所有 kind 间**共享**（列 0 的含义由 kind 决定），
所以「六节点只花 `FX_SLOTS × OVR_SLOTS = 24` 个 id 而不是 6×9」——
`params.rs` 注释直接说这是 **id 预算**的原因。

| kind | slot 0 | slot 1 | slot 2 | slot 3 |
| :-- | :-- | :-- | :-- | :-- |
| Delay | **delay time（秒，特殊）** | `FX_DELAY_FB` | `FX_DELAY_MIX` | `FX_DELAY_DAMP` |
| Reverb | `FX_REVERB_SIZE` | `FX_REVERB_MIX` | `FX_REVERB_DAMP` | `FX_REVERB_PREDELAY` |
| Chorus | `FX_CHORUS_DEPTH` | `FX_CHORUS_RATE` | `FX_CHORUS_MIX` | — |
| Flanger | `FX_FLANGER_FB` | `FX_FLANGER_RATE` | `FX_FLANGER_MIX` | — |
| Phaser | `FX_PHASER_FB` | `FX_PHASER_RATE` | `FX_PHASER_MIX` | — |
| Drive | `FX_DRIVE_AMT` | `FX_DRIVE_MIX` | — | — |
| Crush | `FX_CRUSH_BITS` | `FX_CRUSH_DOWN` | `FX_CRUSH_AA` | `FX_CRUSH_MIX` |
| Eq | `FX_EQ_LOW_GAIN` | `FX_EQ_MID_GAIN` | `FX_EQ_HIGH_GAIN` | `FX_EQ_MID_FREQ` |
| Transient | `FX_TRANSIENT_ATTACK` | `FX_TRANSIENT_SUSTAIN` | `FX_TRANSIENT_MIX` | — |

**delay time 是唯一的例外**：它**不是比例而是秒**（0.001 .. `max_delay_seconds.clamp(0.001,4.0)`），
因为它的上界是**延迟池自己的线长**（`ovr_slot_range` 注释）。

**覆盖槽调制总线的线格式**：`TARGETk` = 0 关闭，否则 `1 + node×4 + slot`（掩码 `0x1f`）；
`ovr_scale` 只有在 `ovr_target[index] == ovr_slot_code(node, slot)` 时才生效，
「which is what keeps a sweep from leaking into the other five nodes and the other three columns
of the same node」；**两个槽可以指向同一 (node, slot)，深度相加**
（「exactly like two P7.2 in-graph edges landing on one gain」）。

**id 净增 41**：24 覆盖槽（183–206）+ 8 target（207–214）+ 8 depth（215–222）+ 1 src（223），
`PARAM_COUNT` **183 → 224**。

### 18.6 已知边界

| 边界 | 说明 |
| :-- | :-- |
| 效果参数**按 kind 存**的残留 | 覆盖槽解决了「每节点不同值」，但**节点参数本身仍不是 AudioParam**——`docs/NEXT-PLAN-2.md` §一 第 3 条把它列为技术债 |
| 覆盖槽只在 **4 个**参数上可覆盖 | 「a kind with fewer than four overridable controls leaves the tail unused」 |
| 图内调制边只有 **4** 条 | 「Four covers what the built-in templates need and keeps the parameter block small」 |
| 覆盖槽调制总线只有 **8** 个槽 | 「Eight covers 'a couple of nodes of each kind' without spending an id per pool slot; the **id budget** in the batch report is the reason it is not `FX_OVR_POOL`」 |

---

## 19. 效果链与自由路由图

### 19.1 目标

两种可切换的效果路由：**传统 6 位链**（向后兼容的默认）与**自由前馈图**（
任意「干声/更早节点 → 节点输入」连接）。两者必须共享同一批效果器实例与参数。

### 19.2 节点与输入编码

| 项 | 值/编码 |
| :-- | :-- |
| 节点数 | `FX_SLOTS = 6` |
| 干声总线 | `GRAPH_DRY = 1` |
| 节点 `slot` 的输出 | `graph_node_src(slot) = slot + 2`（即 2..=7） |
| 「不连接」 | 0 |
| 每节点字段 | `FX_NODE_IN1`（101+）、`FX_NODE_IN1_GAIN`（107+）、`FX_NODE_IN2`（113+）、`FX_NODE_IN2_GAIN`（119+）、`FX_NODE_TO_OUT`（125+）、`FX_NODE_OUT_GAIN`（131+） |
| 模式开关 | `FX_GRAPH`（id **100**） |

**源编码钳位**：`graph_src_code(v) = if !finite || v <= 0 { 0 } else { (v as u32).min(FX_SLOTS+1) as u8 }`。
越界读作「不连接」，「which is what the renderer does with it anyway」。

### 19.3 为什么图**在构造上不可能有环**

> Nodes run in index order and an input may only read the dry bus or an *earlier* node, which is a
> valid topological order **without sorting anything on the audio thread** — and makes a loop
> **impossible by construction**.

代价是**表达力受限**：不能做反馈回路，也不能把节点 3 的输出喂给节点 1。
「A node whose input is not connected processes **silence**; if nothing is routed to the mix bus
the effect section is **silent**, which is what an empty patch should be.」

### 19.4 从链「播种」到图

`fx_graph_from_chain()`：节点 1 读干声，每个后续节点读前一个，最后一个**真正运行**的节点送输出。
注释解释了为什么必须有这个函数：

> Turning the graph on after this **sounds exactly like the chain it came from**.
> （`abi.rs` 对 `gs_fx_graph_sync` 的注释：「so the sound does not change the moment the graph
> takes over」）

空位置**直通**（「Empty positions pass their input straight through」）；
若**完全没有效果**，则节点 1 送输出（也就是干声）。

### 19.5 效果池（P7.1，多实例）

「同一种效果两个节点」需要**每个节点有自己的 DSP 状态**。做法是一个**池**：

| 池 | 实例数 | 分配时机 | 单实例大小（实测） |
| :-- | --: | :-- | --: |
| 延迟（`Delay`） | **2**（`DELAY_INSTANCES`） | `gs_init` 预留（2 条 × 2.0 s = **1500 KB**） | **768 064 B**（左右两条线） |
| 卷积（`Convolver`） | **2**（`CONV_INSTANCES`） | **首次 `gs_ir_import`** | **877 504 B**（857.0 KiB） |
| IR 分区谱（`IrSpectra`） | 1 份，**只读共享** | 首次导入 | **1 213 264 B**（1185.0 KiB，含 scratch） |

**分配规则**（`sync_fx_pools`，按 slot 0..5 扫描，每块调用但只扫 6 个槽）：

> Nodes take instances in slot order, so a patch with a **single** delay (or a single convolution
> reverb) always gets **instance 0** and renders exactly as it did before the pool existed.

**arena 占用实测**（`docs/notes/fx-multi-instance.md`，基线 v1.93.0，`ARENA_SIZE = 8 MiB`）：

| 配置 | arena 余量 |
| :-- | --: |
| 改动前基线 | **3511.3 KiB** |
| 拆分 1 延迟 + 1 卷积 | 3478.5 KiB（−32.8，多出的 Vec 头与对齐） |
| 2 延迟 + 1 卷积 | 2728.4 KiB（多一条延迟线 = 768 064 B，**与算出的完全一致**） |
| 1 延迟 + 2 卷积 | 2621.5 KiB（多一个卷积节点 = 877 504 B） |
| **2 + 2，未导入 IR** | **4770.2 KiB（比基线还多 1258.9 KiB）** |
| **2 + 2，导入 2 s IR 后** | **1871.5 KiB（−1639.8 KiB）** |

**为什么上限是 2+2 而不是 3+3**（这是一段完整的容量论证）：

> 2+2 最大常驻 delay **1500.1 KiB** + conv **2898.7 KiB**，导入 IR 后剩 **1871.5 KiB**
> （3.6× 的 512 KiB 门禁）；**3+3 再 +1614 KiB ≈ 258 KiB**，
> **低于 `bench:long` 的 512 KiB 门禁，不可行**；2+3 再 +857 KiB ≈ 1015 KiB 可行，
> 但对「双延迟/并行混响」无额外价值。

**两个设计决定**：

1. **卷积缓冲推迟到首次 `gs_ir_import` 分配**（`try_reserve`，失败时返回 **4**）；
2. **延迟池仍在 `gs_init` 预留**，所以整链**无运行时分配**。

**已知取舍（原文承认）**：

> 导入 IR 后，4 s 采样的完整导入峰值约 **2.3 MiB**，而剩余 **1871.5 KiB** 不够：
> 同时导入「最长采样 + IR」比改动前更容易失败；正常 0.5 s 级采样不受影响。
> **链模式下含两个同类节点的旧 patch 从「第二条复用同一条线」变成「各自一条线」，声音会变**；
> 工厂预设与全部测试都没有这种 patch。

### 19.6 自由图的 2× 与逐节点 PDC

`node_oversampled(kind) = Drive`——**只有 DRIVE 节点**参与 2×
（理由见 §9.2）。PDC 公式见 §4.5。

**P9.4 的踩坑记录（本仓库最长的一段调试叙事）**：

> 第一版把往返算了两遍，症状是**图模式 2× 的混叠比 1× 还差 25 dB**（−33.0 → −7.1 dB），
> 而**链模式同代码是下降 26 dB**；把真机的节点输入喂回两条路径，两者**逐位相同**，
> 所以「节点之后」被误当成嫌疑区。真正的诊断线索是**节点混合后的输出**，而不是往返输出：
> **往返正确、混合错误 ⇒ 一定在「节点内部的对齐」或「输入的额外延迟」上。**

**成本**：整链 16 声部 p50 **1099 → 1325 µs（1.21×）**；dist **+5.0 KB**、最大 wasm gzip **+0.6 KB**。
**延迟上报**：`gs_oversample_latency()` = **62 样本 / 1.29 ms @48 kHz**（= `OS_LATENCY`(31) + M(31)）。

### 19.7 FX 模板（P7.3）

**模板是「一整套 routing」**：六个链位各放什么、是否并行 send，以及把节点接起来的图。

| 项 | 内容 |
| :-- | :-- |
| 白名单 | `FX_CHAIN1..6`(6) + `FX_PARALLEL1..6`(6) + 图组（`FX_GRAPH` + 每节点 6 个字段）= **49 个 id** |
| **明确排除** | `FX_REVERB_MODE` 及 IR 相关（模板只用算法混响）；各效果 on/off 与 mix；**所有** osc/filter/env 参数；图内调制边 |
| 存储 | workspace（`gs1:layout:v1`），**不在 patch、不在分享码** |
| 内置 | **5** 个：`fxg:serial`、`fxg:dual-delay`、`fxg:parallel-reverb`、`fxg:drive-split`、`fxg:empty` |
| 应用 | 一次 `setParams(..., { immediate: true })` → 一次通知、一步 undo、两次 storage 写 |

**为什么排除 IR 与 on/off**：笔记原文——
模板**只改接线不改音色**；且「应用它绝不会把混响切到接收方没导入的响应」。
`fxg:empty` **故意 dry-only**（「否则是 footgun」）。

**加载即校验**（`normalizeTemplateParams`）：未知 id 丢弃；已知 id 夹取；
**前向/自环边变为「未连接」**；**第三个延迟节点读作 none**（延迟池恒有 2 条线）；
无可识别内容 / 非对象 / 重复 id / 遮蔽 built-in 的 id 一律拒绝。
存储体里缺失的 id 在应用时从 `DEFAULT_PARAMS` 补齐，
「故模板总是产生完整、确定性的 routing」。

### 19.8 已知边界

| 边界 | 说明 |
| :-- | :-- |
| **图不能有反馈** | `graph_param_field` 的前向约束（设计选择，不是 bug） |
| **图节点参数 id 与其它 id 重叠** | 见 §12.6（**已知未修**） |
| **引擎里有一处陈旧注释声称图的 2× 是「关」的** | `engine.rs` 测试模块注释写「the graph's 2x node path is held *off*」，但 `node_oversampled` 返回 `Drive`、渲染路径走 `drive_oversampled_node`、且有断言「图 2× 使 alias floor 下降 ≥12 dB」的测试。**功能状态是「开（OVERSAMPLE 开时）」**，注释陈旧（见 §32） |
| 池满时静默直通 | 节点拿不到实例就直通；UI 用 `gs_delay_pool_used` / `gs_conv_pool_used` 显示剩余可分配量并 `disabled` 该选项 |
| 3+3 池不可行 | 见 §19.5 的容量论证 |

---

## 20. 效果器逐个实现

### 20.1 延迟（Rust，`dsp/delay.rs`）

见 §8.1。补充工程细节：

| 常量 | 值 |
| :-- | --: |
| `MAX_DELAY_SECONDS` | **2.0** |
| `MAX_DELAY_SAMPLES` | **192_000**（「so a 192 kHz host does not reserve 1.5 MB per channel」） |
| `TIME_SLEW` | **0.0008**（约 20 ms @48 kHz） |
| `DAMP_MIN` | **0.05** |

**时间同步**（`Params::delay_time_seconds()`）：

| `FX_DELAY_SYNC` | 时值 |
| --: | :-- |
| 0 | 四分音符（`quarter = 60/tempo`） |
| 1 | 附点八分（`quarter × 0.75`） |
| 2 | 八分（`quarter × 0.5`） |
| 3 | 十六分（`quarter × 0.25`） |

**「首次使用直接跳到目标时间」**（不是一个易见的细节）：

```rust
if self.samples <= 0.0 {
    // First use, or after a reset: start at the wanted time instead of
    // sliding up to it from zero.
    self.samples = target;
}
```

否则第一次上电时延迟会从 0 滑到目标值——一个可闻的「嗖」声。

### 20.2 混响（Rust，`dsp/reverb.rs`）与卷积（`dsp/convolution.rs`）

见 §8.2。补充：

**算法混响常量**：梳状调音来自 Freeverb（44.1 kHz 的样本数）、
右声道偏移加宽立体声、最长梳状延迟按 96 kHz 缩放、预延迟缓冲 100 ms @96 kHz、
**输出 trim**（因为梳状组 + 4 个全通的共振增益**最高约 25×**）。
「The delay lines are deliberately **static**」——移动抽头会在延迟变短时**注入能量**，
让尾巴「pump」而不是衰减。

**卷积常量**：`HOP = 1024`、`FFT_SIZE = 2048`、`BINS = 1025`、
`MAX_PARTITIONS = 96`（= 98304 样本 ≈ **2.05 s @48 kHz**）、`MIN_IR_SAMPLES = 32`、
**分区工作切成 8 片**（= 8 个 128 帧的渲染量子）。
IR 的能量归一化让不同长度的响应得到可比的湿声电平；`FX_CONV_TRIM`（id 95）是输出修剪。

**「分摊（spread）」是这里的核心工程量**，门禁专门检查它：

```javascript
// Spread, not spiky. … the blocks fall into eight repeating phases and exactly one phase carries
// whatever happens at the hop boundary. … One phase is allowed to be busy: the transforms cannot
// start until the hop is complete, so the boundary block always carries them.
// Every *other* phase must look alike.
```

`bench.mjs` 的断言是 `busiest/typical < 1.35`（排除 transform 那一 phase）。

**共享策略**：IR 分区谱**所有卷积节点只读共享**，
「so a patch with three reverb nodes in impulse-response mode holds **one** response, not three」；
但**每个节点的 FDL 独立**，「so two nodes never share a tail」。

### 20.3 合唱 / 镶边 / 相位器

见 §8.3。参数范围（`params.rs`）：深度/混音 0..1、速率 **0.02..10 Hz**、
反馈 **0..0.95**。相位器的 `poles` 参数是 C 桥的实现细节（**未在 UI 暴露，具体取值未验证**）。

**三者都是 insert**（`FxKind::can_be_parallel()` 只列了 Chorus / Flanger / Phaser / Drive /
Crush / Eq / Transient）：

> Insert effects are blended with the dry signal; a send is added.
> **Delay and reverb already add their wet signal inside their own mix, so for them the parallel
> switch has nothing to change** (and the UI does not offer it).

这条注释解释了 `can_be_parallel` 为什么**故意**排除 Delay / Reverb。

### 20.4 驱动（DRIVE）

见 §9.2。**这是唯一被判定「必须 2×」的效果节点**。

### 20.5 已知边界

| 边界 | 说明 |
| :-- | :-- |
| 相位器 `poles` 未暴露 | 具体值**未验证** |
| 算法混响延迟线静态 | 刻意：移动抽头会 pump（设计选择） |
| 卷积最大 IR 2.05 s | 内存上限（96 partitions），也是音乐上限 |
| IR 与 4 s 采样不能同时导入 | 见 §19.5 的 arena 论证（`1871.5 KiB` 不够 `2.3 MiB`） |
| 链模式下「两个同类节点」的旧 patch 声音会变 | 从复用一条线变成各自一条线；工厂预设与测试都没有这种 patch |

---

## 21. 混响：算法与卷积

（并入 §8.2、§20.2。本节只补充**两条路线的对照与选择理由**。）

| | 算法混响（Freeverb 拓扑） | 卷积混响（分区 FDL） |
| :-- | :-- | :-- |
| 参数 id | `FX_REVERB_ON/SIZE/MIX/DAMP/WIDTH/PREDELAY`（29/30/31/67/68/69） | 同上一组 + `FX_REVERB_MODE = 1`（**94**）+ `FX_CONV_TRIM`（**95**） |
| 空间 | 合成、可控、参数化 | 真实（导入 IR） |
| 延迟/PDC | **0**（无延迟） | **`HOP = 1024` 样本**的湿声路径延迟（节点内） |
| 内存 | 梳状 + 全通延迟线（固定） | 分区谱（共享）+ 每节点 FDL（**857 KiB**，上限 2 节点） |
| 成本 | `bench` 基线 243 µs（非 IR）→ 333 µs（2 s IR） | 同左 |
| IR 长度上限 | — | **96 分区 = 98304 样本 ≈ 2.05 s @48 kHz** |
| 是否进效果池 | **否**（算法混响不入池，可以有任意多个节点） | **是**（上限 `CONV_INSTANCES = 2`） |

**为什么两条都有**：因为「空间」这个审美目标有两条不可互相替代的路径，
而**参数化**（SIZE/DAMP/WIDTH/PREDELAY）与**真实性**（IR）在不同 patch 上是不同的答案。
`FX_REVERB_MODE` 是一个**布尔开关**，不是「混合两种混响」。

**一条重要的兼容性说明**：`FX_REVERB_MODE` **不在效果模板的白名单里**——
所以应用模板**绝不会**把混响切到接收方没导入的响应（§19.7）。

---

## 22. 位粉碎、整形 EQ 与瞬态整形

三个效果都在 `crates/synth-core/src/fx_shaping.rs`，
「All three live in the effect-node pool next to the C effects, but they are **plain Rust**:
one fixed-size state block per node, no allocation, no C bridge entry.」
**每个节点自己的状态**，所以图可以把粉碎器和 EQ 放在两个不同位置而不共享滤波器。

### 22.1 位粉碎（见 §9.1）

关键公式再重述一次（**它是本仓库一个真实 bug 的根因**）：

$$\text{step} = \frac{2}{2^{\text{bits}}} \qquad \text{bits} \in [4, 16]$$

4 bit ⇒ **step = 0.125**。如果信号峰值只有 **~0.044**，则 $\text{round}(x/\text{step}) = 0$，
**湿声路被量化成精确的零**。这正是 `crushbass` 预设「几乎无声」的根因（§9.1）。

### 22.2 整形 EQ

三个 **RBJ biquad** 串联：low shelf / sweepable peaking mid / high shelf。

| 参数 | id | 范围 | 默认 |
| :-- | --: | :-- | --: |
| `FX_EQ_LOW_GAIN` / `_FREQ` | 158 / 159 | −18..18 dB / 40..1000 Hz | 0 / 200 |
| `FX_EQ_MID_GAIN` / `_FREQ` / `_Q` | 160 / 161 / 162 | −18..18 dB / 200..8000 Hz / 0.3..6 | 0 / 1000 / 0.9 |
| `FX_EQ_HIGH_GAIN` / `_FREQ` | 163 / 164 | −18..18 dB / 1000..16000 Hz | 0 / 4000 |
| `FX_EQ_MIX` | 165 | 0..1 | 1.0 |

**两条设计约束**：

1. **系数用 `exp2` 而不是 `pow`**——「so no libm `pow` is linked into the wasm for four EQ controls」
   （**体积**驱动）；
2. **平坦 EQ 必须是数学恒等**（`bit-exact`）——「A band whose gain is 0 dB comes out as a
   **mathematical identity**」；`MIX = 0` **完全跳过节点**。

### 22.3 瞬态整形（见 §9.3）

常量：`RECT_HZ = 200`、`FAST_HZ = 60`、`SLOW_HZ = 4`、`ATTACK_DB = 8.5`、`SUSTAIN_DB = 22.0`、
`DB_TO_LOG2 = 0.1660962`、`MAX_GAIN = 8.0`。

**实测（Rust and wasm 两把尺子）**：`attack = ±0.5 → +2.99 / −2.97 dB`（wasm **+2.87/−2.86**）；
`sustain = ±0.5 → ∓2.9 dB`（wasm **−2.29/+2.33**）；`MIX = 0` 与中性**逐位相同**；
持续音的 **THD 增量 0.00**（断言 ≤0.5 点）；最大步进 **< 0.5**。

**「A gate that measures what it claims」的例子**：`attack = ±0.5` 落在 ±3 dB 窗口内，
是 `ATTACK_DB = 8.5` 被**标定**出来的结果——即常量是为了命中门禁语义而选的。

### 22.4 已知边界

| 边界 | 说明 |
| :-- | :-- |
| 位粉碎的量化步长与信号电平耦合 | 见 §9.1；**4 bit 下「不静音」与「响度均匀」两个门禁互斥** |
| 粉碎与瞬态整形**不参与 2×** | `node_oversampled` 只含 Drive；注释说「CRUSH 同类，本批未开」 |
| EQ 的 Q 范围受限 | 0.3..6（`params.rs` 钳位） |
| 瞬态整形增益硬钳 | `[0, 8]`，「so no combination of controls can invert the signal or send it to infinity」 |

---

## 23. 限幅与输出级

### 23.1 目标与信号流位置

把多声部混音送到数字满刻度以内，**不产生硬削波**，并且在正常演奏时**不引入可闻染色**。
位置：`apply_fx` 之后，最后一级。

### 23.2 三级结构与常量

```text
master_volume（每块线性斜坡到目标）
  → lookahead limiter（LIMIT_CEILING = 0.95，LOOKAHEAD = 128，release 0.15 s，hold 0.05 s）
  → soft_limit(out, KNEE = 0.82)        ← 最后一道，也是**真正一直在工作**的那道
  → 非有限值 → 写 0 并 nan_events += 1
```

| 常量 | 值 | 出处 |
| :-- | --: | :-- |
| `VOICE_GAIN` | **0.44** | `engine.rs` |
| `FILTER_TRIM` | **0.65** | `engine.rs` |
| `LIMIT_CEILING` | **0.95** | `engine.rs` |
| `LOOKAHEAD` | **128** 样本（~2.7 ms @48 kHz） | `engine.rs` |
| `LIMIT_RELEASE_S` | **0.15** s | `engine.rs` |
| `LIMIT_PEAK_HOLD_S` | **0.05** s | `engine.rs`（循环内注释写「~60 ms hold-and-decay」） |
| `soft_limit` `KNEE` | **0.82** | `dsp/util.rs` |
| `SILENT_VOICE` | **0.002**（约 −54 dB） | `engine.rs` |
| `METER_FLOOR` | **1.0e-6**（−120 dBFS） | `engine.rs` |

### 23.3 限幅器「从不动作」的历史（**一个被实测推翻的设计假设**）

这是本仓库最有价值的一条教训。**原文证据**：

| 来源 | 原话 |
| :-- | :-- |
| `docs/NEXT-PLAN-2.md` §一 第 34 条 | 「`gs_limit_reduction()` 恒为 **1.00（限幅器从不动作）**」 |
| `docs/notes/loudness.md` | 「lookahead limiter 在绝大多数音乐性素材上**从不动作**——`gs_limit_reduction()` 返回的是**线性增益**（1.0 = 不动作），**不是 dB**」 |
| `engine.rs` `VOICE_GAIN` 注释 | 「the lookahead limiter **never engages even at +9 dB**, because the peaks are caught by `soft_limit` (knee 0.82)」 |
| p-loud 测量报告 | 「本次全部实测里除了 bank 的 `phonk`，它**一次都没动**」；「密集素材即使在 +9 也**没有**触发 lookahead limiter（peak 0.63）」 |

**被推翻的旧解释**（源码原文）：

> The old reason for the small value — "a dense chord sums to roughly **sqrt(N)** instead of **N**,
> so this leaves the bus inside the limiter's linear region" — **is not what actually bounds the
> level**.

**真正在兜底的是 `soft_limit`，而且它在基线就在工作**：
16 音满幅和弦输出 peak **0.901** → 反推**限幅器输入端** ≈0.93 > 0.82。

**但限幅器并非「完全没用」**——这两个事实必须同时写：

| 场景 | limiter min_gain |
| :-- | --: |
| 音乐性素材（91 预设库） | **1.000**（不动作），唯一例外 `phonk`：**0.993 lin（−0.06 dB）** |
| 密集和弦单测 `dense_chords_stay_clean` | **1.000 / 0.790 / 0.748 / 0.668**（各增益档） |
| 瞬态单测 `limiter_catches_transients_without_clipping` | **0.553 / 0.341 / 0.322 / 0.286（−10.9 dB）** |

所以正确的表述是：**在音乐性素材上它从不动作；在极端合成素材与瞬态场景上它确实工作。**

**`gs_limit_reduction()` 返回线性增益而不是 dB**——这一点曾被父代理搞错，
被计入「测量轨道修正父代理的三处数字」（`docs/NEXT-PLAN-2.md` §一 第 36 条）。
源码 `engine.rs` 的文档注释写得很清楚：「Limiter gain reduction, **1.0 = none**」。

### 23.4 `VOICE_GAIN 0.22 → 0.44`（+6 dB）的完整取舍

**起因**：用户报告「默认输出音量比其它软件低，系统音量要调很高才能听清」。

**根因量化**（干净满幅正弦：osc1 sine、level 1.0、滤波 20 kHz、drive 0、sustain 1、
master 1.0、`PATCH_GAIN` 1.0）：

| 量 | 值 |
| :-- | --: |
| 输出 peak | **0.115 = −18.82 dBFS** |
| RMS | **−21.91 dB** |
| THD | **0.021%** |
| limiter | **1.000** |

**−18.82 dB 的分解**（四个独立因素）：

| 因素 | 贡献 |
| :-- | --: |
| `VOICE_GAIN = 0.22` | **−13.15** |
| 等功率声像 0.707 | **−3.01** |
| 振荡器正弦幅度 0.9 | **−0.92** |
| ladder 通带损失 | **≈−1.7** |
| 合计 | **−18.78**（与实测 −18.82 差 0.04，属测量/舍入） |

**早期「整机低 13 dB」的说法漏掉了后 5.6 dB**——「那条读数是参数泄漏后的脏正弦」。

**为什么选 `VOICE_GAIN` 而不是别的**：它是**唯一**一次性覆盖
「默认 patch + 91 预设 + 用户/随机 patch」的旋钮
（`gain = VOICE_GAIN × patch_gain`，两处应用：立体声/单声道）。
另外要澄清：**首次启动的 patch 是 `DEFAULT_PARAMS`（`PATCH_GAIN = 1.0`），不是 `pluck` 预设**，
所以「只改预设 trim」治不到用户报的那个「默认」。

**三个候选值的实测矩阵**（`docs/notes/loudness.md`）：

| 指标 | 基线 0.22 | +3 dB (0.31) | **+6 dB (0.44)** | +9 dB (0.62) |
| :-- | --: | --: | --: | --: |
| 干净满幅正弦 peak dBFS | −18.82 | −15.82 | **−12.80** | −9.82 |
| 首次启动默认 patch peak dBFS | −20.02 | −17.02 | **−14.00** | −11.02 |
| 密集 bench（16 音）peak dBFS | −8.04 | −6.19 | **−4.89** | −4.01 |
| bank 中位乐句 RMS dBFS | −40.05 | −37.05 | **−34.03** | −31.07 |
| bank 最响预设 peak dBFS | −6.33（phonk） | −3.33 | **−0.73（phonk）** | −0.69 |
| 2× 驱动抗混叠降幅（要求 ≥12 dB） | 26.1 | 18.4 | **13.7** | **11.2 ✗** |
| `preset-loudness` spread（门禁 <9.0） | 7.8 | **8.9** | **8.1** | 7.8 |

**结论（原文）**：

- **+9 dB 已证伪**：3 条预设触膝、`phonk` 被限幅器压 **−2.79 dB**，
  而且 **2× 驱动抗混叠门禁真的掉到 11.2 dB < 12**——
  「驱动信号变热后 1× 本身的混叠变多，是**真音质退化**，不是标定」。
- **+6 dB 是甜点**：最响预设 `phonk` peak 从 −6.33 抬到 **−0.73 dBFS**，
  正好贴满幅；只有 **32 / 86400** 个样点轻触软削波膝（限幅器 −0.06 dB，不可闻）。
- **+3 dB 不划算**：只多 3 dB，却已经要动同样的门禁，而且 spread 冲到 **8.9**（离 9.0 只差 0.1）。
- **+6 dB 的代价**：2× 抗混叠只剩 **13.7 dB（1.7 dB 余量）**；
  极端合成素材更多进入软削波/限幅——「**这是 +6 dB 的固有代价，不是 bug**」。

**留下的建议**（`loudness.md`）：

> **下一次想更响，应该改输出级设计**（例如 limiter 的 make-up 放在更前、或抬 `LIMIT_CEILING`
> 并把限幅器真正用起来），而不是继续加增益。

### 23.5 重标定：什么叫「记账式」

这次增益改动迫使 **9 项**门禁/基线一起动。**每一项都有实测依据**：

| 项 | 改动 | 实测 |
| :-- | :-- | :-- |
| `tests/dsp-baseline.json` | rms **0.030735 → 0.061470** | 12 个 band 同步 ×2 |
| `tests/dsp-baseline-2x.json` | rms **0.030852 → 0.061703** | 同上 |
| `tests/preset-fingerprint.json` | **91/91 条移动** | 理由串写进 JSON 的 `reason` |
| `tests/preset-fingerprint-2x.json` | **91/91 条移动** | 同上 |
| `P96_STEP_RATIO` | 绝对界 0.13 → **1.10 × peak** | 实测 0.1061 → 0.2123（**×2.001**） |
| `HARD_SYNC_STEP_RATIO` | 绝对界 0.25 → **1.8 × peak** | 实测 0.1294 → 0.2588（**×2.000**） |
| `dense_chords_stay_clean` 软削波占比 | <0.1% → **<5%** | 0.00 / 0.94 / 1.21 / **1.50%** |
| `dense_chords_stay_clean` limiter min_gain | >0.98 → **>0.5** | 1.000 / 0.790 / 0.748 / **0.668** |
| `limiter_catches_transients…` min_gain | >0.4 → **>0.25** | 0.553 / 0.341 / 0.322 / **0.286（−10.9 dB）** |
| `stacked_voices_do_not_start_in_phase` mix peak | <1.2 → **<1.2 × VOICE_GAIN/0.22** | **1.923464（×2.0000）** |

**步进/峰值比值逐位不变**（这是「改动纯粹是尺度」的证明）：
P9.6 **91.6% vs 91.6%**；hard-sync 锯齿 **0.955 vs 0.955**。

**两向自证**：

1. 把 `VOICE_GAIN` 改回 **0.22** → **新基线变红**（证明重录是真的，不是把门禁关掉）；
2. 相对化后的步进门禁**仍绿**（证明它是**尺度相关**的，不是单边放宽）。

**不是机械 ×k**：粉碎/量化族的**频谱真的改变了**（因为量化台阶相对信号位置变了）：

| 预设 | 1× 频点变化 | 2× 频点变化 |
| :-- | --: | --: |
| `graphpump` | 200 Hz −110.94 → −76.65（**+34.29 dB**） | 5012 Hz −112.50 → −98.24（+14.26） |
| `crushlead` | 3981 Hz −109.61 → −89.98（+19.63） | 200 Hz −96.50 → −70.66（**+25.84**） |
| `crushbass` | 316 Hz −79.57 → −98.75（**−19.18**） | 631 Hz −103.37 → −86.89（+16.47） |
| `tapecrush` | 10000 Hz −126.63 → −144.40（−17.76） | 10000 Hz −141.16 → −128.65（+12.51） |

### 23.6 已知边界

| 边界 | 说明 |
| :-- | :-- |
| 2× 抗混叠余量只剩 **1.7 dB** | 13.7 vs 12 的硬线（+6 dB 的代价） |
| 极端素材余量变小是**结构性**的 | 「只要 knee/ceiling 是绝对电平，抬总线就必然花掉头部空间……这是**连续的取舍**，不是 +6 特有的悬崖」 |
| 限幅器在音乐素材上仍不动作 | 产品层面的开放问题，建议改输出级设计而不是加增益 |
| `LIMIT_PEAK_HOLD_S = 0.05` 与注释「~60 ms」口径不同 | 见 §32 |
| 真峰值只是「相邻样本均值」估计 | **不实现 ITU-R BS.1770 / EBU 标准真峰值表**（见 §1.6） |

---

## 24. 声部分配、复音与双实例

### 24.1 语音分配与偷声（见 §10.6）

补充常量：

| 常量 | 值 |
| :-- | --: |
| `MAX_VOICES` | **32** |
| `VoiceManager::new` 默认 `max_polyphony` | **16** |
| `PENDING_CAPACITY` | **8** |
| `STEAL_RELEASE` | **0.02 s**（20 ms） |

**偷声排序**（`find_victim`）：`score = env_value + released_bonus(−1 if released) + age×1e-6`，
越小越该偷，即 **已释放且安静 > 已释放 > 安静 > 最老**。
单测 `stealing_prefers_released_and_quiet_voices` 把三条优先级都钉住了。

**为什么 fade 是 20 ms**（`STEAL_RELEASE` 注释）：

> 20 ms is inaudible as a note ending but spreads the discontinuity over a **thousand samples**.

**弹性复音**：`force_release_excess(limit)` 保留**最新**的 `limit` 个声部（按 `age` 插入排序，
n ≤ 32 无分配），其余走释放——prd.md §7.1 的要求。

### 24.2 负载监视器（`src/audio/worklet-processor.js`）

宿主侧有一个**自适应降声部**的监视器：

| 常量 | 值 | 含义 |
| :-- | --: | :-- |
| `WARMUP_MS` | **2000** | 允许动作前的渲染预热 |
| `MISS_STREAK` | **3** | 连续超预算块才算「错过截止」 |
| `OVER_LOAD` | **0.35** | 「太多」的负载比例 |
| `OVER_BLOCKS` | **12** | 连续超该比例才降声部（约 32 ms） |

**决策基于「重复」而不是单块**（注释原文）：

> a missed deadline … counts after **three in a row** — one is a GC pause, a page fault or another
> tab; high load counts after a sustained stretch — a single spike used to drag the average over
> the threshold for twenty blocks, **which is how a phone at 4% load reported "device overloaded"
> on the first key press**.

降声部：`step = 8 if (missed || load > 0.85) else 4`，下限 **4 个声部**，
冷却 **250 ms**（错过）或 **900 ms**（过载）；恢复：`load < 0.12` 且距上次 ≥ **8000 ms**，
每次 **+4**，且**不超过用户钉的上限**。

**`song-quality` 门禁就是为了这条路径**——它检查 `gs_silent_voice_blocks()` 与
`gs_active_voices() <= poly`。动机（源码注释）：

> the voice ceiling the load monitor asked for **was being undone by the parameter flood**, so a
> device that needed to drop to four voices kept running sixteen and missed its deadlines —
> which is what a listener hears as **crackle**.

### 24.3 双实例（layer / split）

`gs_set_param_inst(instance, id, value)`：**instance 0 = 主 patch，instance 1 = layer**。
设计理由（`abi.rs`）：

> The worklet's AudioParams carry instance A; instance B arrives as **messages**, which keeps a
> hundred extra AudioParams out of the graph.

**路由**（`gs_set_instance_route(mode, split_note, a_lo, a_hi, b_lo, b_hi)`）：

| mode | 语义 |
| --: | :-- |
| 0 | `Single`：全部走 instance A（**默认，所以老 patch 不受影响**） |
| 1 | `Layer`：每个音**两个实例都播** |
| 2 | `Split`：`note <= split_note` 走 A，否则走 B |

**力度窗口**（`a_lo/a_hi/b_lo/b_hi`）让 split 兼作**动态层**：「soft notes one sound,
hard notes another」。

**一个微妙但重要的语义**（`VoiceManager::note_on_inst` 注释）：

> A note is one voice per instance: in layer mode the engine calls this **twice** for the same note,
> which allocates two voices because voices are found by **free slot, not by note number**.

**被提升的待处理音符保留它的 instance 与 pan**（否则「a stolen note in a panned layer would
jump to the centre」）。单测 `pending_note_keeps_its_pan` 钉住这条。

### 24.4 已知边界

| 边界 | 说明 |
| :-- | :-- |
| layer 模式**吃两倍声部** | 每个音两个 voice，所以复音实际减半 |
| split 是**按音符号**的硬边界 | 没有交叉淡化区（力度窗口是另一种维度） |
| 编辑器/实例显示不一致（P7.3，**已知未修**） | 「保存/套用跟随 store 的 `activeInstance`，而图编辑器显示实例 1 的 snapshot」（`docs/NEXT-PLAN-2.md` §一 第 8 条） |
| 负载监视器降声部会**改变音色密度** | 这是设计意图（宁可少声部也不 crackle），但用户可感知 |

---

## 25. 频谱分析与 UI 计量

### 25.1 引擎内频谱分析仪

`crates/synth-core/src/fft.rs` 的 `Spectrum`：

| 常量 | 值 |
| :-- | --: |
| `FFT_SIZE` | **512** |
| 输出 bin 数 | `SPECTRUM_BINS = 36` |
| 窗 | **Hann**（`0.5 − 0.5cos(2πn/(N−1))`） |
| 分箱 | 对数 |
| 频率分辨率 | ~**94 Hz** @48 kHz |

预算：**512 点 FFT + 36 个对数 bin**，「which is plenty for a 36-band display」。
调用频率由宿主决定：`ANALYSIS_INTERVAL = 6` 个 block（约 **16 ms @48k/128**）。

### 25.2 计量与告警口径

| 量 | 来源 | 口径 |
| :-- | :-- | :-- |
| `peak_l` / `peak_r` | `simd::peak` | 块内最大 \|x\| |
| `true_peak` | 相邻样本均值估计 | **取走即清零**（since last call） |
| `loudness_rms` | 输出 RMS | **线性幅度**（UI 转 dBFS） |
| `limit_reduction` | limiter 增益 | **线性（1.0 = 不动作）**，不是 dB |
| `nan_events` | 非有限值计数 | 每个坏样本 +1 |
| `silent_voice_blocks` | 走静音快捷路径的 voice-block 数 | 用于证明优化真的生效 |
| `active_voices` | 当前活跃声部数 | |
| `oversample_latency` | 2× 内建延迟 | 开 31 / 关 0；图模式含 PDC 时 **62** |
| `alloc_violations` | 实时循环内分配次数 | **必须为 0** |
| `arena_free_bytes` | 空闲字节 | bench:long 要求 > **512 KB** |

宿主侧 VU 映射（`src/audio/meter.ts`）：**−48..0 dBFS**；
`METER_FLOOR_DB = −60`；`LOAD_DISPLAY_FLOOR = 0.05`；
`meterIsHot`：peak **> −0.5 dB** 或 load **> 0.9**；
limiter 闲置（gain ≥ **0.999**）时**不显示**增益衰减。

### 25.3 导出归一化

`src/audio/render.ts`：`normalizePeak(data, ceiling = 0.891, maxBoostDb = 24)`，
即约 **−1 dBFS** 天花板。注释说明两个理由：

- 单音比密集和弦低 **15–20 dB**（没有 boost 时电钢导出约 **−23 dBFS**）；
- boost 有上限，**以免把近乎无声的渲染放大成底噪**。

### 25.4 已知边界

| 边界 | 说明 |
| :-- | :-- |
| 频谱分析仪分辨率有限 | 512 点 ≈ 94 Hz/bin，低频细节差（**UI 用途，不是测量用途**） |
| 频谱分析仪在音频线程上 | 每 6 个 block 一次，是引擎里**唯一**的音频线程 FFT |
| 真峰值非标准 | 见 §1.6 |
| VU 下限 −48 dBFS | 低于 (−48, −60] 区间只有 `METER_FLOOR_DB` 一个阈值；**精确行为未逐行验证** |

---

---

# 第三部分 · 测量与门禁方法论

> 本部分是本文档最有「可迁移价值」的一章：它讲的是**怎么知道自己没骗自己**。
> 本仓库在这件事上付出了真实的代价（三次数字被后续测量推翻、两把尺子各有一个失效区、
> 一条门禁曾静默失效），所以这里的每一条纪律都有出处。

---

## 26. 为什么需要两把独立的尺子

### 26.1 一条尺子无法同时做到「全谱」和「高动态」

混叠（以及一切非谐波杂散）有两个互补的观察方式：

| 观察方式 | 强项 | 弱项 |
| :-- | :-- | :-- |
| **全谱积分**（把整个频谱减掉谐波栅格） | 落在哪里都能收到；不漏 | 只给一个标量；**受窗自身旁瓣限制** |
| **单频探针**（在谐波之间的空隙读数） | 动态范围极高（不受宽频旁瓣限制） | **只看到探针那几个频率**；需要在「空隙足够宽」的音上 |

本仓库**两把都做**，并且**故意用完全不同的实现**（全谱窗 FFT vs 单频 Goertzel），
使两者的失效模式**不重叠**。`docs/NEXT-PLAN-2.md` §一 第 42 条把这条纪律写成：

> **第二把独立尺子**。

### 26.2 尺子 A：7 项 Blackman-Harris 全谱 off-grid 积分（BH-7）

**实现**（`scripts/verify-audio.mjs` `offGridFloor`）：

```javascript
const N = samples.length;
let nfft = 1; while (nfft < N) nfft <<= 1;
for (let i = 0; i < N; i++) re[i] = samples[i] * bh7Window(i, N);
fftInPlace(re, im);
const exHz = (FLOOR_BINS * SR) / N;                 // FLOOR_BINS = 8
// 每个谐波 k*f0 的 ±exHz 范围标记为「已排除」
return 10 * Math.log10(Math.max(off, 1e-300) / Math.max(total, 1e-300));
```

| 参数 | 值 | 出处 |
| :-- | --: | :-- |
| 分析窗长 `FLOOR_SECONDS` | **4 s** | `verify-audio.mjs` |
| 稳定块 `SETTLE_BLOCKS` | **400**（1.07 s；「P6.2b report measured another 12 dB over 200」） | 同上 |
| 排除半宽 `FLOOR_BINS` | **8 bin = ±2 Hz** | 同上 |
| 窗主瓣 | **±1.75 Hz** | 注释：4 s 时 bin = 0.25 Hz，8 bin 刚好盖住主瓣 |
| 窗系数（7 项，minimum-sidelobe） | `0.27105140069342, 0.43329793923448, 0.21812299954311, 0.06592544638803, 0.01081174209837, 0.00077658482522, 0.00001388721735` | 同上 |
| 旁瓣 | **−180 dB** | 注释 |

**为什么必须是 7 项而不是 4 项**（这一段是**尺子标定**的典范）：

> The **4-term** Blackman-Harris is not enough: its **−92 dB** sidelobes leave a pure sine at
> **−104 dB**, above the **−105 dB** line this batch has to hold, while the **7-term** one reads
> **−117 dB** and does not move when the exclusion band is widened to **16 Hz**.

即：4 项窗的读数（−104 dB）**比它要验证的指标（−105 dB）还高**——
用 4 项窗去验证 −105 dB 等于在测窗本身。

**它在门禁里的用法（精确阈值）**：

| 场景 | 阈值 | 实测 |
| :-- | --: | --: |
| 稳态正弦 8 个音 `[33,45,57,69,81,91,96,105]` | max < **−105 dB** | −119.4 |
| triangle（键盘扫描） | < **−68 dB** | −73.1 |
| saw | < **−95 dB** | −100.8 |
| square | < **−105 dB** | −111.3 |
| 8 个全新场景的**离散度** | < **20 dB** | 7.26 / 4.65 / 0.61 |
| 硬同步（3 波形 × 4 比值 × 3 窗） | worst < **−60 dB** | −88.1 |
| **P9.6 钉死相位 `P96_SEED = 707`** | < **−95 dB** | 修前 **−44.8** → 修后 **−112.4** |
| 波表 vocal @C7 | < **−95 dB** | −104.9 |
| 采样 @C7 | < **−85 dB** | −90.1 |

### 26.3 尺子 B：Hann 窗 Goertzel 单频探针（探在谐波空隙里）

**实现**（`verify-audio.mjs` `binMagHann`）：

```javascript
const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);   // 半样本偏移
const v = samples[i] * win;
re += v * Math.cos(w * i);  im -= v * Math.sin(w * i);
windowSum += win;
return (Math.hypot(re, im) / windowSum) * 2;      // 除以 windowSum，不是 n
```

**它的立足点是「C7 的 4 s 恰好 8372 个整周期」这一个数论巧合**：

> C7 is the note whose 4 s hold **exactly 8372 cycles** (**4 × 2093 = 8372**), so at C7 every
> harmonic sits on a whole-Hz frequency and the **gaps between them are several hundred Hz wide**.

三个探针频率 **9000 / 9200 / 9500 Hz**：
`2093×4 = 8372`、`2093×5 = 10465`，所以它们距**最近的谱线**是 **528 / 328 / 28 Hz**，
距**下一条**是 **1000+ Hz**。报告形式是「**相对基频的 dB**」。

**它在门禁里的用法**：

| 场景 | 阈值 | 实测 |
| :-- | --: | --: |
| 波表 vocal bank @C7 | worst < **−150 dB** 且 BH-7 < **−95 dB** | 第二把尺子 −179.1 / −168.3 / −184.5 |
| 采样 @C7 | worst < **−120 dB** 且 BH-7 < **−85 dB** | 第二把尺子 −146.7（BH-7 −90.1） |

### 26.4 已废弃的「第三把尺子」：矩形窗 + 精确 bin

这是**尺子本身成为瓶颈**的教科书案例：

> 同样的 8372 周期但用**矩形窗**。At the −30 dB it was measuring that was fine;
> **P9.7's fix dropped the floor by another 70 dB and exposed the ruler's own limit** —
> a rectangular window's sidelobes decay as **1/bin**, so with harmonic lines this strong the gap
> bins hold about **−13 dB of leakage** no matter what the source does.

处置方式是**换尺子，不是放宽阈值**（笔记原文：

> 「地板从 −30 压到 −100 dB 后，矩形窗自己的 1/bin 旁瓣（每 bin 约 −13 dB 泄漏）已经不够用了，
> 是**换尺子**而不是放宽阈值。」

### 26.5 其他测量原语（同一文件）

| 原语 | 窗 | 归一化 | 用途 |
| :-- | :-- | :-- | :-- |
| `binMag` | Hann | `/n × 2` | 一般单频探针、THD、硬同步 |
| `binMagHann` | Hann（**半样本偏移**） | `/windowSum × 2` | 第二把尺子 |
| `binMagRect` | 矩形 | `/N` | 2× 过采样 / 图节点的 Parseval 抗混叠 |
| `spectrum(samples, 8192)` | 4 项 BH | — | 时域点击/失真检查（**旁瓣 −92 dB**） |
| `offGridFloor` | **7 项 BH** | Parseval | 主尺子 |

**Parseval 的用法（`aliasFloor`）**：note 45（110 Hz）、**整 1 秒**、`binMagRect(k·f0)`，
「正弦幅度 A 读 `|sum|/N = A/2`，故功率是 `2m²`」，`folded = max(rms² − harmonics, 1e-30)`。
**夹具把 `MASTER_VOLUME = 0.1`**，理由是：

> 它的增益环是时变的，会被算成非谐波能量。

---

## 27. 两把尺子的参数与失效模式

### 27.1 尺子 A（BH-7）的五个失效模式

| # | 失效模式 | 表现/数字 |
| --: | :-- | :-- |
| 1 | **窗自身泄漏就是地板** | 4 项 BH（−92 dB 旁瓣）会把纯正弦读成 **−104 dB**；低于此的指标不能用它验证 |
| 2 | **它是全谱标量** | 无法分辨「一条窄的非谐波线」和「宽带杂散」，也**不给频率位置** |
| 3 | **必须有精确的 f0 栅格** | 需要已知音符频率，且信号**已 settle、无调制**、**调制矩阵已清空** |
| 4 | **对相位/种子敏感** | P9.1b 后起点相位成为参数，所以只能断言「8 个场景互相在 20 dB 内」，**不能断言逐位相同** |
| 5 | **不是「每场景都过 −60」** | 已知 **0.7% 离群**：2093 Hz 经工厂滤波（cutoff 18 kHz、res 0.05），**1/150** 新场景读到约 **−54 dB**；`res = 0` 时 **0/150**；pre-P9.1b 核 **150/150** 超 −60 |

第 4 条的完整背景（笔记原文）：

> 旧「同一个场景连做 8 次逐位相同（当时读 0.00 dB）」在带限路径上**语义不再成立**……
> 改成「8 个全新场景的离散度 < 20 dB」（拦 P9.1c 那种 86 dB 爆发）。

第 3 条的一个具体陷阱：**采样器级测试台没有 18 kHz 低通，读数会高出 30 dB 以上**；
以及**尺子的 f0 步进差 0.02%（1046.25 vs 1046.502 Hz）能把地板从 −81 读到 −14 dB**——
「FFT 网格要错开（分析步数取质数如 997）」（`docs/notes/band-limited-oscillators.md` §「工具箱」）。

### 27.2 尺子 B（Hann Goertzel）的四个失效模式

| # | 失效模式 | 表现 |
| --: | :-- | :-- |
| 1 | **只读少数确切频率** | 探针之外的非谐波**全看不见** |
| 2 | **只在「谐波落整 Hz、空隙几百 Hz 宽」的音上成立** | 本项目靠 C7 的 4 s = 8372 周期这一个巧合；换音/换时长**就不成立** |
| 3 | **Hann 窗自身泄漏**（源码里有两处不同口径的量化） | `spectrum()` 注释：「a Hann window's own sidelobes sit around **−46 dB** a few bins away from a strong partial」；硬同步/2× 注释：「Hann's own sidelobes sit near **−95 dB**」 |
| 4 | **报「单点地板高度」** | 不是全谱能量；看不到其它频段/宽带问题 |

第 3 条的「两处不同口径」值得专门指出：它们描述的是**不同距离/不同场景**下的旁瓣行为
（近旁瓣 vs 远旁瓣），但**写在同一份文件里容易被读成矛盾**（见 §32）。

### 27.3 结论：两把尺子的分工

| 问题 | 用哪把 |
| :-- | :-- |
| 「这个源的**总体**离网地板是多少？」 | **尺子 A** |
| 「谐波之间的空隙里**到底有没有**东西？」 | **尺子 B** |
| 地板在 −25 dB 量级（P9.5 时期） | 两把都可以（当时第二把是矩形窗，足够） |
| 地板压到 −100 dB 以下（P9.7 之后） | **只能靠尺子 B**（矩形窗和 4 项 BH 都不够了） |
| 2× 过采样的**降幅**（相对量） | **`binMagRect` + Parseval**（相对量不需要绝对地板） |
| 时域点击 | **`spectrum`（4 项 BH）+ 最大相邻步进** |

**「相对量用便宜的尺子，绝对地板用贵的尺子」**是一条可迁移的工程原则：
2× 抗混叠门禁只要求「≥12 dB 的降幅」，所以用**矩形窗 + Parseval** 就够；
而「地板 ≤ −60 dB」是绝对指标，必须用 BH-7。

---

## 28. DSP 指纹与预设指纹

### 28.1 DSP 指纹（`scripts/dsp-baseline.mjs`）

**一个固定 patch，26 个数字**：

| 项 | 值 |
| :-- | :-- |
| 采样率 / 块 / 时长 | 48000 / 128 / **2 s** |
| 音符 | note **69**，velocity **1** |
| patch | `OSC1_WAVE = 2`（saw）、`OSC1_LEVEL = 0.8`、`OSC2` 关、`FILTER_TYPE = 0`、`FILTER_CUTOFF = 5000`、`FILTER_RES = 0.3`、`FILTER_DRIVE = 0.2`、`ENV_ATTACK = 0.001`、`ENV_DECAY = 0.1`、`ENV_SUSTAIN = 1`、`ENV_RELEASE = 0.2`、LFO/LFO2/reverb/delay 关、`VOICE_MODE = 0`、`OVERSAMPLE = 0/1` |
| 指纹区间 | **稳态第 2 个 1 秒**：`samples.subarray(SR, SR + 8192)` |
| 数字 | `rms`（`toFixed(6)`）+ **12 个 Goertzel 频点**（`toFixed(6)`） |
| 12 个频点 | **80, 160, 320, 640, 1280, 2560, 5120, 10240, 200, 500, 1000, 4000 Hz**（矩形/无窗） |
| 容差 | **1e-4**（rms 与每个 band 各自） |
| 当前基线 | 1× `rms = 0.061470`（JSON 写 `0.06147`）/ 2× `rms = 0.061703` |

**两份指纹互不派生**：`npm run test:dsp` 与 `npm run verify:dsp:2x`（`--oversampled` 选
`tests/dsp-baseline-2x.json`）。两者都进 `verify` 链、CI 与 `verify-ci.mjs` 的必需清单。

**同一次运行的噪声底是 0.000 dB**（同一份 wasm 跑两遍，26 个数字**逐位相同**）——
所以 1e-4 的容差是留给「**重新编译的二进制**」的，不是留给测量的。
这一条极其重要：它说明**指纹门禁本身不引入噪声**。

### 28.2 rms 的历史（**三个不同的数值，不能混用**）

| 时期 | 1× rms | 2× rms | 来源 |
| :-- | --: | --: | :-- |
| v1.97.0（P9.1b 之前） | **0.030806** | **0.030946** | `docs/notes/oversampling.md`、`docs/NEXT-PLAN-2.md` §一 |
| P9.1b 之后（带限振荡器） | **0.030735** | **0.030852** | 同上（显式重录，理由：带限振荡器改变稳态波形） |
| **+6 dB 之后（当前）** | **0.061470** | **0.061703** | `tests/dsp-baseline*.json` |

**引用纪律**：写文档或做对比时**必须说清是哪一代**。
本仓库自己的笔记里这三代数字**同时存在**，这是正常的（那些笔记是历史记录），
但读者容易把它们当成同一个数。

### 28.3 预设指纹（`scripts/verify-presets.mjs`）

**覆盖**：**每一个工厂预设**（`FACTORY_PRESETS`，跳过 `preset.user`）→ 当前 **91 条 × 2 模式**。

**每个预设 26 个数字**：`rms`、`peak`、`stereo` + **24 个三分倍频程频点**
（`50, 63, 79, 100, 126, 158, 200, 251, 316, 398, 501, 631, 794, 1000, 1259, 1585, 1995, 2512,
3162, 3981, 5012, 6310, 7943, 10000 Hz`，比值 ≈1.26）。

**渲染方式**：每个预设**全新 wasm 实例**；`gs_init(48000, 16)`；
参数走 `presetParams` → `gs_set_param`；路由走 `gs_set_mod_route`；
二层预设再 `gs_set_param_inst(1, …)` + `gs_set_instance_route(…)`——
**与 `store.applyPreset` 的跑法一致**（这是一条重要的纪律：门禁必须走产品的路径）。

**乐句**：`[[60,0,0.7],[64,0,0.7],[67,0,0.7],[55,0.8,0.9]]`，总长 **1.8 s**，velocity **0.9**。

**容差（每个数各自）**：

| 量 | 容差 |
| :-- | --: |
| `rms` | **0.25 dB** |
| `peak` | **0.5 dB** |
| `stereo`（左右 rms 比） | **0.25 dB** |
| 每个 band | **0.5 dB** |

`severity = delta / tolerance`；`failures = entries.filter(severity > 1)`。

**ABI 保护**：`baseline.abi !== abi` **直接红**并要求重生成
（`the parameter ABI changed (8 -> N)`）——当前 `"abi": 8`。

**`--update` 必须给 `--reason`**（否则 `exit 2`），理由写进基线 JSON：

> 改预设的音色是**决定**，不是 diff，所以让它在文件里留名。

**容差是标定出来的**（对 `pluck`：`FILTER_CUTOFF 5200`、`ENV_DECAY 0.13`、`OSC1_LEVEL 0.7`）：

| 扰动 | 最大偏移 | severity | 结果 |
| :-- | --: | --: | :-- |
| 截止 −1%（5200→5252） | 0.147 dB @10 kHz | 0.29 | 通过 |
| 电平 −1%（0.7→0.693） | 0.052 dB（rms） | 0.21 | 通过 |
| 截止 −5%（5200→4940） | 0.836 dB @10 kHz | **1.67** | 失败 |
| 包络衰减 +5%（0.13→0.1365） | 0.887 dB @3.2 kHz | **1.77** | 失败 |
| 截止 −10%（5200→4680） | 1.593 dB @10 kHz | **3.19** | 失败 |
| 电平 −5%（0.7→0.665） | 0.265 dB（rms） | **1.06** | 失败 |
| 一批预设各改 10–25% | 最大 **47 dB** | 巨大 | 失败 |

结论：**约 5% 的预设参数改动会被拦下，1% 的微调会通过**。

**灵敏度标定过程中的一个自我纠错**（`preset-fingerprint.md`）：

> 标定脚本一开始用 `[P.FILTER_CUTOFF]: [0-9]*, [P.FILTER_RES]: 0.35` 这样的**宽松正则**改文件，
> 结果**一次改到了十几个预设**，报告里出现 **45 dB** 的夸张差异……
> 提醒标定必须**只改一处**（后续改成整行唯一匹配）。

**「整份重录但只有少数真的动」的判读纪律**（P9.7 波表带限的先例）：
`--update` 整份重写 81 条，其中**真的变的只有 4 条**
（`wtglass` 2.604 dB、`wtmetal` 1.175、`wtvocal` 0.838、`wtorgan` 0.793 dB），
其余 77 条最大偏移 **≤0.0090 dB**，归因是「新增的 16 KB 表改变了堆布局 + 重编译的二进制」。
→ **重录不等于全部音色都变了**；判读时要看 `--report` 的 severity 排序。

**2× 是独立的第二份证据**：81 个预设里 **80 个**在 1×/2× 有数值差异
（最大 **43.871 dB**，`wtmetal`），只有 **1 个**两种模式逐位相同。

**运行时间**：`verify:presets` **13.449 s**、`verify:presets:2x` **20.604 s**，合计 ≈**34 s**。

### 28.4 指纹的失效模式

| 失效模式 | 表现 | 处置 |
| :-- | :-- | :-- |
| **新增/删除预设** | 多一行或多一条 `preset removed` | 正常；`severity = Infinity` |
| **DSP 变了但预设没动** | 报出一批预设的频谱偏移 | 接受并重录，理由写进 `reason` |
| **只改过采样** | 通常只 2× 红 | 正常（两份独立） |
| **ABI 变动** | **直接红**，不看数字 | 强制重生成（这条拦住了「参数编号漂移」） |
| **重新编译的二进制** | 微小偏移（≤0.0090 dB 量级） | 容差（0.25/0.5 dB）就是为它留的 |
| **重录时「顺手」改了别的** | `--reason` 缺失 → **exit 2** | 强制留下理由 |
| **顺序敏感** | `diff()` 以 `Object.entries(after)` 迭代并 `sort(by severity desc)`；基线序列化「一个预设一行」 | 序列化是一行一预设，所以 diff 可读；**但不保证输出顺序稳定** |

最后一条的实际影响：`--report` 的**排名**是稳定的（按 severity），
而**同 severity 的并列顺序**取决于 `Object.entries` 的插入顺序——
这不是正确性问题，但**不适合作为逐行文本比对**。

---

## 29. bench 与实时预算

### 29.1 它要抓什么

`scripts/bench.mjs` 的自我定位：

> The audio verifier measures **one** patch and **one** load; this runs the engine for several
> seconds of dense polyphony and writes down what it cost, so a regression that **only shows up
> under sustained load** ("it is fine for a second, then it starts dropping blocks") has somewhere
> to be noticed.

### 29.2 负载与时长

| 项 | 值 |
| :-- | :-- |
| 复音 | `gs_init(48000, **32**)` |
| patch | 双锯齿，`OSC1_LEVEL 0.7` / `OSC2_LEVEL 0.6`，`FILTER_CUTOFF 12000`、`RES 0.35`、`DRIVE 0.3`、`ENV_AMT 0.3`，**LFO/LFO2/reverb/delay/chorus/phaser/drive 全开**，两个 unison **= 3** |
| 音符 | 16 个持续音 `[36,43,48,52,55,59,62,64,67,71,74,79,83,86,88,91]`，velocity 0.9 |
| 时长 | `SECONDS = LONG ? 60 : 6`（`--long`） |
| 预算 | `BUDGET_US = (128/48000)×1e6 = **2666.67 µs**` |
| 预热 | **60 块**（「JIT compilation is not what this measures」） |
| IR 场景 | `irLen = min(capacity, 2×SR)`，指数衰减噪声；「A 2 s response is **96 partitions**」 |

### 29.3 判据（正确性 vs 计时）

**正确性（任何负载都判）**：

| 判据 | 阈值 |
| :-- | :-- |
| `no non-finite samples` | `nonFinite === 0` |
| `output stays in range` | `peak <= 1.0` |
| `no allocation on the audio thread` | `gs_alloc_violations() === 0` |
| `the voice pool is in use` | `gs_active_voices() >= 8` |

**计时**：

| 判据 | 阈值 |
| :-- | :-- |
| `the typical block fits the budget` | **p50 < 60%** of quantum |
| `most blocks fit the budget` | 平滑后超预算块 **≤ 2%** |
| IR 路径 | 同 **2%** |
| 卷积分摊 spread | `busiest/typical < **1.35**`（排除 transform 那一 phase） |
| `--long` 额外 | `arenaFreeKb > **512**`、`memoryMb < **32**` |

**mean / p99 / worst 只打印不断言**。理由：

> 本机约 **1%** 的块会因宿主调度间隔到量子的 **40–90×**，
> raw p99 在 **2.2 ms 与 115 ms** 之间乱跳。

### 29.4 统计口径：为什么用「窗口化中位数」

```javascript
function windowedMedianSeries(times, radius = 16) {
  // 每个块替换为它 ±16 块邻域的中位数
}
```

「一个孤立 stall 无法让一块算作引擎 miss，但**真的存在的成本能survive中位数**」。
这是本仓库对「**如何在一片噪声中测一个真实信号**」的答案：
不要用平均（会被极端值主导），不要用单点（会被 stall 击中），
用**局部中位数**——它同时拒绝脉冲噪声并保留持续成本。

**校准数字**：`load ~3.6` 时 raw **81/2250（3.6%，超 2% 线）** 而 `p50 = 1287 µs`、
有 **115 ms** 的孤立 stall，「i.e. the raw count was reading the scheduler, not the engine」。

### 29.5 宿主繁忙判定：**两道自检**

1. **`hostLoad()`**：读 `/proc/loadavg`，`busy = load1 > cpus × 0.5`。
   校准：「the same 16-voice scene reads p50 **1169 µs（44%）** at load **~2** on this 8-core box
   and **1621 µs（61%）** at load **5.8** — 一个 **38%** 的摆动**只来自宿主**」。
2. **`cpuProbe()`**：7 次固定 `300_000` 次浮点循环取**最小值**；
   `PROBE_REFERENCE_US = 1600`、`PROBE_LOADED_FACTOR = 4`；`probeUs > 6400` → `loaded = 'slow'`。

`loaded` 时**计时判据打印「skipped, host is loaded」且退出码仍为 0**，只报正确性。
`NEXT-PLAN-2.md` §一 第 20 条把这一点的**风险**明确列为未做项：
「`verify` 复合链 bench 会**静默降级**成 `PASS (correctness only)`」，
即「整链绿」可能包含「计时根本没判」。

**一个曾经静默失效的门禁（本仓库的「我们错了」之一）**：

> P9.1b 用 `cpuProbe()` 取代旧的 `mean > 450 µs` 启发式，因为那个数是在整机 ~250 µs 时标定的：
> 一旦带限振荡器把同一场景推到 ~1400 µs，门禁就把**引擎自己的合法成本**读成「宿主过载」
> 并静默把每条计时断言降级成 `skipped`……
> **A gate that stops gating when the workload gets heavier is worse than no gate.**

这段话值得抄在任何实时项目的门禁设计文档里。

### 29.6 实测数字（**必须带宿主负载口径**）

`docs/notes/performance.md` 的历史行（单位 µs/块，预算 2667 µs）：

| 日期 | 场景 | 平均 | p50 | p99 | 最差 | 平均占用 | 声部 |
| :-- | :-- | --: | --: | --: | --: | --: | --: |
| 2026-09-11 | 6 s · 16 notes | 243 | 245 | 320 | 940 | 9.1% | 10 |
| 2026-09-11 | 6 s · 16 notes | 244 | 243 | 351 | 982 | 9.1% | 10 |
| 2026-09-11 | 6 s · 16 notes · IR 2.0 s | 333 | 288 | 708 | 1307 | 12.5% | 10 |

**P9.1b 带限振荡器之后的同一场景**（`bench.mjs` 注释）：
p50 **260 → 1169 µs（9.8 → 43.8%）**、mean **265 → 2185 µs**、
超预算 **21/2250**、raw p99 **421 → 2459 µs（16 → 92%，informational）**；
60 s `bench:long` 量到 **153%** of quantum，p50 **49%**。

**安静窗口（可信）的数字**：

| 条件 | 结果 | 出处 |
| :-- | :-- | :-- |
| load **2.64 / 2.67**、cpu probe 930 / 913 µs | 两次 timing judged 4/4：p50 **1199 µs（45.0%）** / **1197 µs（44.9%）**；超预算 **0/2250**（raw 9 / raw 1）；IR 也 **0/2250** | `NEXT-PLAN-2.md` §一 第 15 条 |
| 同代码在 `verify` 链里 load **6.7** | p50 **1554 µs**，且 **`PASS (correctness only) — 0 judged, 4 skipped`** | 同上 |
| load **1.13**（`bench --long`） | PASS：p50 **1091 µs（40.9%）**、`wasm memory **15.1 MB**`（上限 32）、**arena 余 8471 KB**、**0/22500** 超预算 | `NEXT-PLAN-2.md` §一 第 35 条 |
| 修复后真判定 | `[bench] PASS — timing judged (cpu probe 1097 µs vs 1600 µs idle, load 1.6 on 8 cpus)`，p50 **1101 µs（41%）** | `docs/notes/band-limited-oscillators.md` §P9.1b |

**硬件**（必须写明）：`docs/notes/compat.md`——「这台机器经常被其它负载占满
（**8 核老 i7**，实测 load 8–13），此时 `bench` 的平均块耗时会是空载的 **3–4 倍**」。

**过采样与图模式的成本增量**（同机、同探针）：

| 场景 | 1× | 2× | 倍数 |
| :-- | --: | --: | --: |
| 16 音密集 patch | 442 µs | 829 µs | **1.9×** |
| 同 patch + 2 s IR | 653 µs | 842 µs | **1.29×** |
| 整链 16 声部（图模式 PDC） | 1099 µs | 1325 µs | **1.21×** |

### 29.7 已知边界

| 边界 | 说明 |
| :-- | :-- |
| **计时判据在本机不可复现** | 已判定为「环境假红，P9.6 无真回归」（`NEXT-PLAN-2.md` §一 第 15 条）：安静窗口两次 bench 都 4/4 judged 且 **0/2250** 超预算 |
| 「timing skipped」应显非绿 | `NEXT-PLAN-2.md` §一 第 15 条列为未做项 |
| `hostLoad()` 的 busy 阈值仍有假红区间 | 已知假红发生在 **load 3.7–4.0**，阈值是 `load1 > 0.5 × cpus = 4.0` |
| `fuzz` 没有负载判据 | 无法判 4000 ms 的富余（§一 第 20 条） |
| p99/worst 不可断言 | 本机 stall 让它们跨 2 个数量级 |

---

## 30. 内容守卫

指纹与 bench 都是**统计/性能**门禁；内容守卫是**语义**门禁：
「这个 patch 还能不能听到、有没有坏值、像不像音乐」。

### 30.1 四个守卫与它们的口径

| 守卫 | 文件 | 检查什么 | 阈值 |
| :-- | :-- | :-- | :-- |
| **全预设静音/非有限扫描** | `src/audio/worklet-processor.test.ts` | 每条工厂预设弹 middle C，统计 `bad`（非有限）与 `silent`（peak < 阈值） | peak **≥ 0.003**；`bad` 与 `silent` 都必须**为空**；超时 **60 s** |
| **展示预设试听** | `src/audio/preset-audition.test.ts` | 10 条展示预设（`semmorph, semparabass, semnotch, crushlead, crushbass, tapecrush, osdrive, osbass, graphpump, graphswell`）：单音与和弦都超地板、无 NaN、无 over-unity、peak ≤ 1.0；**能力开关关掉必须改变渲染** | 单音 peak **≥ `SILENT_PEAK = 0.003`**（「below it a patch is inaudible on a phone speaker」）；和弦 RMS **≥ `SILENT_RMS = 1e-3`（−60 dBFS）**；`maxDifference > 1e-4` |
| **响度均匀性** | `src/audio/preset-loudness.test.ts` | 91 条预设的固定 5 s 乐句 RMS 的 **spread = 最响 − 最静** | **< 9.0 dB** |
| **歌曲质量** | `src/audio/song-quality.test.ts` | 曲目级：peak ≤ 1.0、无 over-unity、大步进、无 NaN、**零分配**、谱平坦度、`maxVoices <= poly`、`silentBlocks > 100` | `nan == 0`、`allocs == 0`、`peak <= 1.0`、`overUnity == 0`、`bigSteps == 0`、`maxStep < STEP_LIMIT = **0.35**`、`flatness < **0.25**`（4096 点 4 项 BH，跳过最低 24 bin） |

**「四个内容守卫 39/39 全绿，spread 8.1 dB」**是 +6 dB 之后的最终状态
（`docs/notes/loudness.md`）。

### 30.2 守卫的真实战绩（**crushbass 案例**，本仓库最好的一个「门禁真的抓到了 bug」故事）

1. **守卫先报警**：`worklet-processor.test.ts` 对 `crushbass` 读到 peak = **0.0020**
   < 门槛 **0.003**。
2. **第一轮根因假设是错的**（父代理猜「trim 太小」，要求抬 `PATCH_GAIN`）；
   子代理用原始输出证明：真因是**湿声路被量化成零**
   （step 0.125 > 信号峰值 ~0.044 ⇒ `round(<0.5) = 0`，
   只剩 `1 − mix = 10%` 干声泄漏 = **0.00195 = 0.1 × 干声**）。
3. **修复必须是 DSP 参数**：`FX_CRUSH_BITS 4 → 6`（step **0.03125**）+ `PATCH_GAIN 0.442 → 0.36`。
4. **为什么不能只抬增益**：跨过 4-bit LSB 需 gain ≈ **1.2–1.5**，
   此时 ±0.125 方波成为输出。（两处笔记给的重录后 spread 数字不同：**9.6 dB** vs **19.8 dB**——
   见 §32；两处都远高于 9.0 的门禁线，所以**结论一致**。）⇒ **4 bit 下两个门禁互斥，6 bit 可同时满足。**
5. **结果**：middle C peak **0.00195 → 0.02258**（守卫门槛的 **7.5 倍**）；
   乐句 **−43.96 → −40.98 dBFS**（库中位 −40.87）；与 `FX_CRUSH_ON 0` 的最大样点差
   **0.0131**（此前 0.0080）；**其余 90 条指纹行级 sha256 前 == 后**。

**和弦门槛因此被提高**：`SILENT_RMS` 从 **1e-4（−80 dBFS）** 提到 **1e-3（−60 dBFS）**——
因为坏版本的**和弦**读 **0.088**（正常！），而**单音**只读 **0.0020**：
「**和弦掩盖了它**」。这是一条重要教训：**守卫信号的复杂度会掩盖缺陷**，
所以既要测单音也要测和弦。

### 30.3 时域守卫：最大相邻步进

见 §2.3。补充门禁里的实际常量：

| 门禁 | 阈值 | 实测 |
| :-- | :-- | :-- |
| `song-quality` `STEP_LIMIT` | **0.35** | 理由注释：「A 3 kHz sine at 0.5 amplitude steps by ~0.2 between samples」 |
| `verify-audio` 点击检测 | `idealStep = (2π·f0/SR) × peak`，允许 **×2** | 正控注入可使 1 个块超限 |
| `P96_STEP_RATIO`（P9.6 场景） | **1.10 × peak** | 0.2123（peak 0.2319） |
| `HARD_SYNC_STEP_RATIO` | **1.8 × peak** | 0.2588（peak 0.2710） |
| 过采样开关急变 | **< 0.25**（P6.5 场景） | — |

**「正控（positive control）」是本仓库的强制纪律**：每个时域门禁都要
**人为注入一个已知缺陷并断言门禁报警**。原文：

> **A gate that cannot fail is not a gate.**
> （`scripts/verify-audio.mjs`，注入「每块第一个样本 ×0.2」）

其它正控例子：

| 场景 | 注入 | 结果 |
| :-- | :-- | :-- |
| 点击检测 | 每块起点 ×0.2 | `brokenOver > 0` ✓ |
| 带限波表 | 打一个 **+1.0** 采样 | 步进 **1.078 > 0.289**（π×峰值）✓ |
| P9.6 相位 | 改回旧分支 | `phase 707 reads −44.8 dB` + FAIL；改回 → **−112.4 dB** + PASS |
| 波表门禁 | 回退短表 | **11 条红** |
| P9.8 采样 | 回退核表最后一行 | 1047 Hz **−54.7**（顶棚 −81）红 |
| 视觉回归 | `.take-chip` 改 `#ff00ff` | 桌面 **2262 px（ratio 0.06）**、手机 **3104 px（0.09）** 红 |
| fps 守卫 | `FPS_FLOOR` 临时改 999 | 三条全红 |
| 教学评分 | 去掉音高判断 | **4 条红**；音准权重置零 → **2 条红** |

### 30.4 已知边界

| 边界 | 说明 |
| :-- | :-- |
| `SILENT_PEAK = 0.003` 是经验阈值 | 注释给的理由是「below it a patch is inaudible on a phone speaker」（**主观标定，非测量**） |
| spread < 9.0 是**统计**判据 | 它保证「没有预设特别响/特别静」，**不保证每个预设都好听** |
| 守卫信号会掩盖缺陷 | 见 §30.2（和弦掩盖了 crushbass） |
| 内容守卫**不覆盖**图模式的组合爆炸 | 91 条预设 + 10 条展示预设是采样，不是穷举 |

---

## 31. 为什么只能同机同探针 A/B

### 31.1 四条实测出来的理由

**(a) 宿主负载可以造成 2–3 倍的差异。** 这是最硬的一条：

> **导入绝对数字对宿主负载非常敏感，只能同探针同机 A/B，不要跨批次引用。**
> 本表 1A/1C 两列是背靠背测的（同一天、同一探针、best-of-3），方向可信；
> 单独出现的数字（例如 P9.7 时期记下的 **273.9 ms**、或本批早些时候的 **26.4 ms**）
> 在别的负载下会差 **2–3 倍**，不能当基准。
> （`docs/notes/band-limited-oscillators.md`）

同一条纪律的第二次表述（`docs/NEXT-PLAN-2.md` §一 第 29 条）：
「P9.8 文档钉的 **273.9 ms** 与同机实测的 **157.6 ms** 差 **1.74×**……
**以后导入耗时一律用「同机同探针的改前/改后」口径，不要跨会话比**。」

注意这里的关键：**同一批里 32768 点与 1 s 的导入时间只差 1–2%**，
说明那几个数字本身是稳定的；**差的是跨会话的那一个**。
所以「不准」不在测量方法，而在**测量时刻的宿主状态**。

**(b) JIT / 预热必须排除。** `bench` 预热 **60 块**，
`verify-audio` CPU 段同样 **60 块**且用 **best of five rounds of 200 blocks**
（「the minimum is the stable estimator」）；`render(blocks, skip)` 默认跳过 **20** 块。
一个更细的例子：EQ 段用 `render(220, 120)` = **320 ms** 预热而非 100 ms，
因为「pitch is a *smoothed* parameter… it read **4.7 dB instead of 9** on the high shelf」；
瞬态整形段有 16 块 = **43 ms** 的「five time constants」静默。

**(c) 不同构建（host vs wasm）不是同一个数。** 见 §0.2：
同一份源码、同一场景，2× 的非谐波能量在 wasm 门禁读 **−59.5 dB**、
在 host `cargo test` 读 **−43.6 dB**（差 **16 dB**）。
所以 **12 dB 的硬线由 wasm 门禁持有**，Rust 单测只钉方向（≥8 dB）。
这不是「一个对一个错」，而是**两个探针测的不是同一件事**。

**(d) 同一进程内，门禁各 section 之间有顺序依赖。** 这是最容易被忽略的一条
（见 §31.2）。

### 31.2 顺序依赖：`gs_init` 不复位的三样东西

`verify-audio.mjs` 的注释把这件事写得很清楚：

> `gs_init` keeps the parameter block *and* the modulation matrix, so an **unset pitch or noise
> amount is the previous scenario's** — which is how the **hard-sync section was silent the first
> few times it ran**, and why P6.3a measured the default patch's ENV → CUTOFF instead of its filter.

所以门禁自己有**三层防御**：

1. `engine()` 每次先 `ENV_RELEASE = 0.005`、关混响/延迟、`gs_all_notes_off()`，
   再跑 **80 块**让尾音死掉；
2. `QUIET_PATCH` / `aliasBase` 这类**把整个参数块钉死**的夹具；
   `clearModMatrix()` 把 8 条路由清零；
3. **把敏感 section 放在最后**：
   - P6.5 / 2× 段「**sits last and restores the parameter block on the way out**」；
   - P9.1a 段「**sits last on purpose**: it re-pins the whole parameter block,
     and the hard-sync scene above is sensitive to what it inherits」；
   - P9.6 段「**rides on 4b's voice-phase counter**: `gs_init` does not reset it,
     so it still sits last among the note-starting scenarios」；
   - 结尾的结论「**comes last on purpose**: every section above reports into `report`,
     and one added at the end of the file would otherwise report into nothing」。

**相位计数器不复位是门禁的依赖，不是缺陷**：
`noteOns` 计数器存在的原因就是「第 N 次 note-on 的初相永远相同」，
P9.6 因此能把相位**钉成绝对种子 707**。

**跨实例不可比的一个实测证据**（这条最能说明「同一次运行内比较」的必要性）：

> 同一 patch 渲染两次（1×）的互相关峰在 **lag 167**、`|corr| 0.9988`，
> 而在 **lag 0 只有 −0.529**。

所以所有时域比较都在**一次 note 内的两个窗口**做（§4.5 的 `graphDelayProbe`）。
Rust rig 因为每次新建 `Engine`（相位从同一初值开始）而可以直接测，
「reads **0.998292 at exactly the reported 62**」。

### 31.3 已修的顺序缺陷（**纪律级教训**）

`npm run verify` 与 CI 都把 `npm test` 排在 `build` **之前**，
而 `src/generated/*.wasm` 是 **gitignore 的构建产物** ⇒ **干净 worktree / 新 runner 必红**：

> 自证：删掉 wasm 后「先测」= **7/26 文件红**；「先 build」= **26 文件 / 163 用例全绿**。
> 修复提交 **`0a5aca3`**。

**这个缺陷的性质值得单独说**：它不是 DSP 错误，而是**门禁的依赖顺序错误**。
它会让「新环境第一次跑必红」——最容易被误读成「代码坏了」的那类假红。
修法是**对调 verify 链与 CI 步骤顺序**，而不是加容错。

**另一条同源的缺陷**（fps 守卫）：
它原本是 141 条 E2E 套件里的**第 77 条**，其它 worker 压满 8 核 ⇒
`playback` best-of-5 读到 `[16.3, 22.5, 18.8, 18.8, 18.8]`，
v1.111.0 发布被 `20.0 fps of [17.5, 16.3, 20.0, 15.0, 13.8]` 挡下，
而**同代码单跑 60.0 fps**。修法是**隔离**（`perf` project + `--workers=1`），
**一个阈值都没动**：

> 改阈值要另开批次并说明原因。

**同一现象的第三次出现**：`release.mjs` 的 `git checkout -- package.json`（v1.108.0）
导致 `npm run verify` **静默跳过 2× 预设指纹门禁**，
而 `verify-ci` 当时仍报 `[ci] PASS`——因为它**只查 CI 文本里有没有那个命令，
不查 npm script 是否存在**。修法是把判据升级为
「**工作流文本有 ∧ `package.json` scripts 真有 ∧ `verify` 链点名**」。

**这三条合起来是一条可迁移的原则**：
**门禁的「存在」和门禁的「被执行」是两件事，两者都要有独立的检查。**

### 31.4 视觉与平台层：同一台机器同一浏览器

`docs/notes/visual-regression.md`：

> **同一台机器、同一个 Chromium**，渲染是确定的，所以阈值可以收得很紧。

本仓库因此把阈值收到 Playwright 默认（0.25 / 0.03）之外的 **0.01 像素占比 + 0.05 单像素色距**。
标定证据：`--accent: #ffb340 → #ffb350`（单通道 16/255，约 6%）在**默认阈值下 5 passed（漏掉）**，
在新阈值下失败（浅色桌面启动页 **52585 px，ratio 0.05**）。
代价是**基线不可跨平台**：「文字栅格化是**这台机器的字体栈**的属性，
CachyOS 基线不能判 Ubuntu runner」——所以 48 张基线**不进 CI**。

`docs/notes/compat.md` 给了跨平台测量的一条更强的版本：

> **任何「本机没有 GPU / 只有软件渲染」的结论，都必须写成「本会话的沙箱里看不到 `/dev/dri`」。**

也就是说：**不要把「我这次运行观察到的情况」升级成「这台机器的属性」**。
这条纪律在 E2E 上被违反过两次（headless WebKit 的 rAF、
跨引擎点击目标），两次都在笔记里被显式更正（正文写「**是错的**」）。

### 31.5 结论：一份可迁移的测量清单

写任何 DSP 门禁时，按顺序问这七个问题：

1. **尺子的下限是多少？** （旁瓣/泄漏 → 它不能验证比这更低的指标）
2. **我是测绝对量还是相对量？** （相对量可以用便宜的尺子）
3. **有第二把独立尺子吗？** （不同窗/不同算法 → 失效模式不重叠）
4. **门禁能失败吗？** （正控：注入已知缺陷）
5. **被测信号是「已 settle、无调制」的吗？** （清调制矩阵、跳过瞬态）
6. **这个数字与上次那个数字可比吗？** （同机？同探针？同构建？同负载？）
7. **门禁真的被执行了吗？** （存在 ≠ 运行；被跳过要显式报出来）

---

## 32. 本文档发现的既有文档 / 代码不一致

> 这些**不是**本文档的猜测，而是写文档时逐项对照源码、笔记与基线后发现的**现存差异**。
> 按「是否需要改动产品代码」分级。**本文档不改任何代码**，只记录。

### 32.1 ⚠️ 需要产品决策：AudioParam 量程与引擎线格式枚举**不一致**

**发现**：`src/audio/worklet-processor.js` 的 AudioParam 表（`PARAMS`，200 项）
给出的量程**窄于**引擎接受的线格式枚举：

| AudioParam 名 | id | 描述符量程 | 引擎枚举实际接受 | 被挡掉的值 |
| :-- | --: | :-- | :-- | :-- |
| `osc1Wave` | 2 | **0..7** | `Wave::from_u32` 0..**9** | **8 = wavetable、9 = sample** |
| `osc2Wave` | 8 | **0..7** | 同上 | 同上 |
| `filterType` | 13 | **0..3** | `FilterType::from_u32` 0..**6** | **4 = comb、5 = formant、6 = sem** |

**机制**：`src/audio/engine.ts` 的 `setParam` **显式**按 AudioParam 量程钳位：

```ts
const param = this.node.parameters.get(name);
const v = clamp(value, param.minValue, param.maxValue);   // ← 这里把 8 夹成 7、把 6 夹成 3
```

而 `store.setParam(id, value)` → `engine.setParam(id, value)` 是**实例 A 的唯一路径**
（实例 B 走 `paramB` 消息，不经 AudioParam）。

**为什么现有门禁抓不到它**（三处盲区）：

| 门禁 | 为什么绕过 |
| :-- | :-- |
| `scripts/verify-presets.mjs` / `preset-loudness.test.ts` | 直接调 `gs_set_param`，**不走 AudioParam** |
| `scripts/verify-audio.mjs` | 同上（`ex.gs_set_param`） |
| `src/audio/worklet-processor.test.ts` | 把 `osc1Wave: 8` **直接写进 mock 的 `parameters` 记录**（见该文件 `imports a single cycle and plays it as the wavetable`），因此**同时绕过** `engine.ts` 的钳位与浏览器的钳位 |

也就是说：**核心（wasm）能正确处理 wave 8/9 与 filter 4/5/6，但产品路径送不到**。

**受影响的工厂预设**（从 `src/state/presets.ts` 解析）：
`wtorgan` / `wtvocal` / `wtglass` / `wtmetal` 等写 `OSC1_WAVE = 8`；
`semmorph` / `semparabass` / `semnotch` 与名为 `formant` 的预设写 `FILTER_TYPE` ≥ 4。

**未验证的部分（诚实声明）**：我**没有**在浏览器里实测听感后果
（本任务不需要跑 E2E/浏览器门禁）。因此：

- **已确认（纯代码级，不依赖浏览器）**：`src/audio/engine.ts` 的 `setParam`
  在把值交给 AudioParam **之前**就用 `clamp(value, param.minValue, param.maxValue)` 钳位；
  而 `param.minValue/maxValue` 来自 `worklet-processor.js` 的 `parameterDescriptors`，
  即上表的 0..7 / 0..3。**这一步与浏览器行为无关**，是产品代码里的显式钳位。
  同时我逐处确认了**不存在第二条发送路径**（实例 A 只经 `AudioParam`；
  实例 B 走 `paramB` 消息，不经 AudioParam；worklet 的 `handleMessage` switch 里没有
  「直接设参」的 type）。
- **未验证（需要浏览器）**：实际听感后果。若钳位生效，`wtorgan` 的
  `osc1Wave = 8` 会变成 **7 = brown noise**，`semmorph` 的 `filterType = 6` 会变成 **3 = notch**。
  另外我也**没有**独立核实「浏览器是否还会再钳一次」这一层——
  但上面的显式 JS 钳位已经足以让值到不了 8/9 与 4/5/6。
- **建议的验证方式**：在浏览器里读回 `node.parameters.get('osc1Wave').value`，
  或用一条把 `OSC1_WAVE` 设为 8 的 patch 看频谱仪是否呈现 wavetable 的谐波结构。
- **推测的修法方向**（**不由本文档实施**）：把 `PARAMS` 表里这三项的 `maxValue`
  放宽到枚举上界（7→9、3→6）；或为「超出 AudioParam 量程的离散参数」加一条消息路径
  （与实例 B 的 `paramB` 同形）。

### 32.2 注释/文档与代码不一致（**不影响行为**，但会误导读者）

| # | 位置 | 不一致 |
| --: | :-- | :-- |
| 1 | `crates/synth-core/src/engine.rs` 测试模块注释 | 写「the graph's 2x node path is **held \*off\*: measured through the real wasm it degrades rather than improves** … so the graph still renders at 1x」，但 `node_oversampled(kind) = matches!(kind, FxKind::Drive)`、渲染路径走 `drive_oversampled_node`，且有断言「图 2× 使 alias floor 下降 ≥12 dB」的测试。**功能状态是「开（`OVERSAMPLE` 开时）」，注释陈旧** |
| 2 | `docs/notes/wasm-ladder-root-cause.md` 第 3 行 | 写「Scope: research only; **shipped DSP is unchanged**」，但同日提交 `a153d24` 已实施 root fix（去掉 NSDMI）并加 `verify-wasm.mjs` 门禁 |
| 3 | `crates/synth-core/src/dsp/ladder.rs` `PASSBAND_TRIM` 注释 | 常数是 **1.0**，注释描述的是被替换的 vendored 版本「a 0.5 passband gain … about **4 dB** below unity」。（$20\log_{10}0.5 = -6.02$ dB；注释的「~4 dB」与「0.5」不相符。）**写文档时以常数 1.0 为准** |
| 4 | `scripts/verify-presets.mjs` 文档串 | 写「**eighty** factory presets」，当前是 **91** |
| 5 | `src/audio/preset-loudness.test.ts` 注释 | 写「Achieved **6.0 dB** (was **47**)」，而 +6 dB 之后 `docs/notes/loudness.md` 记录的实测 spread 是 **8.1 dB**（门禁仍 <9.0）。该注释是更早时期的记录 |
| 6 | `src/audio/worklet-processor.js` 文件头 | 写「Keep in sync with `src/audio/params.ts` (id) and **`src/params.rs`**」，正确路径是 `crates/synth-core/src/params.rs` |
| 7 | `docs/notes/oversampling.md` / `hard-sync-aliasing.md` | 仍引用 `81 presets unchanged` 与旧 rms（`0.030806` / `0.030735` / `0.030852`）。这些是**历史快照**，当前是 **91 条**与 `0.061470` / `0.061703` |
| 8 | `docs/NEXT-PLAN-2.md` §一 | 同一份清单里同时出现「81 指纹」与「91 指纹」、「`rms 0.030806`」与「`0.030735`」——因为它们记录的是**不同批次时刻**的值 |

### 32.3 口径不同的数字（**两处都对，但语境不同**）

| 量 | 版本 A | 版本 B | 说明 |
| :-- | :-- | :-- | :-- |
| 相位表漏行的代价 | `sampler.rs` 注释：**30 dB** | `docs/notes/band-limited-oscillators.md` / `NEXT-PLAN-2.md`：**31 dB** | 源码的 30 dB 是取整；笔记的 31 dB 是与实测劣化对齐后的表述。**正文我两处都标注了** |
| `crushbass` 只抬 `PATCH_GAIN` 的 spread | `p122-presets.md`：**9.6 dB** | `NEXT-PLAN-2.md`：**19.8 dB** | 两次实验的条件（是否同时改别的参数）可能不同；**结论一致：都远高于 9.0 的门禁线** |
| +6 dB 后库中位 RMS | `NEXT-PLAN-2.md` / `engine.rs` 注释：**−34.04 dBFS** | `loudness.md` §3 表与 recheck 日志：**−34.03 dBFS** | 0.01 dB 舍入差 |
| P9.7 波表「最差工厂 bank」 | `wavetable.rs` 注释：**−105 dB** | 门禁笔记实测最差：**−98.0 dB**（glass @1047 Hz） | 可能是**不同的音符集/口径**；我**没有**逐条对齐，因此正文引用时**分别标注了出处** |
| `LIMIT_PEAK_HOLD_S` | 常数 **0.05 s** | 同一文件的循环内注释：「**~60 ms** hold-and-decay」 | 50 ms 保持 + 指数衰减，笼统称 60 ms |
| `verify-audio.mjs` 的 bin 宽度 | 注释：「At four seconds a bin is **0.25 Hz**」 | 零填充后的 FFT bin 是 $48000/262144 \approx$ **0.183 Hz** | 0.25 Hz 是 **1/4 s 的原始分辨率**，注释在讲窗主瓣宽度时用它是正确的；但**两个「bin」不是同一个 bin**，容易被误读 |
| Hann 窗旁瓣 | `spectrum()` 注释：**−46 dB**（a few bins away） | 硬同步/2× 段注释：**−95 dB** | 描述的是**近旁瓣 vs 远旁瓣 / 不同距离**，不是同一个量 |
| **采样 mip 级长的公式** | `sampler.rs`：一般式 `SR / 2^(1 + log2(1/LEVEL_NYQUIST) − k)`，并断言等于 **`SR / 2^(k+1)`** | `band-limited-oscillators.md`：**`SR / 2^(k-1)`** | 代入 `LEVEL_NYQUIST = 0.25` 得 `SR / 2^(3−k)`；三个写法只在 k=1 或 k=2 个别情形相等。**我没有独立推导判定哪个正确**，因此 §15.3 **不给出确定公式**，只给设计意图与实测结果 |

### 32.4 文件存在性

| 项 | 说明 |
| :-- | :-- |
| `docs/notes/p12-presets.md` | **不存在**。目录里只有 `p122-presets.md`（本任务书曾按 `p12-presets.md` 指路） |
| `docs/notes/wasm-ladder-repro/` | 存在（`README.md` 27 行、`build.sh` 56、`repro.cpp` 71、`run.mjs` 47、`.gitignore` 4） |
| 底层测量报告 | 存在于 `.tmp/`（例如 `.tmp/wt-loudness/.tmp/loudness-report.md` 263 行、`.tmp/hard-sync-drift.md`）——**不进版本库**，所以只作为历史引用 |

### 32.5 一个跨文档的方法论差异（**不是错误，但必须知道**）

`docs/notes/oversampling.md` 与 `docs/notes/hard-sync-aliasing.md` 记录的是
**当时的 81 条预设指纹与旧 rms**；而 `tests/preset-fingerprint.json` 是**当前值**。
两者都正确，但**混用会得出错误结论**。

本文档的处置：凡引用旧数字，都标注「历史」并给出当前值（见 §28.2 的三代 rms 表、
§28.3 的 81→91 说明）。

---

# 附录 A · 中英术语对照表

> 说明：**含义列**给的是本仓库语境下的具体含义（可能比通用定义更窄）。
> 「出处」列给本文中最有信息量的位置或源码符号。

| # | 中文 | English | 含义（本仓库语境） | 出处 |
| --: | :-- | :-- | :-- | :-- |
| 1 | 采样率 | sample rate ($f_s$) | 引擎按宿主采样率运行；门禁统一 48000 Hz | `verify-audio.mjs` `SR` |
| 2 | 奈奎斯特频率 | Nyquist frequency | $f_s/2$ = 24 kHz @48 kHz | §1.1 |
| 3 | 奈奎斯特–香农采样定理 | Nyquist–Shannon sampling theorem | 带宽 < $f_s/2$ 时采样不丢信息 | §1.1 |
| 4 | 混叠 | aliasing | $f > f_s/2$ 的分量折回基带 | §1.2 |
| 5 | 折回公式 | fold-back / alias formula | $f_{\text{alias}} = \lvert f - k f_s \rvert$ | §1.2 |
| 6 | 量化 | quantization | 幅度映射到有限电平；step $= 2/2^{b}$ | `fx_shaping.rs` |
| 7 | 量化步长 | quantization step size | 位粉碎器：4 bit ⇒ 0.125 | §22.1 |
| 8 | 抖动 | dither | 本仓库只用 ±1e-15 交替抖动**防 denormal** | `engine.rs` |
| 9 | 非规格化数 | denormal / subnormal | wasm **无 flush-to-zero**，衰减尾会贵 100× | `engine.rs` |
| 10 | 分贝 | decibel (dB) | 幅度比 $20\log_{10}$ | §1.4 |
| 11 | 满刻度相对电平 | dBFS | 0 dBFS = \|x\| = 1 | §1.4 |
| 12 | 浮点单精度 | f32 | 音频采样值、查找表 | §1.5 |
| 13 | 浮点双精度 | f64 | 相位/位置累加器、分析路径 FFT | §1.5 |
| 14 | 有效位最后一位 | ULP (unit in the last place) | 采样器位置在 192000 处 ULP ≈ **1.5e-2** 采样 | `sampler.rs` |
| 15 | 边带 | sideband | f32 读位置误差按 loop 重复率形成的谱线族 | §1.5 |
| 16 | 真峰值 | true peak / inter-sample peak | 本仓库用**相邻样本均值**估计（非 ITU 标准） | `engine.rs` |
| 17 | 峰值 | peak | $\max\lvert x\rvert$ | `simd::peak` |
| 18 | 均方根 | RMS | $\sqrt{\text{mean}(x^2)}$；感知响度的**廉价替身** | `preset-loudness.test.ts` |
| 19 | 波峰因数 | crest factor | peak/RMS；本仓库**不做**独立指标 | §2.1 |
| 20 | 包络 | envelope | 幅度的慢变轮廓 | §2.2 |
| 21 | 包络跟随器 | envelope follower | 瞬态整形用它构造「瞬态」 | `fx_shaping.rs` |
| 22 | 一阶滤波器 / 单极点 | one-pole filter | `y += α(x−y)`，`α = 1 − e^{−Δt/τ}` | §2.2 |
| 23 | 时间常数 | time constant (τ) | `SMOOTH_TAU_S = 0.02`（约 20 ms） | `engine.rs` |
| 24 | 最大相邻步进 | maximum adjacent step | 门禁用它抓「每块丢一个样本」类缺陷 | §2.3 |
| 25 | Bernstein 上界 | Bernstein bound | $\lvert x'\rvert \le 2\pi f_{\text{top}} P$ ⇒ 门禁的 `π × peak` | §2.3 |
| 26 | 离散傅里叶变换 | DFT | $X[k] = \sum x[n]e^{-j2\pi kn/N}$ | §3.1 |
| 27 | 快速傅里叶变换 | FFT | radix-2，$N$ 必须是 2 的幂 | §3.1 |
| 28 | 窗函数 | window function | 矩形 / Hann / 4 项 BH / **7 项 BH** / Blackman / Kaiser | §3.2 |
| 29 | 矩形窗 | rectangular window | 无窗；旁瓣按 **1/bin** 衰减 | §3.2 |
| 30 | 汉恩窗 | Hann window | 频谱仪与单频探针；旁瓣约 −46/−95 dB | §3.2 |
| 31 | 布莱克曼–哈里斯窗 | Blackman-Harris window | 4 项用于生成核，**7 项只用于测量** | §3.2 |
| 32 | 凯泽窗 | Kaiser window | 硬同步 95 抽头（β=6）、过采样 63 抽头（β=8） | §4.3/§4.4 |
| 33 | 频谱泄漏 | spectral leakage | 非整周期信号的 bin 间能量散布 | §3.3 |
| 34 | 旁瓣 | sidelobe | 决定测量的**下限** | §3.3 |
| 35 | bin 分辨率 | bin spacing | $\Delta f = f_s/N$；4 s ⇒ 0.25 Hz | §3.3 |
| 36 | 主瓣 | main lobe | 4 s + BH-7 ⇒ ±1.75 Hz（8 bin 覆盖） | §26.2 |
| 37 | 精确 bin | exact bin | 信号整周期 ⇒ 谐波落 bin 中心 ⇒ 矩形窗无泄漏 | §3.4 |
| 38 | 帕塞瓦尔定理 | Parseval's theorem | 时域能量 = 频域能量；用于「非谐波能量」 | §3.5 |
| 39 | 离网能量 / 非谐波能量 | off-grid / non-harmonic energy | 主尺子的输出量 | §3.5 |
| 40 | 谐波栅格 | harmonic grid | $k f_0$；折回线**不落**在它上面 | §3.5 |
| 41 | 总谐波失真 | THD | 门禁：滤波器驱动开满时 **< 6%** | §3.6 |
| 42 | 总谐波失真加噪声 | THD+N | 本仓库门禁主要用 THD 与「非谐波能量」 | §3.6 |
| 43 | 互调失真 | IMD | **未实现门禁** | §3.6 |
| 44 | 插值 | interpolation | 读非整数位置 | §4.1 |
| 45 | 最近邻插值 | nearest-neighbour | 实测 **−10.4 dB** | §4.1 |
| 46 | 线性插值 | linear interpolation | 实测 **−24.4 dB**；弦误差按 $1/N^2$ | §4.1 |
| 47 | 三次拉格朗日插值 | cubic Lagrange | 4 点；ν=1/4 处只 **−34 dB** | §4.1 |
| 48 | 窗 sinc 插值 | windowed-sinc interpolation | 16 抽头 4 项 BH；ν=1/4 处 **−86 dB** | §4.1 |
| 49 | 相位表 | phase table | 1024 相位 + 1 行（**1051 行**是 bug 的来源） | §16.4/§32 |
| 50 | 弦误差 | chord error | 折线逼近带限信号的误差 | §4.2 |
| 51 | 1/N² 律 | 1/N² law | 线性插值误差每倍长降 ~12 dB（**有失效条件**） | §4.2 |
| 52 | 带限 | band-limiting | 只保留 Nyquist 以下的谐波 | §1.1 |
| 53 | 阶跃带限修正 | BLEP (band-limited step) | 修正值跳变 | §4.3 |
| 54 | 斜坡带限修正 | BLAMP (band-limited ramp) | 修正斜率折点（BLAMP = BLEP 的积分） | §4.3 |
| 55 | 过采样 | oversampling | 2×；参数 `OVERSAMPLE` id 166 | §4.4 |
| 56 | 抽取 | decimation | 低通后隔点取样 | §4.4 |
| 57 | 插值（上采样） | interpolation (upsampling) | 零填充 + 低通，增益 = 2 | §4.4 |
| 58 | 阻带 | stopband | 过采样原型：24.2 kHz 处 −97 dB | §4.4 |
| 59 | 过渡带 | transition band | 过采样 21 kHz −12 dB | §4.4 |
| 60 | 半带滤波器 | half-band filter | **没有保护带**——第一个尝试被否掉 | §4.4 |
| 61 | 保护带 | guard band | 压低截止换来的余量 | §4.4 |
| 62 | 延迟补偿 | PDC (plugin delay compensation) | 逐节点/逐边；见 §4.5 的公式 | §4.5 |
| 63 | 群延迟 | group delay | 线性相位 FIR = (N−1)/2 | §5.6 |
| 64 | 线性相位 | linear phase | 对称 FIR ⇒ 常数群延迟 | §5.6 |
| 65 | 因果性 | causality | 零延迟需要非因果滤波器 ⇒ `OS_LATENCY` 是代价 | §4.4 |
| 66 | 梳状滤波 | comb filtering | 并行支路错位混合的后果 | §4.5 |
| 67 | mipmap / mip 链 | mipmap / mip chain | 分级带限表；波表 9 级全长、采样 9 级按带宽定长 | §4.6 |
| 68 | 单周期波形 | single cycle waveform | 导入路径 `Table::from_cycle` | §14.4 |
| 69 | 谐波配方 | harmonic recipe | 出厂表的 5 个 recipe | §10.2 |
| 70 | 双二阶滤波器 | biquad | RBJ cookbook，direct form II transposed | §5.1 |
| 71 | 低架滤波器 | low shelf | EQ 第一段 | §22.2 |
| 72 | 峰值滤波器 | peaking filter | EQ 中段（sweepable mid） | §22.2 |
| 73 | 高架滤波器 | high shelf | EQ 第三段 | §22.2 |
| 74 | 阶梯滤波器 | ladder filter | Moog 风格 4 极 24 dB/oct | §5.2 |
| 75 | 零延迟反馈 | ZDF (zero-delay feedback) | 解环而不是反馈上一样本 | §5.2 |
| 76 | 拓扑保持变换 | TPT (topology-preserving transform) | `g = w/(1+w)`，`z_new = 2y − z_old` | §5.2 |
| 77 | 状态变量滤波器 | SVF (state variable filter) | 12 dB/oct，LP/BP/HP/notch 同时输出 | §5.3 |
| 78 | 连续多模 | SEM-style continuous multimode | `FILTER_MORPH` 0→1/3→2/3→1 | §17.4 |
| 79 | 双采样 | double sampled | DaisySP SVF 每样本跑两遍 | §17.4 |
| 80 | 全通滤波器 | allpass filter | 相位器的核心级联 | §8.3 |
| 81 | 共振 | resonance | ladder：`res × 3.9` 反馈；矩阵可推到 2 倍 | §5.5 |
| 82 | 自激 | self-oscillation | ladder 靠反馈路径内饱和限住 | §5.5 |
| 83 | 元音滤波 | formant filter | 三并联带通，cutoff 对数映射 A–U | §5.4 |
| 84 | 梳状共振器 | comb resonator / tuned comb | `FilterType::Comb`，每声部一条延迟线 | §5.4 |
| 85 | 直流阻断 | DC blocking | comb/formant 后的 `gs_voice_dc_block` | §5.4 |
| 86 | 饱和 | saturation | 传递函数在大信号处压缩 | §6.1 |
| 87 | 硬削波 | hard clipping | 本仓库避免；只在极端素材出现 | §6.1 |
| 88 | 软削波 | soft clipping | `soft_limit`（膝 0.82）/ ladder 输出（膝 0.7） | §6.1 |
| 89 | 膝点 | knee | 线性区与压缩区的分界（**绝对电平**） | §6.1/§6.4 |
| 90 | 波形整形 | waveshaping | DRIVE；**无记忆** ⇒ 必须过采样 | §9.2 |
| 91 | 限幅器 | limiter | 压缩比无穷大 | §6.2 |
| 92 | 前瞻 | lookahead | 延迟信号 128 样本以先看到峰值 | §6.2 |
| 93 | 天花板 | ceiling | `LIMIT_CEILING = 0.95`（绝对电平） | §6.2 |
| 94 | 峰值保持 | peak hold | `LIMIT_PEAK_HOLD_S = 0.05` | §6.3 |
| 95 | 释放时间 | release time | `LIMIT_RELEASE_S = 0.15`；包络用 `exp(−6/t·sr)` | §6.3 |
| 96 | 增益衰减 | gain reduction | `gs_limit_reduction()` 返回**线性增益**（1.0 = 无） | §23.3 |
| 97 | 检波器 | detector | 峰值/包络检波 | §2.2 |
| 98 | 包络发生器 | ADSR envelope | 线性 attack + 单极点 decay/release | §7.1 |
| 99 | 低频振荡器 | LFO | 两个全局 LFO；0.02..40 Hz | §7.2 |
| 100 | 单次模式 | one-shot (LFO/envelope) | 跑一个周期后停在末值 | §7.2 |
| 101 | 重触发 | retrigger | 每个新音符重启相位 | §7.2 |
| 102 | 调制矩阵 | modulation matrix | 8 条路由，**每声部** | §7.3 |
| 103 | 调制总线 | modulation bus | 图内 4 条边 / 覆盖槽 8 个槽，**总线级** | §7.3 |
| 104 | 调制源 / 目标 / 深度 | mod source / destination / depth | 源 8 种、目标 8 种、深度 −1..1 | §7.3 |
| 105 | 总线级跟随器 | bus-level follower | 图内包络源取「所有发声 voice 的最大 env」 | §18.4 |
| 106 | 控制率 | control rate / k-rate | 宿主每块推一次参数 | §7.4 |
| 107 | 块率 | block rate | 128..1024 帧一次 | §7.4 |
| 108 | 音频率 | audio rate | 每样本 | §7.4 |
| 109 | 拉链噪声 | zipper noise | 参数跳变造成的宽带脉冲 | §7.4 |
| 110 | 参数平滑 | parameter smoothing | 一阶低通，`SMOOTH_TAU_S` | §7.4 |
| 111 | 连续 / 离散参数 | continuous / stepped parameter | `is_continuous` 分类 | §7.4 |
| 112 | 延迟线 | delay line | 环形缓冲 | §8.1 |
| 113 | 反馈 | feedback | 延迟反馈钳 0..0.95 | §8.1 |
| 114 | 分数延迟读 | fractional delay read | 线性插值读非整数位置 | §8.1 |
| 115 | 乒乓延迟 | ping-pong delay | 输入先求和到单声道，再交叉馈送 | §8.1 |
| 116 | 阻尼 | damping | 反馈环内的一阶低通 | §8.1 |
| 117 | 预延迟 | pre-delay | 混响的 0..0.1 s 前置延迟 | §8.2 |
| 118 | 算法混响 | algorithmic reverb | Freeverb 拓扑：8 梳状 + 4 全通/声道 | §8.2 |
| 119 | 卷积混响 | convolution reverb | 分区频域卷积 | §8.2 |
| 120 | 脉冲响应 | IR (impulse response) | 最长 2.05 s（96 × 1024 样本） | §8.2 |
| 121 | 分区卷积 | partitioned convolution | `HOP = 1024`、`FFT_SIZE = 2048` | §8.2 |
| 122 | 频域延迟线 | FDL (frequency-domain delay line) | 每节点独立，不共享尾巴 | §8.2 |
| 123 | 重叠保留法 | overlap-save | 分区卷积的实现范式 | §8.2 |
| 124 | 能量归一化 | unit-energy normalisation | 让不同长度的 IR 湿声电平可比 | §8.2 |
| 125 | 工作分摊 | work spreading | 分区工作切 8 片；门禁 `spread < 1.35` | §20.2 |
| 126 | 合唱 | chorus | 多个微失谐延迟拷贝 | §8.3 |
| 127 | 镶边 | flanger | 单个短延迟 + 反馈 ⇒ 移动梳状 | §8.3 |
| 128 | 相位器 | phaser | 级联全通 ⇒ 移动相位零点 | §8.3 |
| 129 | 插入 / 发送 | insert / send | `can_be_parallel` 决定哪些可作 send | §20.3 |
| 130 | 位粉碎 | bit-crush | 量化 + 降采样 + 抗混叠 | §9.1 |
| 131 | 采样保持 | sample and hold | 降采样除数 `FX_CRUSH_DOWN` 1..64 | §9.1 |
| 132 | 抗混叠量 | anti-alias amount | `FX_CRUSH_AA` 0..1；前后各两级一阶低通 | §9.1 |
| 133 | 驱动 / 过载 | drive / overdrive | 唯一被判定必须 2× 的效果 | §9.2 |
| 134 | 瞬态整形 | transient shaping | 快/慢包络之差驱动有符号增益 | §9.3 |
| 135 | 整流平滑 | rectifier smoothing | `RECT_HZ = 200`（高于所有载频） | §9.3 |
| 136 | 减性合成 | subtractive synthesis | 本机主线架构 | §10.1 |
| 137 | 波表合成 | wavetable synthesis | 用 mipmap 分级带限 | §10.2 |
| 138 | 硬同步 | hard sync | 主振回绕重启从振；BLEP/BLAMP 就地修正 | §10.3 |
| 139 | 相位调制 / 频率调制 | phase / frequency modulation | 本仓库用**相位**调制（相位「放置」而非累加） | §10.4 |
| 140 | 调制指数 | modulation index | `FM_MAX_CYCLES = 2.0` 个载波周期，`depth²` 曲线 | §10.4 |
| 141 | 环形调制 | ring modulation | 两块相乘，作用于所有波形 | §10.6 |
| 142 | 采样器 | sampler | `rate = note / root`，需 mipmap | §10.5 |
| 143 | 根音 | root note | `SMP_ROOT`（MIDI 音符，非频率） | §10.5 |
| 144 | 循环点 | loop points | **归一化 0..1**（保证每级落同一位置） | §10.5 |
| 145 | 单次 / 循环 / 乒乓 | one-shot / loop / ping-pong | `SMP_MODE` 0/1/2 | §10.5 |
| 146 | 复音 | polyphony | `MAX_VOICES = 32`，默认 16 | §10.6 |
| 147 | 齐奏 | unison | 最多 7 个；`1/sqrt(n)` 电平补偿；±35 音分 | §13.3 |
| 148 | 失谐 | detune | 半音/音分为单位 | §13.3 |
| 149 | 语音分配 | voice allocation | 按**空闲槽**而非音符号 | §10.6 |
| 150 | 偷声 | voice stealing | 已释放且安静 > 已释放 > 安静 > 最老 | §10.6 |
| 151 | 弹性复音 | elastic polyphony | `force_release_excess` 保留最新 N 个 | §24.1 |
| 152 | 等功率声像 | equal-power panning | $\cos/\sin$；中心每声道 **−3.01 dB** | §10.6 |
| 153 | 声部位置 | voice pan | `voice_pan` 叠加在 patch 声像之上 | §10.6 |
| 154 | 块处理 | block processing | 摊薄 FFI 开销 | §11.1 |
| 155 | 渲染量子 | render quantum | AudioWorklet 的 128 帧 | §11.1 |
| 156 | 零分配 | zero allocation | 实时线程绝不 `memory.grow` | §11.2 |
| 157 | 竞技场分配器 | arena allocator | 12 MiB，首次适配 + 地址序合并 | §11.2 |
| 158 | 内存增长 | `memory.grow` | 被 arena 设计**排除** | §11.2 |
| 159 | 优雅拒绝 | graceful refusal | `NoRoom` → 返回码 4 → UI toast | §15.8 |
| 160 | 单指令多数据 | SIMD | `simd128`；标量回退核 | §11.3 |
| 161 | 目标特性 | target feature | `+simd128` 有无决定哪份 wasm | §11.3 |
| 162 | 标量回退 | scalar fallback | `synth_core_scalar.wasm` | §11.3 |
| 163 | 库调用 | libcall | wasm 上 `sinf` 等会递归 ⇒ 必须自持实现 | §11.4 |
| 164 | 确定性 | determinism | 同输入逐位相同；自持 RNG、无挂钟 | §11.4 |
| 165 | 随机数发生器 | RNG | xorshift32，`new(0) → 0x9e3779b9` | §11.4 |
| 166 | 全局构造器 | global constructor | wasm 的**危险源**：`__wasm_call_ctors` 不幂等 | 附录 C |
| 167 | 体积预算 | bundle budget | dist / 首屏 JS / CSS / 最大 wasm gzip | §11.5 |
| 168 | 记账式重标定 | booked re-calibration | 阈值随产品决策改，理由写进基线 `reason` | §23.5 |
| 169 | 指纹 | fingerprint | DSP（26 个数）/ 预设（91×26 个数） | §28 |
| 170 | 基线 | baseline | 提交进仓库的期望值（JSON） | §28 |
| 171 | 容差 | tolerance | DSP 1e-4；预设 0.25/0.5 dB | §28 |
| 172 | 严重度 | severity | `delta / tolerance`；>1 即失败 | §28.3 |
| 173 | 正控 | positive control | 注入已知缺陷，断言门禁报警 | §30.3 |
| 174 | 自证 / 反证 | self-proof | 故意改坏一处让门禁变红 | §30.3 |
| 175 | 同机同探针 A/B | same-host same-probe A/B | 唯一允许的绝对数字比较方式 | §31.1 |
| 176 | 顺序依赖 | order dependence | `gs_init` 不复位参数/矩阵/相位 | §31.2 |
| 177 | 门禁静默降级 | silent gate downgrade | bench 在宿主忙时只报正确性 | §29.5 |
| 178 | 窗口化中位数 | windowed median | 拒绝 stall 同时保留持续成本 | §29.4 |
| 179 | 真实时间因子 | real-time factor | 用「预算占用百分比」表达 | §29.3 |
| 180 | 内容守卫 | content guard | 不静音 / 非有限 / 响度 spread / 曲目质量 | §30 |
| 181 | 响度 spread | loudness spread | 91 条预设乐句 RMS 的极差，门禁 < 9.0 dB | §30.1 |
| 182 | 谱平坦度 | spectral flatness | 曲目质量守卫，阈值 0.25 | §30.1 |
| 183 | 覆盖槽 | override slot | P9.3：每节点 4 个效果参数覆盖 | §18.5 |
| 184 | 哨兵值 | sentinel | `FX_OVR_UNSET = −2.0`，低于所有合法范围 | §18.5 |
| 185 | 逐字存储 | verbatim storage | 覆盖槽不做钳位（否则哨兵被夹掉） | §18.5 |
| 186 | 效果链 | effect chain | 6 个位置，**permutation**（不会丢失/重复） | §19 |
| 187 | 自由路由图 | free routing graph | 前馈、无环、节点索引即拓扑序 | §19.3 |
| 188 | 干声总线 | dry bus | `GRAPH_DRY = 1` | §19.2 |
| 189 | 效果模板 | FX template | 49 个 id 的白名单；只改接线不改音色 | §19.7 |
| 190 | 双实例 / 层叠 / 分割 | dual instance / layer / split | instance B 走消息而非 AudioParam | §24.3 |
| 191 | 力度窗口 | velocity window | 让 split 兼作动态层 | §24.3 |
| 192 | 频谱分析仪 | spectrum analyser | 512 点 FFT + 36 个对数 bin | §25.1 |
| 193 | 导出归一化 | export normalisation | `ceiling = 0.891`（约 −1 dBFS），boost ≤ 24 dB | §25.3 |
| 194 | 负载监视器 | load monitor | 3 次错截止 / 12 次过载才降声部 | §24.2 |
| 195 | 静音快捷路径 | silent fast path | `env < SILENT_VOICE` 时跳过整条滤波链 | §12.3 |
| 196 | 增益校准 | gain calibration | `VOICE_GAIN 0.22 → 0.44`，+6 dB 的取舍 | §23.4 |
| 197 | 相位表漏行 | missing phase-table row | 每 1024 样本一个满幅脉冲 ⇒ −30/−31 dB | 附录 C |
| 198 | 窄窗 bug | narrow-window bug | 触发窗宽 ~2e-6 ⇒ 随机抽签验证会系统性漏掉 | §16.4 |
| 199 | 交错校验 | interleaved verification | 同一批改动同时验 1×/2× 与两条尺子 | §28.4 |
| 200 | 天花板绝对性 | absolute ceiling | knee/ceiling 是绝对电平 ⇒ 抬总线必然花掉头部空间 | §6.4 |

---

# 附录 B · 关键参数 id 索引

> **权威来源**：`crates/synth-core/src/params.rs` 的 `pub mod id`（`PARAM_COUNT = 224`）。
> **id 是分享码的线格式**：只追加，不插入。
> 范围列给的是 `Params::set` 的钳位值（**不是 UI 建议范围**）。

## B.1 主控（0, 36–42, 78–79）

| id | 常量名 | 范围 / 语义 | 默认 |
| --: | :-- | :-- | --: |
| 0 | `MASTER_VOLUME` | 0..1 | 0.75 |
| 36 | `GLIDE` | 0..1 | 0.0 |
| 37 | `TEMPO` | 20..300 BPM | 120 |
| 38 | `PITCH_BEND_RANGE` | 0..24 半音 | 2 |
| 41 | `MASTER_TUNE` | −24..24 半音 | 0 |
| 42 | `VOICE_MODE` | 0 poly / 1 mono(retrig) / 2 legato | 0 |
| 78 | `PATCH_GAIN` | **0..8**（Rust 钳位）；预设级输出修剪，**无 UI 控件** | 1.0 |
| 79 | `WT_USER` | ≥0.5 = 用导入的单周期表 | false |

## B.2 振荡器（1–12, 39–40, 70–73, 137–144）

| id | 常量名 | 范围 |
| --: | :-- | :-- |
| 1 / 7 | `OSC1_ON` / `OSC2_ON` | >0.5 = 开 |
| 2 / 8 | `OSC1_WAVE` / `OSC2_WAVE` | 0 sine / 1 tri / 2 saw / 3 square / 4 pulse / 5 noise / 6 pink / 7 brown / 8 wavetable / 9 sample |
| 3 / 9 | `OSC1_PITCH` / `OSC2_PITCH` | **−48..48 半音** |
| 4 / 10 | `OSC1_DETUNE` / `OSC2_DETUNE` | −100..100 音分 |
| 5 / 11 | `OSC1_LEVEL` / `OSC2_LEVEL` | 0..1 |
| 6 / 12 | `OSC1_PW` / `OSC2_PW` | **0.05..0.95**（脉宽；波表时是 recipe 选择） |
| 39 / 40 | `OSC1_PAN` / `OSC2_PAN` | −1..1 |
| 70 / 72 | `OSC1_UNISON` / `OSC2_UNISON` | **1..7**（`MAX_UNISON`） |
| 71 / 73 | `OSC1_SPREAD` / `OSC2_SPREAD` | 0..1（→ ±35 音分） |
| 137 | `OSC_FM` | 0..1（→ 0..2 个载波周期，`depth²`） |
| 138 | `OSC_RING` | 0..1 |
| 139 | `OSC1_SYNC` | ≥0.5 = 硬同步 |
| 140 / 142 | `OSC1_SUB` / `OSC2_SUB` | 0 / 1 / 2 个八度 |
| 141 / 143 | `OSC1_SUB_LEVEL` / `OSC2_SUB_LEVEL` | 0..1 |
| 144 | `NOISE_MIX` | 0..1 |

## B.3 滤波器（13–18, 58–61, 145–151, 166）

| id | 常量名 | 范围 / 语义 |
| --: | :-- | :-- |
| 13 | `FILTER_TYPE` | 0 lp（**Rust ladder**）/ 1 hp / 2 bp / 3 notch / 4 comb / 5 formant / 6 sem |
| 14 | `FILTER_CUTOFF` | **20..20000 Hz** |
| 15 / 16 | `FILTER_RES` / `FILTER_DRIVE` | 0..1 |
| 17 | `FILTER_ENV_AMT` | 0..1 |
| 18 | `FILTER_KBD` | >0.5 = 键盘跟踪 |
| 58–61 | `FILTER_ENV_{ATTACK,DECAY,SUSTAIN,RELEASE}` | 0.0005..8 / 0.001..12 / 0..1 / 0.005..16 |
| 145 | `FILTER_MORPH` | 0..1（仅 `sem` 读；0=LP、1/3=BP、2/3=notch、1=HP） |
| 146 | `FILTER_ROUTING` | 0 off（默认）/ 1 serial / 2 parallel |
| 147 | `FILTER2_TYPE` | comb/formant 读作 lp |
| 148 / 149 / 150 | `FILTER2_{CUTOFF,RES,DRIVE}` | 20..20000 / 0..1 / 0..1 |
| 151 | `FILTER_BLEND` | 0..1（**线性律**，端点逐位可断言） |
| 166 | `OVERSAMPLE` | >0.5 = 2×（默认关） |

## B.4 包络与 LFO（19–28, 62–66, 74–77）

| id | 常量名 | 范围 / 语义 |
| --: | :-- | :-- |
| 19–22 | `ENV_{ATTACK,DECAY,SUSTAIN,RELEASE}` | 0.0005..8 / 0.001..12 / 0..1 / 0.005..16 |
| 23 | `LFO_ON` | >0.5 |
| 24 | `LFO_WAVE` | 0 sine / 1 tri / 2 square / 3 saw |
| 25 | `LFO_RATE` | 0.02..40 Hz |
| 26 | `LFO_DEPTH` | 0..1 |
| 27 | `LFO_TARGET` | 0 cutoff / 1 pitch / 2 volume / 3 pwm |
| 28 | `LFO_SYNC` | >0.5 = 一拍一周期（`tempo/60`） |
| 62–66 | `LFO2_{ON,WAVE,RATE,DEPTH,TARGET}` | 同上 |
| 74 / 75 | `LFO_RETRIG` / `LFO_ONESHOT` | >0.5 |
| 76 / 77 | `LFO2_RETRIG` / `LFO2_ONESHOT` | >0.5 |

**调制矩阵**不走 id：`gs_set_mod_route(index, src, dst, amount, enabled)`，`MOD_ROUTES = 8`，
源 0..7（Lfo/Env/ModWheel/Velocity/Lfo2/Aftertouch/Random/KeyTrack），
目标 0..7（Cutoff/Pitch/Volume/Pwm/Pan/Resonance/Fm/Ring），`amount` −1..1。

## B.5 效果链与图（29–35, 43–57, 67–69, 80–87, 88–100, 101–136, 152–165, 179–182）

| id | 常量名 | 范围 / 语义 |
| --: | :-- | :-- |
| 29 | `FX_REVERB_ON` | >0.5 |
| 30 / 31 | `FX_REVERB_SIZE` / `_MIX` | 0..1 |
| 67 / 68 / 69 | `FX_REVERB_{DAMP,WIDTH,PREDELAY}` | 0..1 / 0..1 / **0..0.1 s** |
| 94 | `FX_REVERB_MODE` | ≥0.5 = 1（卷积 IR） |
| 95 | `FX_CONV_TRIM` | 0..4 |
| 32 | `FX_DELAY_ON` | >0.5 |
| 33 | `FX_DELAY_SYNC` | 0 四分 / 1 附点八分 / 2 八分 / 3 十六分 |
| 34 | `FX_DELAY_FB` | **0..0.95** |
| 35 | `FX_DELAY_MIX` | 0..1 |
| 80 | `FX_DELAY_DAMP` | 0..1 |
| 81 | `FX_DELAY_PINGPONG` | ≥0.5 |
| 43–46 | `FX_CHORUS_{ON,DEPTH,RATE,MIX}` | >0.5 / 0..1 / **0.02..10** / 0..1 |
| 47–50 | `FX_FLANGER_{ON,RATE,FB,MIX}` | >0.5 / 0.02..10 / **0..0.95** / 0..1 |
| 51–54 | `FX_PHASER_{ON,RATE,FB,MIX}` | >0.5 / 0.02..10 / **0..0.95** / 0..1 |
| 55–57 | `FX_DRIVE_{ON,AMT,MIX}` | >0.5 / 0..1 / 0..1 |
| 82–87 | `FX_CHAIN1..6` | 0 none / 1 delay / 2 reverb / 3 chorus / 4 flanger / 5 phaser / 6 drive / 7 crush / 8 eq / 9 transient |
| 88–93 | `FX_PARALLEL1..6` | ≥0.5 = send 而非 insert |
| 100 | `FX_GRAPH` | ≥0.5 = 用自由图 |
| 101–106 | `FX_NODE_IN1` + 0..5 | 0 无 / 1 干声 / 2..7 = 节点 1..6 |
| 107–112 | `FX_NODE_IN1_GAIN` + 0..5 | **0..4** |
| 113–118 | `FX_NODE_IN2` + 0..5 | 同上 |
| 119–124 | `FX_NODE_IN2_GAIN` + 0..5 | 0..4 |
| 125–130 | `FX_NODE_TO_OUT` + 0..5 | ≥0.5 = 送总线 |
| 131–136 | `FX_NODE_OUT_GAIN` + 0..5 | 0..4 |
| 167–178 | `FX_MOD1..4_{SRC,DST,DEPTH}` | src 0..3 / dst 0..18 / depth −1..1（平滑） |
| 152–156 | `FX_CRUSH_{ON,BITS,DOWN,AA,MIX}` | >0.5 / **4..16** / **1..64** / 0..1 / 0..1 |
| 157–165 | `FX_EQ_{ON,LOW_GAIN,LOW_FREQ,MID_GAIN,MID_FREQ,MID_Q,HIGH_GAIN,HIGH_FREQ,MIX}` | >0.5 / −18..18 / 40..1000 / −18..18 / 200..8000 / 0.3..6 / −18..18 / 1000..16000 / 0..1 |
| 179–182 | `FX_TRANSIENT_{ON,ATTACK,SUSTAIN,MIX}` | >0.5 / −1..1 / −1..1 / 0..1 |

## B.6 采样器（96–99）

| id | 常量名 | 范围 / 语义 |
| --: | :-- | :-- |
| 96 | `SMP_ROOT` | 0..127（**MIDI 音符**，非频率） |
| 97 | `SMP_MODE` | 0 one-shot / 1 loop / 2 ping-pong |
| 98 / 99 | `SMP_LOOP_START` / `_END` | 0..1（**归一化**） |

## B.7 覆盖槽与覆盖槽调制总线（183–223）

| id | 常量名 | 范围 / 语义 |
| --: | :-- | :-- |
| 183–206 | `FX_OVR1_1 … FX_OVR6_4` | 每节点 4 槽；**逐字存储**，哨兵 `FX_OVR_UNSET = −2.0`；使用时按 `ovr_slot_range` 钳位 |
| 207–214 | `FX_OVR_TARGET1..8` | 0 = 关，否则 `1 + node×4 + slot`（掩码 `0x1f`） |
| 215–222 | `FX_OVR_DEPTH1..8` | −1..1（该槽自身范围的有符号比例） |
| 223 | `FX_OVR_SRC` | 0 关 / 1 LFO1 / 2 LFO2 / 3 Env（**整条总线共享**） |

**覆盖槽范围**（`ovr_slot_range`，按 kind/slot）：

| kind | slot 0 | slot 1 | slot 2 | slot 3 |
| :-- | :-- | :-- | :-- | :-- |
| Delay | **0.001 .. max_delay_seconds（秒）** | 0..0.95 | 0..1 | 0..1 |
| Reverb | 0..1 | 0..1 | 0..1 | **0..0.1** |
| Chorus / Flanger / Phaser | 0..0.95（flanger/phaser）或 0..1 | **0.02..10** | 0..1 | — |
| Drive | 0..1 | 0..1 | — | — |
| Crush | **4..16** | **1..64** | 0..1 | 0..1 |
| Eq | −18..18 | −18..18 | −18..18 | **200..8000** |
| Transient | −1..1 | −1..1 | −1..1 | — |

---

# 附录 C · 已知边界与失败过的方案

> 本附录是本文档**最有价值**的部分。每一条都来自仓库自己的记录，
> 并且尽量保留**原始数字与原始结论**。

## C.1 被实测**推翻**的直觉与假设（8 条）

### C.1.1 「把短 mip level 加长」反而更差（1/N² 外推之误）

**直觉**：表长扫描显示线性插值误差每倍长降 ~12 dB（$1/N^2$），
所以「把最短的 mip level 加长」应该改善高音区。

**实测（离线复刻，同内容/同读法/BH-7/C8 = 4186 Hz）**：

| 方案 | min level 长度 | 最差 |
| :-- | --: | --: |
| 现状（逐级抽取变短） | 8 | −24.2 dB |
| 只把最短抬到 64 | 64 | **−9.2 dB（更差）** |
| 只把最短抬到 128 | 128 | **−8.4 dB（更差）** |
| 只把最短抬到 256 | 256 | **−8.2 dB（更差）** |
| **全长 2048 × 9 级** | 2048 | **−113.6 dB** |

**为什么直觉错了**：那条 1/N² 扫描**固定了谐波数**；而引擎里的 level 是**按表长带限**的，
所以把短 level 加长会**同时抬高它的谐波上限**，$h/N$ **一直顶在 Nyquist 上**。
源码注释的数学表述：

> a level of `N` samples holding `h` harmonics is read with a phase step of `2πh/N` per output
> sample, and the chord error is set by **that product**, not by `N` alone.

### C.1.2 P9.7 对采样器的归因**漏了一半**

P9.7 把采样问题归给「插值器」，并把「每级表长 ×12–13」当作解法。
P9.8 发现真因**还有一半**：

> 那个归因漏了一半：真正把误差钉死的是**每级都用 2^k 抽取**——一个 N 点 level 的内容永远
> 躺在自己 Nyquist 的 **0.44** 处……P9.7 设想的「每级表长 ×12–13」**照原链放大，ν 一动不动，
> 误差也不会动**。

### C.1.3 「只做一半」比不做更差（P9.8 的两半必须同时做）

| 方案 | 结果 |
| :-- | --: |
| 只拉长级长（ν=1/16）+ 三次核 | **−70.5 dB** |
| 只拉长到 ν=1/8 + 三次核 | **−56.0 dB**（4186 Hz） |
| **只**换窗 sinc（ν 仍贴 0.44） | **−54.7 dB** |
| **两者都做**（ν=1/4 + 窗 sinc） | **−86.4 dB** |

### C.1.4 滤波器共振/滤波器的归因被**配对实测否掉**（P9.6 的前提）

计划认为「C7 锯齿 + 工厂滤波」的坏点是**共振**造成的，候选解是
「改工厂默认 `res`」与「加起音斜坡」。**配对实测**：

- 第 53 次 `note_on` 在 `res = 0.05` 下 **−43.9 dB**；**`res` 改成 0 仍是同一个坏点 −44.5 dB**；
  `res = 0` 的 150 场扫描**同样 1/150**；
- 同初相换 sine（滤波/cutoff/res 全同）→ **−121.7 dB 干净**；
- comb 与 HP 20 Hz 照样有坏点。

⇒ **既不是共振也不是滤波器**；两个候选解**都修不掉**。
真根因是 §16.4 的 f32 表游走。

### C.1.5 P9.1b 曾读出一个**假的 −100 dB**

**根因是一个单位错误**：`PhaseInc()` 的单位错导致普通路径**整体高一个八度**，
而旧的错误签名**恰好把 2f 当成了网格谐波**，于是读出一个漂亮的假数：

> **不修的话本批所有离格底数字都不可信**——旧的错误签名恰好把 2f 当成了网格谐波，
> 读出一个假的 **−100 dB**。

### C.1.6 P9.1a 之前的「达标」是**抽到了好窗**

硬同步曾经连续 400 块稳定读 **−80.8 dB**，看起来达标。
同一持续音内 8 个 4 s 窗的真实读数是
**−109.2 / −36.5 / −48.3 / −56.3 / −105.3 / −111.5 / −117.0 / −36.1 dB**，
**坏窗可达 −33 dB**。所以：

> 第三步的「达标」后来被证明是**抽到了好窗**。

### C.1.7 「在 DaisySP 的输出上打补丁」这条路**走不通**（两次失败）

| 尝试 | 锯齿 | 方波 | 三角 |
| :-- | --: | --: | --: |
| 原始 | −32 dB | −33 dB | −50 dB |
| 尝试 1：两样本 polyBLEP 残差 | **−1.6** | **−2.4** | **−2.6** |
| 尝试 2：裸波形估残差 | **−1.9** | **−33.5（等于没改善）** | **−1.9** |

结论：**修正必须发生在不连续被生成的地方**。

### C.1.8 限幅器「温和工作」的预期**不成立**

设计假设：「密集和弦按 $\sqrt{N}$ 而不是 $N$ 求和，所以小 `VOICE_GAIN` 让总线留在
限幅器的线性区」。

**实测**：`gs_limit_reduction()` 在 **+9 dB** 时仍恒为 **1.000**（不动作）；
密集素材 peak 0.63 也没到 0.95。真正吸收变化的是**基线就在工作的 `soft_limit`**。

> 「让限幅器在密集素材上温和工作」这个预期**与实测不符**。

## C.2 数值精度类 bug（4 条）

### C.2.1 相位表少了最后一行（**30 dB / 31 dB 的 bug**）

| 项 | 内容 |
| :-- | :-- |
| **现象** | 1C 第一版比 1A 差 **25–35 dB**，且**同一个音在同一进程里读数会跳**（note 84：**−47.1 / −67.0 / −67.5 / −52.7**）；重新导入同一份采样也不消除散布 |
| **误导** | 这个「顺序依赖」看起来像**引擎状态或内存布局**问题，「是整轮里最误导人的东西」 |
| **定位方式** | 「把门禁那把尺子搬进 Rust」后二分：原样 −47.1 → 布局换 1A **−54.7** → 核换 4 点三次 **−39.0** → **核改成现算、不过相位表 −85.6** |
| **根因** | **相位表少了最后一行**：`x = 1` 处的核**不是** `x = 0` 处的核（插值点前进一个样本，delta 从抽头 7 移到抽头 8），而代码在最后一个相位让 blend **回绕读了 row 0** |
| **量化** | 约每 **1024** 个输出样本有一个用**整体位移了一个样本的核**去插值 ⇒ **0.1% 密度的全幅脉冲串** ⇒ 功率约 −30 dB 量级，与实测 **31 dB** 劣化吻合 |
| **顺序依赖的解释** | 脉冲串的**相位**取决于读取起点，而起点取决于前一次渲染留下的引擎状态 |
| **修复** | 表建 `KERNEL_PHASES + 1 = 1025` 行，最后相位不再回绕。修后 note 84 连读三次 **−82.55 / −82.55 / −82.56** |
| **回归测试** | `the_phase_table_has_a_row_past_the_last_phase` |
| **代价** | 1047 Hz **−86.4（有该行）/ −54.7（无）** |
| **口径不一致** | `sampler.rs` 注释写「cost **30 dB**」；`docs/notes/band-limited-oscillators.md` 与 `NEXT-PLAN-2.md` 写 **31 dB**（见 §32） |

### C.2.2 f32 读位置的边带

| 版本 | f32 | f64 |
| :-- | --: | --: |
| P9.5（位置到 4096） | **−35.2 dB**（重放）／−35.3（引擎） | **−44.7 dB**，loop 边带消失 |
| P9.7（位置到 192000，ULP ≈ 1.5e-2） | **−27.3 dB** | **−30.1 dB** |

最强离格线的**频率整批换了**（f32：22882.69 / 22882.51 / 22882.87 Hz；
f64：22883.97 / 22883.79 / 22884.16 Hz）——「与 f32 的那组**不再是同一批频率**」。

### C.2.3 f32 表游走把该格舍入到节点上（P9.6）

见 §16.4。触发窗宽 **~2e-6** ⇒ 按 4 s 窗随机采样约 **1/150**。
**最贵的教训**：

> 用随机抽签验证「密性」的修复，会系统性漏掉这种**窄窗 bug**；
> **必须固定那个已知场景做确定性断言**。

**第一版修复本身也犯了错**：写成 `t0 <= 常数` **误伤了每一个 `x == 1` 的包裹**
（第 32 个抽头正好落在节点上），**150/150 场景掉到 −31 dB**，已否掉（改用严格小于号）。

### C.2.4 f32 相位累加（硬同步/普通振荡器）

纯正弦离网能量：f32 **−66 dB** → f64 **−87 dB**（步进误差 1e-7 → 1e-16，
裙边整体下沉 **21 dB**）。改动只有一处：`phase_` / `phase_inc_` `float → double`。
**`test:dsp` 的指纹没有变**（因为波形运算仍在 f32）。
回归测试 `a_steady_sine_has_no_phase_noise_skirt` 断言纯正弦离网能量 **< −80 dB**
（「f32 会立刻失败」）。

## C.3 实时工程类 bug（3 条）

### C.3.1 arena 曾经 trap（8 → 12 MiB 的真实原因）

**不是预先设计**：

> P9.7 shipped **8 MiB**, which held … with room to spare. P9.8's sampler levels are **~1.5×
> longer** …… a 4 s sample plus a **96 KB** response —— **left 169 KB free and then failed a later
> message-path allocation outright**.

最坏占用：4 s 采样叠加另一次导入，峰值 ≈**9.0 MB** ⇒ 12 MiB 留 ~3 MB。
**修法不只是加大**：`try_reserve_exact` 失败 → `SampleError::NoRoom` → 返回码 **4** → UI toast，
**拒绝时旧采样保留、不 trap**。
**代价是 0**：arena 是 `.bss`，wasm raw **−0.7 KB**、gzip **74.5/75 未变**。

**自证**：把 `ARENA_SIZE` 临时改成 **5 MiB** → 4 s 采样 `code 4 / noRoom`、**不 trap**、
已加载的 0.1 s 采样仍在、之后 200 块渲染无 trap 且 `gs_alloc_violations() == 0`。

### C.3.2 门禁在负载变重时**静默失效**（`mean > 450 µs` 启发式）

> P9.1b 用 `cpuProbe()` 取代旧的 `mean > 450 µs` 启发式，因为那个数是在整机 ~250 µs 时
> 标定的：一旦带限振荡器把同一场景推到 ~1400 µs，门禁就把**引擎自己的合法成本**读成
> 「宿主过载」并静默把每条计时断言降级成 `skipped`……
> **A gate that stops gating when the workload gets heavier is worse than no gate.**

### C.3.3 `verify` 链的顺序缺陷（干净 worktree 必红）

`npm test` 排在 `build` 之前，而 `src/generated/*.wasm` 是 gitignore 的构建产物 ⇒
干净 worktree / 新 runner **必红**（16 个文件 `Failed to resolve import …`）。
自证：「先测」= **7/26 文件红**；「先 build」= **26 文件 / 163 用例全绿**。
修复提交 **`0a5aca3`**。
**同源缺陷**：`release.mjs` 的 `git checkout -- package.json`（v1.108.0）导致
`npm run verify` **静默跳过 2× 预设指纹门禁**，而当时的 `verify-ci` 只查 CI 文本，
**不查 npm script 是否存在**，所以仍报 PASS。

## C.4 WASM 平台类 bug（1 条，**最有平台价值**）

### C.4.1 C++ 全局构造器让每个导出函数都清零滤波器状态

**表现**：vendored DaisySP `LadderFilter` 在 wasm 下**每个 render-block 边界丢一个样本**
（每 128 样本一次 click），而**同一份 C++ 在 host 上逐位干净**。

**曾被怀疑但被实测排除**（`docs/notes/wasm-ladder-root-cause.md`）：

| 假设 | 实测 |
| :-- | :-- |
| 编译优化级别 | `-O0/-O1/-O2/-O3` **同样坏** |
| SIMD / 自动向量化 | 标量构建（`GS_SIMD=0`）**同样 dropout 6.730e-1**；`-O0` 复现 |
| `ladder.cpp` 自身的 UB | 同源**原生逐位干净** |
| `memset`/`memcpy`/`tanhf` | 排除 |
| freestanding / 对齐 / ABI | 排除 |
| setter / `Init()` 重跑 | 每块调 setter 与否**无差别**；`Init()` **不清** `z0_/z1_` |

**真根因（一个链接/执行模型问题，不是滤波器代码、不是编译器 bug）**：

1. `daisysp::LadderFilter` 的**类内成员初始化器**（NSDMI，`float beta_[4] = {0,0,0,0};` 等）
   使它**非平凡默认可构造**；
2. `gs_daisy.cpp` 里命名空间作用域的数组 `VoiceDsp g_voice[GS_MAX_VOICES]`
   因此需要**动态初始化** ⇒ clang 生成 `_GLOBAL__sub_I_gs_daisy.cpp` 并注册进 `.init_array`；
3. wasm-ld 把它折进 `__wasm_call_ctors`；
4. wasm 以 **command module** 构建（`--no-entry`、无 `start`、**不导出** `__wasm_call_ctors`），
   于是 wasm-ld 给**每一个导出函数**包一个 `<name>.command_export` shim，
   函数体第一件事就是 `call __wasm_call_ctors`；
5. 而 `__wasm_call_ctors` **不幂等** ⇒ **每次调用任意 `gs_*` 都重跑全局构造**，
   把 32 个 voice 里 ladder 的 `beta_`/`z0_`/`z1_` **全部清零**；
6. 每个 block 的第一个样本状态恰为 0，输出塌陷再重建 = 块率上的单样本 dropout / click train。

**关键测量**：

| 项 | 值 |
| :-- | :-- |
| 分块 vs 单次调用的 `max\|chunked − single\|` | chunk 32 → **6.732e-1**；64 → 6.732e-1；128 → **6.730e-1**；256 → 6.729e-1；1024 → 6.558e-1 |
| chunk = 128 时 block 1 的第一个样本 | **1.45e-5** vs 正确单次轨迹 **3.855e-1** |
| 与「全新零状态滤波器只喂该一个输入样本」比较 | block 1@128：**1.45188e-5** vs `1.40143e-5`；block 2@256：1.44001e-5 vs 1.38025e-5；block 3@384：−3.97262e-6 vs −3.72162e-6 ⇒ **状态确实每块归零** |
| 反汇编证据 | `gs_dbg_ladder_block.command_export` 首行 `call $__wasm_call_ctors`；`_GLOBAL__sub_I_gs_daisy.cpp` 循环 32 voices（**stride 1456**）对 `ladder[0]`/`ladder[1]` 的 `beta_`/`z0_`/`z1_` 做 v128 零存；它是模块里**唯一**的动态初始化器 |
| **判别实验（只改链接）** | `-C link-arg=--export=__wasm_call_ctors` ⇒ 每个 chunk 的 `max\|chunked−single\| = 0.000e+0` |
| 最小复现 | `docs/notes/wasm-ladder-repro/`（`repro.wasm` 仅 **~5 KB**）；**单个全局（非数组）会被 clang 折进 `.bss`，不复现；数组才强制动态初始化** |
| 复现环境 | clang 22.1.8、rustc 1.98.1、wasm-ld (LLVM 22)、Node 22.22.3 |

**修复（三层）**：

1. **首选 root fix**：去掉 NSDMI，让类**平凡默认可构造**（已做；
   验证 unstripped 模块**无** `_GLOBAL__sub_I_*` 且 `__wasm_call_ctors` 为空）；
2. 链接层保底：`-C link-arg=--export=__wasm_call_ctors` + 实例化后显式调一次；
3. **CI 回归测试**：用最小复现 + native 对照。

**一条部署纪律（原文）**：

> A *native* Rust `#[test]` alone would **not** catch this, because **native is always clean**.

落地：提交 `a153d24`（改 `ladder.cpp` +9、`ladder.h` +14/−3），
新增 `scripts/verify-wasm.mjs` 门禁「**no C++ global constructors in the core**」。

**并且**：这是「自持 Rust ladder」的**收益**之一——
「The shipped engine is currently unaffected only because `dsp/ladder.rs` (hand-written Rust)
replaced the C++ ladder; the underlying hazard is **generic to any dynamically-initialised C++
global linked into this wasm module**.」

**残留问题**：C 桥仍保留 `daisysp::LadderFilter ladder[2]` 与 `GS_FILTER_LP` 分支，
而引擎已用 Rust 处理 `Lp`，所以那个 C++ 分支**实际上不再被引擎走到**（定性，未加断言）。

## C.5 参数编号与 id 预算的既存缺陷（2 条，**已知未修**）

### C.5.1 图节点参数区与其它参数**编号重叠**

```text
graph_param_field 用 base <= id < base + FX_SLOTS
⇒ FX_NODE_OUT_GAIN + 1 == FX_DELAY_MIX
⇒ FX_NODE_TO_OUT  + 5 == FX_PARALLEL3
⇒ FX_NODE_IN1     + 5 == FX_EQ_ON
```

**后果**：**宿主（JS/worklet）无法把 6 个节点全部清干净**——
JS 探针因此出现「节点 2 读节点 1」的双驱动（**rms 是链的 2 倍**）。
Rust 测试走内部 API 所以**不受影响**，两把尺子的**差值**也不受影响。
**修它要动参数编号，属红线级改动**。

### C.5.2 效果参数**按 kind 存、不按节点存**

`delay time/feedback`、`reverb size/mix`、`drive amount` … 在 P9.3 之前
是「一个 kind 一组参数」，因此**不能作为图内调制目标**；
P9.3 的覆盖槽 + 覆盖槽调制总线**部分解决**了这个问题（4 个参数可调制），
但 §一 第 3 条仍把「按种类而非按节点」列为技术债。

## C.6 兼容性「红线」与被显式记账的改动（摘要）

| 红线 | 当前值 |
| :-- | :-- |
| DSP 指纹 1× | `rms 0.061470` |
| DSP 指纹 2× | `rms 0.061703` |
| 预设指纹 | **91 条 × 2**（`abi: 8`） |
| 零分配 | `gs_alloc_violations() == 0` |
| ABI 版本 | **8** |

**历史上被记账式改动的红线**（每一次都有理由与实测）：

| 改动 | 理由 | 数字 |
| :-- | :-- | :-- |
| 1× rms `0.030806 → 0.030735` | P9.1b 带限振荡器改变稳态波形 | 显式重录 81/81 指纹 |
| 2× rms `0.030946 → 0.030852` | 同上 | 同上 |
| 1×/2× rms `→ 0.061470 / 0.061703` | **`VOICE_GAIN 0.22 → 0.44`（+6 dB）** | 91/91 条移动 |
| 预设指纹 `81 → 91` | P12.2 内容包新增 10 条 | 既有 81 条**逐字节未变**（规范化行 sha256 前 == 后） |
| P9.7 波表：整份重录 81 条 | 波表级改全长 | 真的变的**只有 4 条**（`wtglass` 2.604 / `wtmetal` 1.175 / `wtvocal` 0.838 / `wtorgan` 0.793 dB）；其余 77 条 ≤0.0090 dB |
| 多条体积阈值（1676→1678、1684、1711、1720、1530、1550、1562、1568、1614、1619 …） | 各批真实功能增长 | 每次都有实测占用 + 少量余量 |

**「体积余量极度紧张」是常态，不是异常**（保留原始数字）：

| 项 | 实测/阈值 | 余量 |
| :-- | --: | --: |
| 首屏 JS gzip（P11.2 后） | **123.75 / 125 KB** | ~1.2 KB |
| dist total（P11.2 后） | **1558.3 / 1562 KB** | ~3.7 KB |
| 首屏 JS gzip（v2.0.2 后） | **124.7 / 125 KB** | ~0.3 KB |
| wasm gzip（P9.8 1C 第一版） | **75.05 / 75.0 KB** | **超 51 字节（FAIL）** |
| wasm gzip（抽出 `read_wrapped` 后） | **74.98 KB（76780 B）** | **20 字节** |
| dist（+6 dB 后） | **1615.0 / 1619.0 KB** | 4.0 KB |

**一个反直觉的实测结论：gzip 对 raw 不单调。**
合并两个滤波循环 raw **−360 B** 但 gzip **+51 B**；
`#[inline(never)]` 在 `prepare_kernel`/`load` 上试过反而 gzip **+20 B**（已撤）；
而把 `read_wrapped` 标 `#[inline(never)]` **省了 71 gzip 字节**。
⇒ **每次体积改动都要真跑 `verify-budget`，不能靠推理。**

## C.7 其它已知边界（未归类）

| 边界 | 说明 |
| :-- | :-- |
| **硬同步 `≥30 s 离散度 < 3 dB` 未达标** | 只有 triangle 的三个比值达到（0.2–0.8 dB）；锯齿/方波 4.3–16.4 dB。需更高过采样（4×）或重做核 |
| **硬同步 44.1/96 kHz 的包络周期没有定量解释** | 模型给 31 s / 12 s，实测 21 s / 6 s |
| **采样级 1/2 的带宽被换掉了** | 收窄到 3–12 kHz；补回需 +0.77 MB |
| **采样级 8 无门禁覆盖** | 只覆盖键盘之外 |
| **采样导入耗时不可跨会话比** | 273.9 ms vs 同机 157.6 ms，差 1.74× |
| **导入在消息路径卡顿 / >4 s 截断** | 4 s mipmap 构建 ~140–274 ms；JS 侧截断 |
| **真峰值非标准** | 相邻样本均值估计，不是 ITU-R BS.1770 |
| **无 LUFS / 无 crest factor 度量** | 用**乐句 RMS** 作感知响度的廉价替身 |
| **无 IMD 门禁** | 未实现 |
| **模态/无障碍/分享协作不做** | P12.3、P12.5 显式 ❌ |
| **教学模式无任何响度/电平测量** | 36 条单测全部围绕音高/节奏 |
| **视觉基线不进 CI** | 48 张基线是「这台机器的字体栈」的属性 |
| **WebKit headless 交不出帧** | 应用页 0 帧/3.5 s；空白页 55–57 fps（**不是 rAF 不触发**——那个早期结论**是错的**） |
| **`wasm-ladder-root-cause.md` 标题行过时** | 仍写「shipped DSP is unchanged」，但同日提交 `a153d24` 已实施 root fix |
| **`docs/notes/p12-presets.md` 不存在** | 只有 `p122-presets.md` |

---

# 附录 D · 延伸阅读

> 本仓库的笔记与源码是**一手证据**；下面是理解它们所需的**背景文献**。
> 标 ★ 的是与本仓库具体实现直接对应、**最值得先读**的。

## D.1 数字信号处理与频谱分析

- ★ **Oppenheim, A. V. & Schafer, R. W., _Discrete-Time Signal Processing_**（中译《离散时间信号处理》）。
  对应本文 §1–§3：采样与混叠、DFT、窗函数、Parseval。
  本仓库的 §3.4「精确 bin」与 §3.5「Parseval 差减」两节都可以在这本书里找到原理。
- **Smith, J. O., _Mathematics of the DFT_**（在线书，CCRMA）。
  §3.2 的各种窗（Hann / Blackman-Harris / Kaiser）系数与旁瓣表在这里最完整。
- **Harris, F. J., "On the Use of Windows for Harmonic Analysis with the DFT",**
  _Proceedings of the IEEE_, 1978。
  这是 4 项/7 项 Blackman-Harris 系数与旁瓣数字的**原始出处**；
  本仓库的 BH-7 系数（`0.2710514…` 等）就是 minimum-sidelobe 那一列。
- **Nuttall, A. H., "Some Windows with Very Good Sidelobe Behavior",** _IEEE Trans. ASSP_, 1981。
  BH-7 的旁瓣 −180 dB 这个数字的出处。
- **Goertzel, G., "An Algorithm for the Evaluation of Finite Trigonometric Series",**
  _American Mathematical Monthly_, 1958。
  尺子 B 的单频探针（本仓库的 `binMagHann`）。

## D.2 合成、振荡器与抗混叠

- ★ **Välimäki, V. & Reiss, J. D., "All About Audio Equalization: Solutions and Frontiers",**
  _Applied Sciences_, 2016（以及同作者关于 fractional delay 的系列工作）。
  分数延迟、插值核与「表长 vs 内容位置」的关系。
- ★ **Välimäki, V., Nam, J., Smith, J. O. & Abel, J. S., "Alias-Free Synthesis of
  Bandlimited Classical Waveforms",** _DAFx_, 2010（以及 Stilson & Smith 的
  **BLEP / minBLEP** 工作，_CCRMA_ 技术报告）。
  本仓库 §4.3 的 BLEP/BLAMP 与「修正必须就地」这条纪律的直接理论来源。
- ★ **Brandt, E., "Hard Sync Without Aliasing",** _ICMC_, 2001。
  硬同步的本质（主振重启造成的不连续）与为什么事后修正不行。
- **Smith, J. O., _Physical Audio Signal Processing_** / **_Spectral Audio Signal Processing_**
  （CCRMA 在线书）。
  mipmap/波表、BLIT、以及「带限表 + 插值」的完整推导。
  本仓库 §4.2 的 $1/N^2$ 与其失效条件可以用这本书里的「弦误差」分析对照。
- **Serra, X., "Musical Sound Modeling with Sinusoids plus Noise",** 1997；
  **Roads, C., _The Computer Music Tutorial_**。
  合成法综述（减性/加法/FM/波表/采样），对应本文 §10。

## D.3 滤波器

- ★ **Zölzer, U. (ed.), _DAFX: Digital Audio Effects_**（第 2 版）。
  滤波器章节给出一阶/双二阶、Moog ladder、SVF 的离散化；
  效果章节给出 delay/modulation/reverb 的标准结构（对应本文 §5、§8、§9）。
- ★ **Huovilainen, A., "Non-linear Digital Implementation of the Moog Ladder Filter",**
  _DAFx_, 2004（本仓库 vendored DaisySP ladder 用的模型，`ladder.h` 里引的是
  Huovilainen New Moog, CMJ 2006）。
- ★ **Simper, A., "Solving the Continuous SVF Equations Using Trapezoidal Integration"**
  （以及同作者的 zero-delay-feedback / TPT 系列文章）。
  DaisySP 的「Double Sampled, Stable SVF」与本文 §17.4 的系数直接相关。
- **Smith, J. O., "Virtual Analog Filters" / _Introduction to Digital Filters_**（CCRMA）。
  ZDF/TPT 的一般推导；本仓库 `dsp/ladder.rs` 的 `u = (x − fb·Σ) / (1 + fb·g⁴)` 就是这里的结论。
- **RBJ Audio-EQ-Cookbook**（Robert Bristow-Johnson，rec.audio.pro 存档）。
  本文 §22.2 的三个 EQ biquad 的系数公式出处。
- **Moorer, J. A., "About This Reverberation Business",** _Computer Music Journal_, 1979；
  **Schroeder, M. R., "Natural Sounding Artificial Reverberation",** _JAES_, 1962。
  Freeverb 拓扑的祖先。
- **Gardner, W. G., "Efficient Convolution without Input-Output Delay",** _JAES_, 1995；
  **Wefers, F. & Vorländer, M.** 关于**非均匀分区卷积**的工作。
  本文 §8.2/§20.2 的均匀分区 FDL 的来源与改进方向。

## D.4 实时工程与平台

- ★ **W3C, _Web Audio API_ 规范**（`AudioWorklet`、render quantum = 128 帧、AudioParam k-rate）。
  对应本文 §7.4、§11.1、§24.2。
- ★ **WebAssembly 规范与 `wasm-ld` 文档**（`command`/`reactor` 模块、
  `__wasm_call_ctors`、`--no-entry`、`.init_array`）。
  附录 C.4 的那个 bug 只能靠这套文档解释。
- **ITU-R BS.1770** / **EBU R 128**（响度与真峰值）。
  本仓库**没有**实现它们（本文多处明确写「无 LUFS」），
  但要理解「为什么用乐句 RMS 取代它」以及「真峰值表应该怎么做」，必须读这两份标准。
- **DaisySP** 文档与源码（`daisysp`，MIT）。
  本仓库 vendored 的 `Oscillator` / `Svf` / `Adsr` / `Chorus` / `Flanger` / `Phaser` /
  `Overdrive` 的原始实现。
- **Soundpipe** 文档与源码（MIT）。
  本仓库历史用过、后来替换为自持 Rust 实现（delay / reverb / comb）的模块。

## D.5 本仓库自己的一手材料（**最该先读的**）

按「信息密度 ÷ 长度」排序：

| 文档 | 内容 | 本文引用它的位置 |
| :-- | :-- | :-- |
| ★ `docs/notes/band-limited-oscillators.md` | 波表/采样带限的**全部**实测与两次归因修正 | §4.1–4.2、§14、§15、§16.4、附录 C.1/C.2 |
| ★ `docs/notes/hard-sync-aliasing.md` | 硬同步的**三次修正两次失败**与窄窗 bug | §4.3、§10.3、§16、附录 C.1/C.2 |
| ★ `docs/notes/oversampling.md` | 2× 抽取器选择、两条测量教训、逐节点 PDC | §4.4、§4.5、§9.2、§19.6 |
| ★ `docs/notes/loudness.md` | `VOICE_GAIN` +6 dB 的完整取舍矩阵与重标定表 | §6.4、§23.4、§23.5 |
| ★ `docs/notes/wasm-ladder-root-cause.md` | **wasm 全局构造器** bug 的完整取证与三层修复 | 附录 C.4 |
| `docs/notes/performance.md` | bench 历史表与宿主负载口径 | §29.6 |
| `docs/notes/preset-fingerprint.md` | 指纹容差的标定过程与重录政策 | §28.3 |
| `docs/notes/visual-regression.md` | 阈值标定、mask 与假红的判读 | §31.4 |
| `docs/notes/compat.md` | 跨引擎脆弱性、WebKit 的两个**被推翻的前提** | §31.4、附录 C |
| `docs/notes/sem-filter.md` / `dual-filter.md` | 连续多模与双级路由的三个坑 | §17.4、§17.5 |
| `docs/notes/fx-graph-modulation.md` / `fx-multi-instance.md` / `fx-templates.md` | 图调制、效果池的容量论证、模板白名单 | §18.4、§19.5、§19.7 |
| `docs/notes/p122-presets.md` | 内容包重构、`PATCH_TRIM` 迁移、`crushbass` | §30.2 |
| `docs/notes/teaching.md` | 练习评分的公式与边界 | §24、附录 C |
| `docs/notes/bundle-budget.md` / `release.md` / `nightly.md` | 体积口径、发布 8 步、夜间套件 | §11.5、§31.3 |
| `docs/NEXT-PLAN-2.md` §一 | **36 条**带实测数字的技术债清单 | 全文的「已知边界」 |
| `docs/NEXT-PLAN-2.md` §三 | 逐批实测数字与自证记录 | §23.5、§28、§29 |
| `docs/LLM-INTERFACE.md` | 把本文的尺子抽成工具契约的设计（P13） | §31.5 |

---

## 附记：本文档自身的「未验证」清单

诚实起见，把本文中**标注为未验证/未实测**的点集中列出：

| 项 | 状态 |
| :-- | :-- |
| 量化噪声的 SQNR 公式（$6.02b + 1.76$） | 教科书结论，**本仓库没有独立门禁** |
| 标准真峰值表（ITU-R BS.1770 / EBU） | **未实现**；只有相邻样本均值估计 |
| LUFS / integrated loudness / crest factor | **全仓无度量**（grep 无匹配） |
| IMD（互调失真） | **无门禁** |
| 相位器的 `poles` 参数取值 | **未在 UI 暴露，具体值未验证** |
| 采样级 8（速率 128–256×）的实测地板 | **无门禁覆盖**（只覆盖键盘之外） |
| 硬同步 44.1/96 kHz 的包络周期 | **没有定量解释**（模型与实测不符） |
| `host` 与 `wasm` 在 2× 硬削波路径上差 16 dB 的**逐条**归因 | 笔记里是**定性判断**（指向 codegen / `f32::exp2` 末位差异），无反汇编/末位统计 |
| VU 表在 (−48, −60] 区间的精确行为 | **未逐行验证** |
| `ladder.rs` 注释「~4 dB」与 `PASSBAND_TRIM = 0.5` 的对应关系 | **注释与数学不符**（$20\log_{10}0.5 = −6.02$ dB）；当前常数是 1.0 |
| `docs/notes/wasm-ladder-root-cause.md` 第 3 行「shipped DSP is unchanged」 | **过时**（同日提交已实施 root fix） |
| `engine.rs` 测试模块注释「graph's 2x node path is held *off*」 | **陈旧**（代码与测试都表明它**开**） |
| `verify-presets.mjs` 文档串「eighty factory presets」 | **过时**（当前 91） |
| `preset-loudness.test.ts` 注释「Achieved 6.0 dB (was 47)」 | **过时**（+6 dB 后实测 8.1 dB，门禁 <9.0） |
| 相位表 bug 的代价：**30 dB**（源码）vs **31 dB**（笔记） | 两处口径不同 |
| `crushbass` 只抬 `PATCH_GAIN` 的 spread：**9.6 dB** vs **19.8 dB** | 两处笔记数字不同（结论一致：都破 9.0 线） |
| +6 dB 后库中位 RMS：**−34.04** vs **−34.03** dB | 0.01 dB 舍入差 |
| `wavetable.rs` 注释「worst factory bank … −105 dB」vs 门禁笔记实测 **−98.0 dB** | 口径/音符集可能不同，**未逐条对齐** |
| 采样 mip 级长的公式：`SR / 2^(1+log2(1/ν)−k)` / `SR / 2^(k+1)` / `SR / 2^(k-1)` | **三处写法不一致，我未独立推导判定**（§15.3、§32.3） |
| `osc1Wave`/`osc2Wave`/`filterType` 的 AudioParam 量程窄于引擎枚举 | **代码级已确认**（`engine.ts` 显式钳位）；**浏览器里的听感后果未验证**（§32.1） |

