# GROOVE SYNTH GS-1

工业级 WebAssembly 复音合成器。Rust 实时音频核心运行在 AudioWorklet 渲染线程，
界面复刻并扩展了 `synth_demo.html` 的 UI/UX，支持桌面 / iPad / iPhone，并作为
**完全离线 PWA** 安装使用。

> 设计依据：`prd.md`（Rust + WASM + 块处理 C ABI + 零分配实时线程 + 平滑降级）。
> 交互参考：`../synth_demo.html`（视觉与布局 1:1 复用，控件逻辑重写为 React）。

---

## 1. 快速开始

```bash
npm install          # 依赖（缓存写入仓库内 .npm-cache，适配受限沙箱）
npm run dev          # 先编译 WASM，再启动 Vite (http://localhost:3000)
npm run build        # WASM + 类型检查 + 生产构建 + 生成 Service Worker
npm run preview      # 预览生产构建
npm run package      # 构建并输出 release/ 下的部署包
```

构建依赖：

| 工具 | 版本 | 用途 |
| :--- | :--- | :--- |
| Node.js | ≥ 20 | 前端构建、打包 |
| Rust | stable ≥ 1.80 + `wasm32-unknown-unknown` | DSP 核心 |
| clang | ≥ 16（支持 wasm32） | 交叉编译 vendored DaisySP / Soundpipe |
| `llvm-ar` | 随 LLVM | 归档 C/C++ 目标文件 |

```bash
rustup target add wasm32-unknown-unknown
```

DSP 核心**不依赖任何 crates.io 包**，`cargo build` 可完全离线完成。

---

## 2. 架构总览

```
┌────────────────────────── 主线程 (React + TS) ──────────────────────────┐
│  UI 状态 (store)  →  AudioParam (k-rate, 浏览器负责插值/线程同步)        │
│  键盘 / MIDI 事件 →  MessagePort + Transferable ArrayBuffer (零拷贝)     │
│  AnalyserNode     ←  示波器 / VU 时域数据                                │
└───────────────▲──────────────────────────────┬──────────────────────────┘
                │ 36 频段频谱 (每 ~16ms)        │ AudioParam / 事件
┌───────────────┴──────────────────────────────▼──────────────────────────┐
│                     AudioWorklet 渲染线程 (synth-processor.js)           │
│   1. 读取 k-rate AudioParam → gs_set_param                               │
│   2. gs_process(frames)  动态块 128..1024                                │
│   3. 每块重建 Float32Array 视图 (杜绝 memory.grow 导致的 Detach)          │
└───────────────▲──────────────────────────────────────────────────────────┘
                │ 块级 C ABI (数组指针 + 帧数)
┌───────────────┴──────────────────────────────────────────────────────────┐
│                   Rust 核心 (crates/synth-core → wasm32)                  │
│  VoiceManager (8/16/32 复音 · 平滑偷声 · 弹性降级)                        │
│  ├─ DaisySP 振荡器 (polyBLEP) / Moog 阶梯 / SVF / DC Block  (C++ 块 ABI)  │
│  ├─ Soundpipe reverbsc 混响 + 分数延迟线                    (C 块 ABI)    │
│  ├─ 原生 Rust ADSR / LFO / 调制矩阵 / SIMD 混音 / 软削波                  │
│  └─ 内部 radix-2 FFT 频谱分析 → 36 频段                                   │
│  固定 8 MiB arena 分配器：Rust 与 C 共用，运行期 memory.grow = 0          │
└──────────────────────────────────────────────────────────────────────────┘
```

关键设计（对应 `prd.md` 条目）：

| 原则 | 实现 |
| :--- | :--- |
| 实时无锁 / 零分配 | `src/alloc_arena.rs` 静态 arena，`gs_alloc_violations()` 可观测；`process` 内零分配由测试守护 |
| AudioParam 原生平滑 | 全部参数以 k-rate AudioParam 暴露，浏览器完成插值与线程同步（PRD §5.1） |
| 动态块 FFI | `gs_process(frames)` 支持 128/256/512/1024，`verify-wasm` 逐块验证 |
| 平滑偷声 / 降级 | `voice.rs`：偷声走 4ms 释放 + 待处理队列；`gs_trigger_smooth_downgrade()` 强制超额声部进入 Release |
| SIMD 安全 | stable `core::arch::wasm32` intrinsics + 标量回退，尾部标量处理，无未对齐陷阱 |
| 无 SAB / 无 COOP-COEP | 参数走 AudioParam，事件走 Transferable MessagePort，可嵌入任意 iframe |

### 2.1 与 PRD 的取舍

| PRD 方案 | 本项目实现 | 原因 |
| :--- | :--- | :--- |
| DaisySP `Adsr` | 原生 Rust ADSR (`src/dsp/adsr.rs`) | 需要每声部独立、可临时覆盖的释放时间以实现平滑偷声；已用 6 个单元测试覆盖 |
| `rustfft` | 内置 radix-2 FFT (`src/fft.rs`) | 保持核心零第三方依赖、完全离线可构建；512 点分辨率满足 36 频段显示 |
| Faust | 未引入 | 环境无 Faust 工具链；物理建模非本版本范围 |
| `core::simd` (portable SIMD, nightly) | stable wasm SIMD intrinsics + 标量回退 | 使用 stable Rust 即可复现构建 |

DaisySP / Soundpipe 的源码按上游原样 vendor，仅编译所需模块；详见
`crates/synth-core/vendor/VENDOR.md`。

---

## 3. 设备与交互

| 设备 | 布局 | 交互 |
| :--- | :--- | :--- |
| 桌面 (≥1240px) | 三栏显示区 + 4 列模块网格 | 旋钮拖动/滚轮/双击复位/Shift 微调；QWERTY 键盘演奏；鼠标滑奏 |
| iPad (860–1240px) | 两栏显示区，模块两列 | 触摸拖动、`touch-action:none` 防止页面滚动干扰 |
| iPhone (<620px) | 单栏，键盘自动切为 1 个八度 + OCT 升降按钮 | 安全区适配 `env(safe-area-inset-*)`，按钮 ≥44px 触控目标 |
| 横屏手机 | 压缩显示区/键盘高度 | 隐藏提示栏，保留全部功能 |

### 3.1 可自定义布局

- **悬浮键盘**：演奏键盘固定在视窗最下方（含安全区），可用标题栏的「键盘」按钮或键盘右上角箭头隐藏/显示；隐藏后右下角出现「⌨ 键盘」悬浮按钮。
- **模块折叠**：每个模块标题栏右侧的箭头可收起/展开，收起后只保留标题行，节省纵向空间。
- **拖拽排序**：按住模块标题栏的 ⠿ 手柄拖动，即可把模块放到任意位置（桌面按左右半区插入，手机按上下半区插入）。
- 折叠状态、模块顺序、键盘显隐都会写入 `localStorage`；预设库抽屉底部提供「重置面板布局」。

无障碍：旋钮为 `role="slider"` 且支持方向键/Home；开关为 `aria-pressed`；
频谱/示波器画布带 `aria-label`。

---

## 4. PWA 与更新机制

- `public/manifest.webmanifest`：standalone、maskable 图标、相对 `start_url`。
- `scripts/gen-sw.mjs` 在构建后生成 `dist/sw.js`：以内容哈希作为缓存版本，
  **预缓存整个 app shell**（JS/CSS、WASM、AudioWorklet、字体、图标）。
- 安装时**不**调用 `skipWaiting()`；新版本在后台就绪后由界面弹出
  “新版本已就绪 · 立即更新”，用户点击后才 `SKIP_WAITING` 并重载，
  正在进行的演奏不会被中断。
- 断网后：界面、音色库、DSP、键盘全部可用（无任何外部网络请求）。

---

## 5. 质量门禁

```bash
npm run test:rust    # 43 个 Rust 单元测试（零分配门禁、C/Rust 一致性、模糊测试）
npm test             # 41 个前端测试（含真实 WASM 的 Worklet 集成测试）
npm run test:wasm    # 17 项 Node 端 WASM 集成校验（频率精度、动态块、复音…）
npm run test:dsp     # DSP 回归基线（固定 patch 的 RMS + 12 频段指纹）
npm run lint         # ESLint（typescript-eslint + react-hooks）
npm run build        # WASM + tsc + Vite + SW
npm run verify:dist  # 构建产物校验（资源可达、SW 预缓存完整）
npm run verify       # 以上全部串联
```

CI（`.github/workflows/ci.yml`）在每次 push / PR 上串联 Rust 测试、前端测试、
构建、两套 WASM 门禁、产物校验与 DSP 基线。

覆盖要点：440 Hz / 261.63 Hz 频率精度（施密特触发过零测量）、128–1024 动态块、
复音上限与平滑降级、`process` 期间零分配、释放后归零、频谱能量、预设范围合法性、
Service Worker 预缓存完整性。

---

## 6. 目录结构

```
crates/synth-core/        Rust DSP 核心（零第三方依赖）
  src/engine.rs           块渲染循环
  src/voice.rs            复音 / 偷声 / 降级
  src/dsp/                ADSR、LFO、SIMD、freestanding math
  src/fft.rs              频谱分析
  src/abi.rs              extern "C" 接口
  c_bridge/               C/C++ 块 ABI 桥接 + 无 libc 头文件 shim
  vendor/                 DaisySP / Soundpipe 子集（保留许可证）
src/audio/                WASM 加载、AudioWorklet、AudioParam、事件总线
src/components/           控件与画布
src/panels/               模块面板与布局
src/state/                状态仓库与预设库
src/pwa/                  Service Worker 注册与更新
scripts/                  构建、图标、SW、打包、校验
public/                   manifest 与图标
```

---

## 7. 功能一览（v1.1.1）

- **合成**：双振荡器（6 波形 + 声像）、Moog 阶梯 / SVF 滤波、独立滤波器包络、
  双 LFO、4 路调制矩阵、POLY/MONO/LEGATO + GLIDE。
- **效果**：混响、同步延迟，以及 vendor 自 DaisySP 的合唱 / 镶边 / 移相 / 过载。
- **演奏**：屏幕键盘（滑奏、八度切换）、弯音/调制轮、Web MIDI（力度、CC1、CC64、CC123）。
- **工作流**：67 个工厂预设（搜索/分类/本地保存）、随机音色、`.gs1.json` 导入导出、
  URL 分享、A/B 对比、撤销/重做（Ctrl/Cmd+Z）、离线渲染导出 WAV。
- **双语**：中文 / English 一键切换（预设库底部），语言随布局一起持久化；
  AMP/FILTER ENV 数值可直接输入或滚轮/方向键调节。
- **布局**：模块可折叠 / 拖拽排序、悬浮可隐藏键盘、高对比主题，全部本地持久化。
- **性能**：选择器化 store（拖动旋钮只重渲染该控件）、单 rAF 循环、
  负载过高自动降复音并平滑释放。
- **工程**：CI、DSP 回归基线、NaN/Inf 防护 + 模糊测试、ESLint、版本注入。

## 8. 许可证

本项目代码 MIT（见 `LICENSE`）。第三方组件许可见 `THIRD_PARTY_NOTICES.md`。
