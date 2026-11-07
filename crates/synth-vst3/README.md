# GS1 乐器插件（VST3 + CLAP）

把 GROOVE SYNTH GS-1（`crates/synth-core`）包成乐器插件：VST3 导出（一期）
与 CLAP 导出（二期 ②）是同一插件的两种入口，参数、状态、预设选择器与
渲染核心共用同一套。
网页应用本体不动；插件里不含 MCP 服务。

## 框架选择：nih-plug

- 不需要 Steinberg VST3 SDK，也不需要签 Steinberg 协议。
  `vst3-sys` 是纯 Rust 的 COM 重实现，nih-plug 的 VST3 wrapper 经它导出
  `GetPluginFactory`。
- 依赖钉住 git rev（见 `Cargo.toml`），不跟浮动分支。
- 许可后果（分发时必读）：
  - nih-plug 本体是 ISC。
  - `vst3-sys` 是 GPLv3，且 VST3 导出会链入它：**分发的 VST3 插件二进制受
    GPLv3 约束**。包内必须附 GPLv3、ISC、MIT 三份声明（`scripts/package-vst3.sh`
    把它们拷进 `Resources/`）。
  - **CLAP 单独构建不受 GPLv3 约束**：`cargo build --no-default-features
    --features clap` 不启用 nih-plug 的 `vst3` feature，不链 `vst3-sys`
   （`scripts/package-clap.sh` 以 `nm -D` 验 `GetPluginFactory` 未导出作证）。
    CLAP 产物只附 MIT 与 ISC 两份声明。两产物分开打包、分开声明，不得混装。
  - 仓库其余代码不受影响：网页版不链 `vst3-sys`，插件 crate 是独立二进制。
  - 源码本身仍可用 MIT；GPLv3 约束的是分发的 VST3 插件二进制，不是仓库。

## 引擎：不是纯 Rust，C++ 桥必须进插件

`synth-core` 的主渲染路径经 `extern "C"` 调 vendored DaisySP（C++）与
Soundpipe（C）。两者皆 MIT，可静态链接，但必须署名（见仓库
`THIRD_PARTY_NOTICES.md`：DaisySP，Electrosmith 2020，pin `599511b7`；
Soundpipe，Paul Batchelor 2020，版本 1.8.1）。
`synth-core` 的 `build.rs` 用 clang 编译这些源码；本机没有系统 clang 时，
用 `CLANG` 指向一个按扩展名分发 `.c`（cc）与 `.cpp`（g++）的 wrapper，
`AR` 指向 `ar`。不得把 wrapper 当成 clang 替代品写进正式文档：
它只是本机构建变通，CI 仍用仓库同款 clang/llvm 流程。

## 单例与独占守卫

`synth-core` 的引擎是进程单例（`static ENGINE`），且 C++ 声部状态是全局的
（`gs_voice_*` 只按声部槽索引，没有引擎句柄）。两个 Rust `Engine` 实例会
共享 C++ 声部槽而串声。因此：

- 插件用进程单例 `synth_core::engine::engine()`，不用每实例 `Engine::new()`。
- 一期加进程级独占守卫（`AtomicBool`）：第二个实例 `initialize()` 干净失败，
  不静默串声。守卫在 `deactivate()` 时释放（只约束同一时刻激活的实例）。
- 真正多实例的后续路径是 C++ 桥的声部槽分区（见“二期”）。

初始化：`init(sample_rate, 16)`，与网页引擎默认复音一致。
`reset()` 只做 `all_notes_off()`，不重 `init`（`init` 会分配，不可在音频线程做）。

## 参数映射（单源生成）

TS 参数索引到 VST3 参数的映射必须完整：224 个 TS 参数（`Param` 0–223）
全部进插件，外加 1 个插件本地预设选择器。

- 生成器：`scripts/gen-vst3-presets.mjs`，用 esbuild 打包求值（与
  `scripts/verify-presets.mjs` 同款技术，不做 TS 文本解析）。
- 生成文件：`crates/synth-vst3/src/generated.rs`，头注“GENERATED — do not edit”。
- 生成器强制校验（任一失败即退出非 0）：
  - TS `Param` 枚举值集合 == Rust `params.rs` 的 `id` 常量集合 == `0..223`；
  - 224 个参数名（TS `PARAM_NAMES` 的 camelCase）经 Rust 关键字清洗后唯一；
  - 每个默认值与每个预设 overlay 值都落在最终发射的范围内；
  - 预设 120 条，预设 id 唯一，首预设为 `pluck`（与 `DEFAULT_PRESET` 一致）；
  - 每条预设的 overlay 键都在 `0..223` 内。
- 参数种类判定：
  - 离散（`DISCRETE_PARAMS` 或 `PARAM_SPECS.discrete`）且范围为 `0..1` → `BoolParam`；
  - 离散且范围更宽 → `IntParam`；
  - 其余 → `FloatParam`；`PARAM_SPECS` 标 `curve: log` 的用 `Skewed`，其余 `Linear`。
  - 程序切换直接设原始值，曲线只影响宿主自动化手感，不影响该原始值下的声音。
- 没有 `PARAM_SPECS` 的 id 用覆盖表补范围（写在生成器内并注来源：枚举长度取
  TS 枚举表；钳制取 `params.rs` 的 `set()` 臂；其余取默认值与 overlay 的覆盖区间）。
  引擎在 `set_param` 内钳制，范围只影响宿主自动化手感与显示，不影响声音。
- VST3 参数 id 字符串取 TS `PARAM_NAMES` 的 camelCase（稳定 id）；
  显示名取 `PARAM_SPECS.label`（若有），否则取 camelCase。
- `ParamPtr` 的 set 方法是 `pub(crate)`，插件侧无法经 `param_map` 通用写回；
  因此生成器产出只读的 `PARAM_ACCESSORS` 表（每 id 一个 get 闭包），
  供每块的参数读取与变化检测用。
- 参数同步与预设切换（nih-plug 参数是宿主所有的，只能读不能写）：
  引擎状态是事实源，宿主参数只当作“愿望”。首块无条件应用当前预设，
  并把当时的宿主值记为基线；此后每块只把相对上一块变化了的宿主值推给
  引擎（连续参数由引擎内平滑决定，离散参数步进）。预设切换前残留的宿主旧值
  等于基线，不会被误当成新愿望推回引擎。预设选择器本身是宿主参数，
  故宿主存取状态时选择器总能正确恢复。
- 已知 v1 局限：预设切换后在宿主界面上再拧的参数只活在引擎里，
  宿主存取状态时存的是切换前的旧参数值，重开后这些拧动会丢（预设本身总能恢复）。
  关闭该缺口要靠自定义状态块（`PluginState`）或带 `set_parameter` 写回的编辑器，
  列为二期，不在本期硬凑。
- 路由恒用 `DEFAULT_ROUTES`（工厂预设无自定义路由），但用**引擎正确的 Rust 路由码**
  （见下节），不是 TS 字符串也不是 TS 顺序整数。

## 路由码：TS 与 Rust 顺序不一致（已实测，插件走 Rust 码）

Rust `ModSrc::from_u32` 顺序：`lfo=0, env=1, modwheel=2, velocity=3, lfo2=4,
aftertouch=5, random=6, keytrack=7`。
TS `MOD_SOURCES` 顺序：`lfo=0, lfo2=1, env=2, modwheel=3, velocity=4, aftertouch=5,
random=6, keytrack=7`。两者在 lfo2/env/modwheel/velocity 四处错位。
`ModDst` 两边顺序一致（`cutoff=0, pitch=1, volume=2, pwm=3, pan=4, res=5, fm=6,
ring=7`）。

插件发射的 `DEFAULT_ROUTES`（Rust 码）：

| 槽 | src | dst | amount | enabled |
|----|-----|-----|--------|---------|
| 0 | 0 (lfo) | 0 (cutoff) | 0.8 | true |
| 1 | 1 (env) | 0 (cutoff) | 0.55 | true |
| 2 | 0 (lfo) | 1 (pitch) | 0.18 | false |
| 3 | 2 (modwheel) | 0 (cutoff) | 0.4 | false |

另有一件仓库现状（本插件不修，只记录）：指纹脚本与网页 worklet 路径都把
字符串路由直接传给 `gs_set_mod_route`（wasm i32 参数），Node 实测字符串会
coerce 成 0，因此仓库的指纹基线与网页实际渲染中，全部路由都落在
`src=0, dst=0`（只有 Lfo→Cutoff 两槽在响）。指纹测试复现基线条件（含该行为）
以便比对；路由正确性另由独立测试断言（生成表 + 引擎 `params.routes` 回读）。
是否修仓库的路由传递，由仓库负责人另立项定。

## 预设：program 列表的落差

nih-plug 不支持原生 VST3 program 列表（其 `IUnitInfo` 实现中
`get_program_list_count()` 返回 0，并注“TODO: Do we want program lists?
Probably not, CLAP doesn't even support them.”）。
因此一期实现为专用 VST3 参数（`IntParam` 预设选择器，范围 `0..=119`，
开机值 0 = `pluck`），不是原生 VST3 program 列表。宿主通用界面里它就是一个
可自动化的整数参数；二期自定义编辑器再做 program 下拉。

预设切换语义（只写引擎，不写宿主参数，原因见上）：

1. 复位到 `DEFAULT_PARAMS`（全部 224 个值）；
2. 叠加该预设的 overlay 对；
3. 设路由为 `DEFAULT_ROUTES`。

宿主通用界面在切换后仍显示旧参数值（nih-plug 不允许插件侧写回），
这是框架约束，不是 bug；声音以引擎为准。选择器本身不是 TS 参数，
不参与 overlay。

## MIDI 映射

`MIDI_INPUT = MidiConfig::MidiCCs`（要收 pitch bend 与 CC，必须用该档；
VST3 wrapper 会为此加绑定参数，属框架实现细节）。

| 事件 | 映射 |
|------|------|
| NoteOn | `note_on(note, velocity)` |
| NoteOff | `note_off(note)` |
| Choke | `note_off(note)`（实为 release，不是瞬时 choke；引擎无 choke 入口） |
| MidiPitchBend | `pitch_bend((value - 0.5) * 2)`（归一化轮值；引擎在渲染时再乘 `PITCH_BEND_RANGE`，范围只应用一次。注意：引擎 setter 与 ABI 的 `semitones` 参数名是误导，网页端自己就是因此 double 应用（先乘范围再进字段，渲染时又乘一次）；插件不复制该行为） |
| MidiCC 1 | `mod_wheel(value)` |
| MidiCC 123 | `all_notes_off()` |
| MidiChannelPressure | `aftertouch(value)` |
| 其余 CC、PolyPressure | 忽略（引擎无逐音压力 API；CC64 sustain 无公开入口） |

事件按时序切分宿主缓冲：事件在段首应用，再渲染该段；每段按
`MAX_BLOCK_SIZE`（1024）分块调 `engine.process`，拷 `left()`/`right()` 到
立体声输出。无音频输入。`process()` 返回 `KeepAlive`（混响/延迟尾巴不定长）。

## CLAP 导出（二期 ②）

同一插件的第二种入口，`nih_export_clap!`（同 rev `de42101` 的
`src/wrapper/clap.rs` 已支持；`clap-sys` 钉 rev `25d7f53`，见
`Cargo.lock`）。CLAP ID `dev.gradetwo.gs1`，特性
`instrument` + `synthesizer`。参数（224 TS 参数）、状态、预设选择器与
VST3 同一套；与 VST3 共用同一 Engine 核心，不另起一引擎。渲染路径与
VST3 完全相同，指纹测试（直接驱动 `render_with_events`）对两种导出
同时覆盖。

Feature 开关（`crates/synth-vst3/Cargo.toml`）：默认 `vst3`（与一期相同）；
`clap` 只加 CLAP 导出；两者可同开。CLAP 单独构建：
`cargo build --release --locked --no-default-features --features clap`，
不链 `vst3-sys`（见“许可后果”）。

包布局（Linux x86_64）：

```
dist/
  GS1.clap             # 单文件 CLAP 插件（cdylib 改名），scripts/package-clap.sh 产出
  GS1.clap-licenses/
    LICENSE-MIT
    LICENSE-ISC-nih-plug
    ATTRIBUTION.md    # DaisySP / Soundpipe 署名（无 LICENSE-GPLv3，CLAP 构建不链 vst3-sys）
```

打包脚本 `scripts/package-clap.sh [out-dir]`（默认 `dist/`）构建 CLAP-only
release cdylib、复制上布局、用 `nm -D` 验 `clap_entry` 已导出且
`GetPluginFactory` 未导出（后者缺失即许可分拆的证据；任一失败即退出非 0），
最后打印文件、字节数与 `GS1.clap` 的 sha256。CI 在 `verify` 任务里跑该脚本
（“CLAP plugin build (release)”一步；CLAP 构建无编辑器依赖，不需 X11/GL
开发包）。

弯音走法（实现时按 CLAP 规范与 nih-plug 支持定）：**走 CLAP MIDI 事件，不走
note expression**。该 rev 的 CLAP wrapper 的 note-expression 匹配没有
`CLAP_NOTE_EXPRESSION_PITCH_BEND` 臂，宿主发的弯音 expression 会被丢弃；
而 `CLAP_EVENT_MIDI`（状态 `0xE0`）经 `NoteEvent::from_midi` 解析为同一
`NoteEvent::MidiPitchBend`（归一化 `[0, 1]`，`0.5` 为中心），与 VST3 路径
共用 `process()` 里的翻译（`pitch_bend((value - 0.5) * 2)`，范围只应用一次）。
逐音弯音 expression 须等 nih-plug 补该臂，本项不支持，不谎称支持。

验证诚实口径：本机无 CLAP 宿主；`clap-validator` 须另行获取（不在仓库内）。
本项验证做到构建 + `clap_entry` 导出 + `cargo tree` 验无 `vst3-sys` +
15 项一期测试全绿（指纹绿即渲染路径未变）+ 2 项 CLAP 描述符测试；
validator / 真实宿主加载的实际结果见实施报告，不称“宿主验证通过”。

## 包布局（Linux x86_64 一期）

```
GS1.vst3/
  Contents/
    x86_64-linux/
      GS1.so            # 由 cargo 产出的 libsynth_vst3.so 复制改名
    Resources/
      LICENSE-MIT
      LICENSE-ISC-nih-plug
      LICENSE-GPLv3     # vst3-sys（VST3 导出链入）
      ATTRIBUTION.md    # DaisySP / Soundpipe 署名（见仓库 THIRD_PARTY_NOTICES.md）
```

打包脚本：`scripts/package-vst3.sh [out-dir]`（默认 `dist/`），构建 release
cdylib、组装上布局、复制 `crates/synth-vst3/licenses/`、用 `nm -D` 验
`GetPluginFactory` 导出（缺失即失败），最后打印包内文件、字节数与
`GS1.so` 的 sha256。构建用 `CLANG`/`AR` 环境变量（无系统 clang 的机器
上须指向能同时编 C 与 C++ 的编译器驱动）。
`moduleinfo.json` 一期不做。macOS/Windows 包布局只写后续路径，不在本期做；
Windows 侧另有第三方乐器在夜半宿主上测试，与本插件无关，不得算作本插件
的 Windows 验证。

## 测试

- `tests/params.rs`（纯表，不碰引擎）：参数 224 条、id 全覆盖、预设 120 条、
  预设 id 唯一、首预设 `pluck`、每 overlay 值在范围内、路由表等于上表。
- `tests/fingerprint.rs`（碰引擎，每预设一个全新子进程渲染）：
  严格复现 `verify-presets.mjs` 的渲染条件（48 kHz、复音 16、128 帧块、
  1.8 秒、乐句 `[60,64,67]@0` 持 0.7 秒 + `55@0.8` 持 0.9 秒、速度 0.9、
  左声道 Goertzel 24 条三分频），与 `tests/preset-fingerprint.json`（1x）与
  `tests/preset-fingerprint-2x.json`（2x，预设应用后强制 `OVERSAMPLE=1`）比对。
  容差与仓库脚本一致：rms 0.25 dB、peak 0.5 dB、stereo 0.25 dB、每频带 0.5 dB，
  `severity = delta / tolerance`，`> 1` 即失败。
  基线渲染条件含字符串路由→0 的实际行为，测试复现该条件（见“路由码”一节）；
  插件本体仍用正确 Rust 路由码，两者由不同的测试覆盖，不得混淆。
  子进程是必需的：基线是每预设全新 wasm 实例，而进程级 C++ 状态在
  全新 `Engine` + `init()` 后仍残留（实测：`reesegrowl` 单个就能脏掉下一个
  预设的渲染）；子进程复现基线条件，插件本体在宿主内从不重初始化，
  预设切换由 `tests/program.rs` 覆盖。
  唯一容差例外：`crushbass` 在 1x 下频带容差 2.0 dB（其余仍 0.5 dB）。
  原因是跨平台 libm 末位差异经 6-bit 量化边界放大，只动 ≤ -97 dB 的
  7 条残留带（实测最差 1.54 dB），rms/peak/stereo 精确、2x 全绿、
  原生渲染逐位确定，属平台浮点差、非逻辑问题（见测试内注释）。
- `tests/midi.rs`：note on/off 输出非静音；力度缩放（大力度 RMS 高于小力度）；
  弯音方向（sine 类预设，Goertzel 在 440 Hz 与 493.88 Hz（+2 半音）处验频移方向）；
  mod wheel（显式启用一条 modwheel 路由后再验输出变化，因默认路由中
  modwheel→cutoff 是禁用的）。
- `tests/program.rs`：切预设后输出变化，且参数值等于目标预设的合并值；
  路由回读等于上表。
- `tests/clap.rs`（只在 `clap` feature 下编译）：CLAP 描述符（ID
  `dev.gradetwo.gs1`、特性 instrument + synthesizer）与“CLAP 与 VST3
  共用 224 参数 / 120 预设”两项断言。渲染由指纹等套件覆盖（两导出共用
  同一渲染路径）。

## 二期（明确不做）

自定义编辑器；macOS/Windows 包；真正多实例（C++ 声部槽分区）；
`moduleinfo.json`；采样/波表/IR 导入
（`WT_USER`/`SMP_*` 参数一期存在但无导入数据时不生效）；sustain 与 poly pressure；
参数显示格式打磨（单位、值转字符串）；自定义状态块（`PluginState`），
用以在宿主存取状态时保住预设切换后的参数拧动（见“参数同步与预设切换”）。
CLAP 导出已在本项做完（见上节）；自定义编辑器与真正多实例在二期他支，
不在本支树上。
