# SEM 连续多模：一个 SVF，四个规范点，和两种会骗人的检查

## 是什么

P6.3a 给主滤波加了一个 `sem` 档：**12 dB/oct 的连续多模**。它还是 C 桥接层里那一个
`daisysp::Svf`（`gs_daisy.cpp`），只是不再从 `Low()/Band()/High()` 里挑一路输出，而是按
`FILTER_MORPH`（参数 id 145，0..1）把三路混起来：

| morph | 响应 | 权重 |
| :--- | :--- | :--- |
| 0 | 低通（SVF 的 Low） | `L` |
| 1/3 | 带通 | `B` |
| 2/3 | **陷波**（`L + H`，中心处精确抵消） | `L + H` |
| 1 | 高通 | `H` |

段内是直线：

```c
m <= 1/3 : (1-t)*L + t*B              // t = 3m
m <= 2/3 : (1-t)*B + t*(L + H)        // t = 3m - 1
else     : (1-t)*(L + H) + t*H        // t = 3m - 2
```

陷波为什么必须单独摆一个点：`winding L 与 H 的权重在「两条直线」的写法下互为相反数`
（`wL = 1-2m`、`wH = 2m-1`），于是 `L + H` 永远取不到——而 `L + H` 正是离散 `NT` 的响应
（中心处 `L(ω₀) = -jQ`、`H(ω₀) = +jQ`，完全抵消）。第一版就是这么写的，被验收里的
「LP/HP/BP/NT 连续可变」挡下了。

端点是不是「原来的 LP」？**不是，也不可能是**：离散 `lp` 是 Moog 阶梯（24 dB/oct），
`sem` 的 0 是 SVF 的 12 dB/oct 低通。UI 的小标签写 `12dB/OCT · LP→BP→NT→HP`，
测试里也只把 `sem` 的 1/3 与 1 拿去和离散 `BP`/`HP` **逐位**比较（同一个 SVF 的同一路输出），
陷波按舍入级比较（DaisySP 的 `Notch()` 走 `notch_`，不是 `low_ + high_`）。

## 两条会骗人的检查

**1. 别在默认音色上量截止频率。** 默认补丁的调制矩阵里有两路**开着**的
`ENV → CUTOFF (0.55)` 与 `LFO → CUTOFF (0.8)`（`params.rs` 与 `src/audio/params.ts` 的
`DEFAULT_ROUTES` 都是如此）。第一版门禁用 `FILTER_CUTOFF = 400` 量斜率，得到的是
「低通端点随频率**上升** 1.3 dB」——量到的是包络对截止的调制，不是滤波器。Rust 测试里
一直有 `for index in 0..MOD_ROUTES { set_route(index, 0, 0, 0.0, false) }` 这一行，原因就在这；
门禁现在也照做（`quietMatrix()`）。清掉矩阵后同一测量是 **−11.96 dB / 两个八度**。

**2. 「缓存齐全、worker 在岗」不等于能离线打开。** 这跟滤波无关，但同一轮里踩到了：
见 `docs/notes/pwa-offline.md`。

## 测什么、在哪测

- **Rust（原生，`cargo test`）**：8 条 `sem_*` 用例——四个规范点的响应（BP/HP 逐位、NT 舍入级）、
  morph 必须是四个 tap 的**精确加权和**（端点先锚定到离散响应，再用引擎自己渲染的 tap 组合，
  与被测代码不共享实现）、两个端点的 12 dB/oct 斜率、中心随 CUTOFF 移动、morph 与 cutoff
  急变不爆音、128/1024 两种块下扫动有界。
- **`scripts/verify-audio.mjs`（真 wasm）**：与上面同源的频域四项 + 时域一项，实测
  `-11.68 dB` / `+12.19 dB`（两个八度）、带通中心比一个八度下高 **17 dB**、
  陷波中心 **−32.4 dB** 且两端相差 −0.4 dB、急变时峰值 0.128、最大相邻样本步进 **0.040**。
- **`e2e/filter.spec.ts`（浏览器）**：`SEM` 才出现 MORPH 旋钮（其余六档不出现，避免假装有用）；
  拖动后分享码能把**档位与位置**带到另一个从没见过的浏览器；手机 390×844 能点到，控件 ≥36 px。

## 兼容

`FILTER_TYPE` 的线格式是追加式：`sem` 在 Rust 里是 **6**（`Formant` 之后），而 C 桥接层自己的
枚举里 `GS_FILTER_SEM = 4`。两者靠**显式映射** `FilterType::bridge_id()` 对齐——
**不要**用 `to_u32() as i32`：`sem` 会被夹成 LP，听起来像功能正常（这正是第一版的状态，
被 Rust 测试逮住）。默认 `FILTER_TYPE` 不是 `sem`，所以旧音色连 `sem_mix` 都不进入；
`test:dsp` 的 `rms 0.030806` 与 `verify:presets` 的 81 个指纹一字未动。
