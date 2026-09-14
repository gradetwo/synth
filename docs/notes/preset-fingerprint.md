# 预设指纹：81 个音色 × 2 种模式，各 26 个数字

## 为什么还要一道门禁

现有两道声音门禁各看一半：

- `scripts/dsp-baseline.mjs`（`npm run test:dsp` / `npm run verify:dsp:2x`）只盯**一个**固定音色
  （rms + 12 个频点，容差 1e-4），但已经分 1× / 2× 两份；
- 响度测试（`src/audio/preset-loudness.test.ts`）只看 81 个预设**有多响**（跨度 < 9 dB）。

中间那一大片是空的：把某个预设的滤波包络指向别处、把 detune 换成环形调制、波表索引差一位——响度可能几乎不变，而 DSP 指纹根本没在看那个音色。所以再加一道：

`scripts/verify-presets.mjs`（`npm run verify:presets`）把**每一个工厂预设**都过一遍同一句乐句，记录 26 个数字：

| 字段 | 含义 |
| :--- | :--- |
| `rms` / `peak` | 整段的电平与峰值（dB） |
| `stereo` | 右/左 rms 之比（dB）——声像、unison 展开、混响宽度变了会露出来 |
| `bands` | 24 个三分倍频程频点（50 Hz … 10 kHz）的 Goertzel 幅度（dB） |

乐句是固定的一小段：C 大三和弦（60/64/67，各 0.7 s）+ 0.8 s 起的低音 55（0.9 s），总长 1.8 s。每个预设都用**全新的 wasm 实例**渲染（共振峰/延迟/混响的残留状态不会串台），跑法与 `store.applyPreset` 一致：`presetParams` → `gs_set_param`、`presetRoutes` → `gs_set_mod_route`，带第二层的预设再走 `gs_set_param_inst` + `gs_set_instance_route`。

## P11.4：2× 过采样也要一份指纹

到 P11.3 为止，2× 只有 `tests/dsp-baseline-2x.json` 那**一个**固定音色。过采样改的正是饱和滤波那条路，所以「某个预设只在 2× 下坏掉」以前完全没人看。

`--oversampled` 让同一个脚本再跑一遍全部 81 个预设，把 `Param.OVERSAMPLE` 强制为 1（实例初始化后设一次，
它是全局开关、不是每层参数），指纹写进 `tests/preset-fingerprint-2x.json`——和 1× 同一套乐句、同一套频点、
同一套容差、同一行一个预设的格式，外加一个 `"oversampled": true` 字段和它自己的 `reason`。

两份基线**互不派生**：同一份 wasm 上 81 个预设里有 **80 个**在 1× / 2× 之间就有数值差异，
最大 **43.871 dB**（`wtmetal`，过采样把它的饱和路径彻底改了）；只有 1 个预设两种模式逐位相同。

### 覆盖范围与运行时间

**全量 81 × 2**，没有抽样——实测合并约 34 s，远低于 60 s 的抽样门槛：

| 命令 | 覆盖 | 实测 |
| :--- | :--- | :--- |
| `npm run verify:presets` | 81 预设 × 1×，`tests/preset-fingerprint.json` | **13.449 s** |
| `npm run presets:update:2x -- --reason "…"` | 81 预设 × 2×，首次写基线 | **20.771 s** |
| `npm run verify:presets:2x` | 81 预设 × 2×，`tests/preset-fingerprint-2x.json` | **20.604 s** |

2× 更慢是因为每个预设真的多跑了一遍过采样渲染。两次相加 ≈ 34 s，`npm run verify` 多付这一份。

## 怎么跑、怎么确认

```bash
npm run verify:presets                                     # 1× 门禁（也在 npm run verify 与 CI 里）
npm run verify:presets:2x                                  # 2× 门禁（同上）
npm run verify:presets -- --report                         # 只看动了多少（不问对错）
npm run presets:update -- --reason "为什么 1× 音色变了"      # 接受新 1× 基线
npm run presets:update:2x -- --reason "为什么 2× 音色变了"   # 接受新 2× 基线
```

- **`--update` 必须给 `--reason`**，理由写进基线文件。改预设的音色是决定，不是 diff，所以让它在文件里留名。
  `--oversampled --update` 缺理由时会直接告诉你用 `presets:update:2x`。
- 基线在 `tests/preset-fingerprint.json` 与 `tests/preset-fingerprint-2x.json`，**每个预设一行**，
  所以指纹变化在 review 里就是一行 diff。
- 参数 ABI 变了（`abi` 字段）会先报错并让你重新生成：`gs_set_param` 的 id 含义变了的话，旧指纹本来就没有意义。
- 1× 单次约 13 秒、2× 约 21 秒（都含 esbuild 打包预设定义的那一步）。

## 敏感度：实测标定

全部针对 `pluck` 预设（`FILTER_CUTOFF: 5200`、`ENV_DECAY: 0.13`、`OSC1_LEVEL: 0.7`），单次运行取「最大偏移 / 容差」：

| 改动 | 最大偏移 | 比值 | 结果 |
| :--- | :--- | :--- | :--- |
| 截止频率 −1 %（5200 → 5252） | 0.147 dB @10 kHz | 0.29 | 通过 |
| 电平 −1 %（0.7 → 0.693） | 0.052 dB（rms） | 0.21 | 通过 |
| 截止频率 −5 %（5200 → 4940） | 0.836 dB @10 kHz | 1.67 | **失败** |
| 包络衰减 +5 %（0.13 → 0.1365） | 0.887 dB @3.2 kHz | 1.77 | **失败** |
| 截止频率 −10 %（5200 → 4680） | 1.593 dB @10 kHz | 3.19 | **失败** |
| 电平 −5 %（0.7 → 0.665） | 0.265 dB（rms） | 1.06 | **失败** |
| 一批预设的截止频率各改 10–25 %（误伤实验，见下） | 最大 47 dB | — | **失败** |

也就是说：**约 5 % 的预设参数改动会被拦下，1 % 的微调会通过**——后者本来就听不出来，硬要拦只能靠把容差收到噪声级别，那样换一个编译器重建 wasm 就会假红。同一次运行的噪声底是 **0.000 dB**（同一份 wasm 跑两遍，26 个数字逐位相同），所以容差留的余量是给「重新编译的二进制」的，不是给测量的。

顺带一个教训：标定脚本一开始用 `[P.FILTER_CUTOFF]: [0-9]*, [P.FILTER_RES]: 0.35` 这样的宽松正则改文件，结果一次改到了十几个预设，报告里出现 45 dB 的夸张差异。它证明了门禁对真实音色变化很敏感，也提醒标定必须**只改一处**（后续改成整行唯一匹配）。

## P11.4 自证：改一个预设参数，两种模式都必须红

`pluck` 的 `FILTER_CUTOFF` 5200 → 4680（−10 %），真实源码改动，两条门禁的原文输出：

```
########## 1x gate (must be RED)
[presets] REGRESSION detected:
  pluck: 7943Hz -133.012 -> -128.641 dB, 10000Hz -124.403 -> -125.013 dB
[presets] if the presets are meant to sound different now:
[presets]   npm run presets:update -- --reason "why"
########## 2x gate (must be RED)
[presets 2x] REGRESSION detected:
  pluck: 7943Hz -128.084 -> -126.861 dB
[presets 2x] if the presets are meant to sound different now:
[presets 2x]   npm run presets:update:2x -- --reason "why"
```

`git checkout -- src/state/presets.ts` 还原后两条都回到绿：

```
[presets] 81 presets unchanged · ABI 8
[presets 2x] 81 presets unchanged · ABI 8
```

## 为什么是 Goertzel + 三分倍频程，而不是 FFT 峰值

- Goertzel 是 O(N)/频点，24 个频点 × 81 个预设 × 1.8 s 只要几百毫秒；FFT 要处理窗、补零和归一化，还容易在不同长度下给出不同的底噪。
- 录基线用的是 `dB = 20·log10(mag)`，直接可比；频点选三分倍频程（比值 1.26），覆盖 50 Hz–10 kHz，比原来那 12 个「80/160/320/640 + 200/500/1000/4000」的混搭更能反映频谱形状——最初 12 频点时，截止频率改 10 % 只有一个频点动了 0.53 dB，正好压在容差上；换成 24 频点后同一改动是 1.59 dB。

## 进了哪些门禁

- 本地 `npm run verify`：`verify:presets`（1×）之后紧跟 `verify:presets:2x`（2×），都在 `verify:audio`
  之后、`verify:bench` 之前。
- CI：`.github/workflows/ci.yml` 的 verify 作业有两步（1× 一步、2× 一步）；`scripts/verify-ci.mjs`
  的必需步骤清单里也各有一条，所以这条承诺被守卫盯着——删掉 CI 里任一步会立刻让 `verify:ci` 失败。
- 跨平台安全：渲染是 wasm + JS 双精度算术，与宿主字体/GPU 无关，所以它和视觉回归不同，可以在 CI 里跑。

## 维护

- 加了新预设：两条 `--update` 都会多出一行 `"newid": {...}`，确认它就该是那个音色。
- 删了预设：报 `preset removed`，同样要 `--update`。
- 改了 DSP 但预设没变：`verify:presets` / `verify:presets:2x` 会告诉你哪些预设的频谱动了——这正是它的用途；
  如果动得对，`--update --reason "..."` 把新音色写下来，顺便在理由里写清是哪个改动导致的。
- 只改了过采样路径：通常只有 2× 会红，这时只更新 2× 基线，并在理由里写清。

## P9.7：波表 mip level 改全长（只有 4 条预设真的变了）

P9.7 把波表的每个 mip level 都改成**全长 2048 点**（只按八度降低谐波上限，不再抽取变短），
并把采样读位置/步进改成 f64、插值器改成 4 点三次。这是**相容红线级**改动，用户 2026-09-14
已授权改音色 + 重录全部指纹，所以 1×/2× 两份都按协议重录：

```
npm run presets:update    -- --reason "<见下>"
npm run presets:update:2x -- --reason "<同一句>"
→ [presets]     baseline written (--update) · 81 presets · ABI 8
→ [presets 2x]  baseline written (--update) · 81 presets · ABI 8
```

两份基线里写进的 `reason` 原文：

> P9.7 波表带限修复：每个 mip level 都改成全长 2048 点、只按八度降低谐波上限（不再抽取变短），
> 读取步进因此很小、线性插值的折回成分消失；采样读取位置与步进改 f64、插值器改 4 点三次。
> ≥1 kHz 波表非谐波能量 −25.8…−46.7 → −98.0…−119.7 dB，采样 −29.9 → −33.4 dB。
> 只有 4 条用到波表的预设（wtorgan/wtvocal/wtmetal/wtglass）音色变化。

**实际重录条数：81 条全部**（`--update` 会整份重写）。其中**真的变了的只有 4 条**，
也就是用到波表的那四条；其余 77 条的最大偏移 ≤ **0.0090 dB**，是「新增的 16 KB 表改变了
堆布局、重编译的二进制」那一档噪声（旧基线是上一次编译录的，容差 1e-4 dB 压不住它），
不是可听变化：

| 预设 | 最大偏移 | 说明 |
| :--- | ---: | :--- |
| `wtglass` | 2.604 dB | 波表 glass bank，5012–10000 Hz 折回成分下降 |
| `wtmetal` | 1.175 dB | 波表 metallic bank（还带动 rms −32.444 → −31.861 dB） |
| `wtvocal` | 0.838 dB | 波表 vocal bank |
| `wtorgan` | 0.793 dB | 波表 organ bank |
| 其余 77 条 | ≤ 0.0090 dB | 重编译噪声，无音色变化 |

采样那层在预设渲染里没有采样内容可读（采样是乐器级导入状态，预设只决定放不放它），
所以采样路径的改动**没有**体现在指纹里；它的证据在 `verify:audio` 的采样行（−29.9 → −33.4 dB）
与 `docs/notes/band-limited-oscillators.md` §P9.7。重录后两条门禁都回到

```
[presets] 81 presets unchanged · ABI 8
[presets 2x] 81 presets unchanged · ABI 8
```

`test:dsp` 保持 `rms 0.030735`、`verify:dsp:2x` 保持 `0.030852`（默认音色是锯齿，
不走波表路径），所以**没有**重录 DSP 基线。
