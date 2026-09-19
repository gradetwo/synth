# P7.1 延迟与卷积的多实例：内存模型预研与实测

工作目录 `/home/crow/music/synth`。所有「实测」数字都是下面这段（读
`gs_arena_free_bytes()`，`gs_init(48000, 32)` 之后）跑出来的；「算」出来的数字按
`alloc_arena` 的规则（payload 16 字节对齐 + 16 字节块头）从源码逐项累加，两者互相
印证：

```js
const ex = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync('src/generated/synth_core.wasm')), {}).exports;
ex.gs_init(48000, 32);
console.log(ex.gs_arena_free_bytes(), ex.gs_alloc_violations());
```

## 0. 结论先说

- **卷积**：IR 分区谱（`IrSpectra`）只读共享；每个卷积节点只分配自己的 FDL、
  输入/输出缓冲、变换工作区与累加器（`Convolver`），所以两个节点的尾部互不串音。
- **延迟**：没有可共享部分，池就是「实例数 × 最长时长」。池在 `gs_init` 时
  一次性预留（2 条 × 2.0 s = 1 500 KiB），节点到实例的分配在消息路径上按
  slot 顺序算，音频线程不分配。
- **池上限取 2 + 2**（见 §4 的账）：`bench:long` 的「arena free > 512 KiB」仍有
  1871.5 KiB（3.6 倍余量），未导入 IR 时比改动前还宽裕（§3）；2 个正好是
  「第二个同类节点」与 P7.3 双延迟/并行混响模板需要的数量。
- 未用第二实例的旧音色**逐位不变**：`test:dsp` 仍是 `rms 0.030806`，
  `verify:presets` 仍是 `81 presets unchanged · ABI 8`。

## 1. 基线（改动前的 wasm，v1.93.0）

| 量 | 实测 |
| :--- | ---: |
| `ARENA_SIZE` | 8 388 608 B = 8192.0 KiB |
| `gs_init(48000, 32)` 之后剩余 | 3 595 536 B = **3511.3 KiB** |
| 再 `gs_init` 一次 | 3 595 536 B（无泄漏、无碎片） |
| `gs_alloc_violations()` | 0 |

## 2. 每个节点需要什么状态

`BINS = FFT_SIZE/2 + 1 = 1025`，`MAX_PARTITIONS = 96`，`HOP = 1024`，
`MAX_IR_SAMPLES = 98 304`。

### 2.1 延迟（`dsp/delay.rs`）

| 状态 | 大小（48 kHz，2 s） | 共享? |
| :--- | ---: | :--- |
| 左右两条延迟线 `[Vec<f32>; 2]` | 2 × (96 002 f32，16 对齐 + 16 B 头) = **768 064 B** | 独占 |
| `damp_state[2]`、`index`、`samples`、`target`、`sample_rate` | ≈ 40 B | 独占（没有可共享部分：线内容本身就是状态，ping-pong 还会把左右线互相喂） |

### 2.2 卷积（`dsp/convolution.rs`）

把原 `Convolver` 拆成「共享的 IR 谱」+「每节点的运行状态」：

| 状态 | 大小 | 性质 |
| :--- | ---: | :--- |
| `ir_re` + `ir_im`（IR 分区谱，各 96 × 1025 f32） | 2 × 393 600 = **787 200 B** | 加载后只读，**共享** |
| `scratch`（去直流后的 IR 副本，仅分析） | 393 216 B | 只读，共享 |
| `re` + `im`（分析用 FFT 工作区，2 × 2048 f64） | 32 768 B | 分析用，共享 |
| **共享小计**（5 个 Vec + 头） | **1 213 264 B = 1185.0 KiB** | |
| `fdl_re` + `fdl_im`（输入谱延迟线，各 96 × 1025 f32） | 2 × 393 600 = **787 200 B** | **每节点独占**（尾部不同） |
| `in_l` + `in_r`（滑窗输入，各 2048 f32） | 16 384 B | 每节点独占 |
| `out_l` + `out_r`（上一 hop 湿声，各 1024 f32） | 8 192 B | 每节点独占 |
| `re` + `im`（变换工作区，各 2048 f64） | 32 768 B | 每节点独占 |
| `acc_re` + `acc_im`（分区累加器，各 2050 f64） | 32 800 B | 每节点独占 |
| **每节点小计**（10 个 Vec + 头） | **877 504 B = 857.0 KiB** | |

（原实现把上面全部塞进一个 `Convolver`，共 13 个 Vec、2 057 968 B = 2009.7 KiB。）

## 3. 实测：池的账

| 配置 | `gs_init` 后剩余 | 相对基线 |
| :--- | ---: | ---: |
| 改动前（1 延迟 + 1 整体卷积） | 3511.3 KiB | — |
| 拆分后池 1 + 1（验证拆分本身的开销） | 3478.5 KiB | −32.8 KiB（= 多出的 Vec 头与对齐） |
| 池 2 延迟 + 1 卷积 | 2728.4 KiB | 多一条延迟线 = **768 064 B**（与算出的完全一致） |
| 池 1 延迟 + 2 卷积 | 2621.5 KiB | 多一个卷积节点 = **877 504 B**（与算出的完全一致） |
| **池 2 延迟 + 2 卷积，未导入 IR** | **4770.2 KiB** | 比基线还多 1258.9 KiB |
| **池 2 延迟 + 2 卷积，导入 2 s IR 后** | **1871.5 KiB** | −1639.8 KiB |

两点关键设计决定，都是上面数字逼出来的：

1. **卷积缓冲推迟到第一次导入 IR 时分配**（`gs_ir_import` → 引擎消息路径）。
   没有 IR 的 patch 一分钱不付（4770.2 KiB 比改动前还宽裕），代价是导入路径要能
   失败：`IrSpectra::prepare`/`Convolver::prepare` 用 `try_reserve` 返回 false，
   `gs_ir_import` 回 4（「arena 放不下分区谱」），UI 映射成 `ir.err.noRoom`。
2. **延迟池仍在 `gs_init` 预留**。节点种类是 AudioParam（`FX_CHAIN1..6` /
   `FX_REVERB_MODE`），worklet 在 `process()` 的第一步把它们推进引擎——那是音频
   回调里、`gs_alloc_violations()` 窗口之外，但仍是音频线程。把 2 条线预留掉，
   整条链上就没有任何一处运行时分配。

## 4. 池上限为什么是 2 + 2

| 上限 | 最大常驻（导入 IR 后） | 导入 IR 后剩余 | 判断 |
| :--- | ---: | ---: | :--- |
| 2 + 2（选它） | delay 1500.1 KiB + conv 2898.7 KiB | 1871.5 KiB | 3.6 × 512 KiB 门禁；采样/波表导入仍有约 1.8 MiB 余量 |
| 3 + 3 | 再 +1614 KiB | ≈ 258 KiB | **低于 `bench:long` 的 512 KiB 门禁，不可行** |
| 2 + 3 | 再 +857 KiB | ≈ 1015 KiB | 可行，但再多一个卷积节点对「双延迟 / 并行混响」没有额外价值，且吃掉采样余量 |

产品上需要「第二个同类节点」（NEXT-PLAN 的 P7.3 模板写的是双延迟、并行混响），
2 + 2 正好覆盖；再往上就是拿 arena 换一个用不到的节点。所以上限取 2 + 2，
超出的节点由编辑器禁用并给出原因（见 §5）。

## 5. 实例怎么分给节点

- 引擎持有 `delays: Vec<Delay>`（2 条，`gs_init` 分配）与
  `convolvers: Vec<Convolver>`（2 个，首次导入 IR 时分配）+ 共享 `ir: IrSpectra`。
- `Engine::sync_fx_pools()` 按 slot 0..5 扫描 `fx.chain`：第 n 个 `Delay` 拿
  `delays[n]`；第 n 个「`Reverb` 且 `reverb_mode == 1` 且 IR 已加载」的节点拿
  `convolvers[n]`；再多的节点没有实例（直通）。
- 分配是**按 slot 顺序**的，所以只有一个延迟/卷积节点的旧 patch 永远拿到实例 0，
  逐样本不变。
- UI 用同一规则算「已用」：延迟池剩余可分配时长 =
  `(2 − 延迟节点数) × 2.0 s`，显示在编辑器提示行；池满时该 kind 的选项
  `disabled` 且带原因（`fxg.delayPoolFull` / `fxg.convPoolFull`）。

## 6. 实现后的门禁（实测）

- `gs_alloc_violations()`：0（`bench:long` 与 `verify-wasm` 各测一次）。
- `gs_init` 重入 4 次：arena 0 KB 泄漏（`verify-audio`），`gs_init` 后 4770 KiB 空闲。
- `bench:long`（2026-09-12，宿主机 load 7.9/8 因而计时门禁按设计跳过，只有正确性门禁
  生效）：arena 断言绿（`4770 KB free`）、`0 violations`、`no non-finite samples`、
  `wasm memory 10.5 MB`；打印的平均块耗时 388 µs（非 IR）/ 487 µs（2 s IR），
  对照 `docs/notes/performance.md` 里改动前的 6 s 基线 243 / 333 µs——两个数都带
  宿主机负载，不能当回归结论。
- `test:dsp` `rms 0.030806`；`verify:presets` `81 presets unchanged · ABI 8`。

## 7. 已知取舍

- 导入 IR 后，一个 4 s（`MAX_BASE_SAMPLES = 192 000`）采样的完整导入峰值约
  2.3 MiB，而剩余的 1871.5 KiB 不够：**同时**导入「最长采样 + IR」会比改动前更容易
  失败（改动前两者常驻 3511 KiB）。正常长度的采样（测试与界面用例都是 0.5 s 级）
  不受影响；不导入 IR 时余量比改动前更大。这是 2 + 2 池换来的确定代价，先记在这里。
- 链模式下，含两个同类节点的旧 patch 从「第二条复用同一条线」变成「各自一条线」，
  声音会变；工厂预设与全部测试都没有这种 patch（`verify:presets` 全绿）。

---

生成：P7.1 实现批次（`crates/synth-core` + `docs/notes/fx-multi-instance.md`）。
基线 wasm：改动前的 `src/generated/synth_core.wasm`（v1.93.0）。
