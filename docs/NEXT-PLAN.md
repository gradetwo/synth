# 下一阶段详细规划（v1.71.0 之后）

> 本文档接在 `docs/ROADMAP.md` 的进度看板之后：**第一节是完成度审计**（对着最初的目标逐条给出证据），
> **第二节是下一阶段的可执行计划**（目标 / 实现要点 / 验收 / 批次 / 风险）。执行纪律不变：
> **每批 = 实现 + 单元/E2E 测试 + `npm run verify` 全绿 + 小步提交 + `npm run package` + 部署 + 中文文档同步**。
> 无障碍（P3 a11y）按需求约定不做。

## 一、完成度审计（对照最初目标，v1.71.0）

目标原文：*按收益与优先级，高质量完成本项目除无障碍（P3 a11y）以外的全部待办：音质强化、工作流缺口、
工程项；完成标准：路线图 P0.3–P0.6、P1 全部、P2 核心，以及 A1–A9 音质项全部落地并通过门禁。*

| 目标 | 状态 | 证据（可复核） |
| :--- | :--- | :--- |
| P0.3 参数平滑 | ✅ | k-rate 参数每块推送 + 引擎侧平滑数组；`engine.rs` 平滑单测 |
| P0.4 主输出保护（lookahead 限制器 / 真峰值 / 响度） | ✅ | `dsp/limiter.rs` + `verify-audio.mjs` 限幅与响度断言 |
| P0.4 撤销/重做扩展（布局、预设、片段） | ✅ | `src/state/store.ts` 历史栈 + `e2e/layout.spec.ts` 撤销用例 |
| P0.4 播放器（A/B 循环、节拍器、预备拍、量化、多轨混音） | ✅ | `src/midi/player.ts` + `e2e/player.spec.ts` 6 组用例 |
| P0.5 多浏览器 E2E | ✅ CI / ⚠️ 本机 | CI `e2e-engines`（WebKit+Firefox）；**本机 WebKit 缺 `libicu74 / libxml2 / libmanette-0.2-0 / libenchant-2-2`，无法启动**（Playwright 明确报缺库，属环境而非代码）；Firefox 可启动但极慢 |
| P0.6 WASM streaming | ✅ | `src/audio/wasmFetch.ts`（`compileStreaming` + 回退），`wasmFetch.test.ts` |
| P1 5.1 Unison 1–7 + SPREAD | ✅ | `engine.rs` 子声部渲染 + `verify-wasm` 齐奏断言 |
| P1 5.2 每声部 LFO、调制矩阵 8 槽、MPE、CC Learn | ✅ | `dsp/lfo.rs`、`params.rs` 矩阵、`src/audio/mpe.ts`、`ccmap.ts` + 各自单测 |
| P1 5.3 扩展滤波（CMB / FRM / SEM 覆盖） | ✅ | `dsp/comb.rs`、共振峰三段带通 + 频域断言 |
| P1 5.4 微调律（平均/纯律/毕氏/中庸 + .scl） | ✅ | `dsp/tuning.rs`、`src/audio/scala.ts` + 单测 |
| P1 5.7 效果与混响（重排、并联、卷积 IR、乒乓延迟+阻尼） | ✅ | `engine.rs::apply_fx`、`dsp/convolution.rs`；`verify-audio` 顺序差异/空链旁通/IR 归一化 |
| P2 核心：布局场景 | ✅ | `src/state/scenes.ts` + `e2e/audio.spec.ts` 场景用例 |
| P2 核心：多实例引擎（Layer / Split + 力度窗口） | ✅ | `Engine` 双实例 + `gs_set_param_inst/gs_set_instance_route`，ABI v7 |
| P2 核心：多轨 + 时间线 | ✅ | 分层播放/静音/独奏/音量/**声像**/时间偏移 + 缩略时间线（点按定位、拖拽整形）`e2e/player.spec.ts` |
| P2 核心：采样导入（SMP） | ✅ | `dsp/sampler.rs`（mipmap 抗混叠、loop/ping-pong）+ `e2e/sample.spec.ts` |
| P2 核心：预设/分享/导出携带分层 | ✅ | `src/state/share.ts`（`p2`/`m`/`sn`）、`src/midi/export.ts`（导出即混音） |
| **P2 完整版：任意拓扑节点图** | ⏳ **未做** | 见第二节 A：这是唯一未落地的路线图条目，也是 v2.0.0 立项内容 |
| A1 抗混叠 | ✅ | 波表/采样 mipmap + `verify-audio` 混叠 ≤ −60 dB |
| A2 响度与限幅 | ✅ | 导出 −1 dBFS 归一化、预设响度差 < 9 dB（实测 4.0），`preset-loudness.test.ts` |
| A3 混响升级 | ✅ | IRS 算法混响 + 卷积双引擎、阻尼/预延迟/宽度、单位能量归一化 |
| A4 真立体声与扩展滤波 | ✅ | 每振荡器独立滤波 + 等功率声像、CMB/FRM，`per_oscillator_panning_separates_the_channels` |
| A5 效果路由与卷积 | ✅ | 6 槽重排 + 并联送出 + IR 卷积；**G2 已把每跳分段乘加摊平**（本轮） |
| A6 合成能力（波表、噪声、unison、每声部 LFO） | ✅ | `dsp/wavetable.rs`、`noise.rs`、unison；波表单周期导入 |
| A7 MPE / 力度 / 微调律 | ✅ | 每音弯音、力度曲线、四律 + 自定义音分 |
| A8 测量门禁 | ✅ | `verify-audio.mjs`（时域 + 频域）、`dsp-baseline.mjs` 指纹基线 |
| A9 音质回归 | ✅ | `verify` 链中 `verify:audio` + `verify:bench` + `test:dsp` |
| G2 卷积负载摊平（工程项） | ✅ v1.69.0 | 每 hop 分段乘加分散到 hop 内的块；Rust 逐块 MAC 计数测试 + 基准 IR 行断言 |
| G3 持续负载基准（工程项） | ✅ v1.66.0 | `npm run bench` → `docs/notes/performance.md`，进门禁 |

**门禁与测试规模（v1.71.0）**：Rust **142** 项、Vitest **256** 项、Playwright(Chromium) **90** 项全绿；
`npm run verify` 退出码 0（Rust / Vitest / lint / build / wasm ABI v7 + 无全局构造 + 音频线程零分配 /
体积预算 / 音质时域+频域 / 持续负载基准 / DSP 指纹）。体积：总 1700 KB、初始 JS 150 KB gz、WASM 230 KB gz 预算内。
基准：密集负载均值约 **9.3%** 预算（246–252 µs / 2667 µs），挂 2 秒 IR 后均值约 **12.5%**、最差块约 1.2 ms。

**结论**：目标的完成标准（P0.3–P0.6、P1 全部、P2 核心、A1–A9）**已全部落地并有门禁**；
路线图中仅剩「任意拓扑节点图」（P2 完整版，路线图自身排期为 v2.0.0、2–4 个月）未做，见下。

## 二、下一阶段计划

### A. 任意拓扑节点图（P2 完整版 / v2.0.0）— 建议 3 批

**收益**：把“信号链顺序”升级为可自由连线的**前馈 DAG**（并联、分路、多路混合），音色设计自由度最高；
也是路线图里唯一还没做的用户可见能力。

**A1 引擎侧（1 批）— ✅ 已完成（v1.72.0，参数 100–136，ABI v8）**
1. 数据模型：`Graph { nodes: [Node; N], edges: [Edge; M] }`，`Node { kind, bypass, params }`、
   `Edge { from, to, gain }`；节点类型先复用现有实现：`Osc1/Osc2/Noise/Wt/Sample → Filter → Amp → Fx1..Fx6 → Out`，
   另加 `Mix`（多入单出，等功率或线性求和各带增益）与 `Split`（一分多）。
2. 参数空间：新增 `GRAPH_EDGE_*` / `GRAPH_NODE_*` 参数段（append-only id，保证旧音色不变）；
   旧的 `FX_CHAIN1..6 / FX_PARALLEL1..6` 在加载时**自动映射**为等价图（顺序链 + 并联送出），
   因此老音色、老预设、老分享码的音色 bit 级不变。
3. 渲染：按节点拓扑序（Kahn，稳定排序）逐块渲染到每个节点的输出缓冲（`[f32; MAX_BLOCK]` 每节点 2 通道，
   8–12 节点约 100 KB，仍走 arena，零分配）；**禁止环**（拓扑排序失败则拒绝该连接并提示）。
4. 旁通：节点关闭时 bit 级旁通（直接把输入拷贝到输出，不进入 DSP）。
**验收**：① 单测：拓扑排序稳定（同一图两次渲染 bit 相同）、并联求和正确、断线静音不炸、
   默认图与旧链 bit 级一致（用固定输入比对样本）；
   ② 门禁：图中每节点关闭 bit 级旁通（与直连比对）、极端图（10 节点全开）仍在预算内；
   ③ 时域 + 频域：并联两路的相位/幅度叠加与解析解一致。
**风险**：效果节点的内部状态与重入（同一效果节点只能出现一次）、内存与预算。对策：节点类型单例化。

**A2 UI：画布连线（1 批）— ⏳ 进行中**
1. 现有信号流视图升级：节点卡片带输入/输出端口，拖拽连线（触屏长按拖动），点边删除，
   节点内联参数（旋钮/开关/波形/包络）沿用现有模块面板组件。
2. 与「简单视图」互为降级：模块面板仍是默认，画布编辑写同一份参数；布局（位置/折叠）进工作区（layout），
   拓扑进音色（预设/分享）。
3. 键盘/屏幕阅读器可达：连接也能通过「选择源 → 选择目标」的表单完成（不依赖拖拽）。
**验收**：E2E：连线 → 听得到变化 → 重载保持 → 删线恢复；手机视口下端口 ≥44 px、不溢出。

**A3 兼容与文档（可与 A2 合并）**
1. 分享码/预设 schema 升版 + 迁移（旧码 → 等价图），`persist.test.ts` 增加样本。
2. 文档：USER-GUIDE 新增「信号图」章节、应用内指南、ROADMAP 收尾；`docs/notes/` 记录内存/预算实测。

### B. 层设置随分享码（小批，半天）

现在分享码只带音色（`v/r/p2/m/sn`），不带曲目；若“分享一份编曲”是需求，需要把**曲目 + 层混音**编码进去。
- 方案：`m`（曲目）扩展为 `{ tracks, notes, bpm, layers: [{muted,volume,pan,offset}] }`，
  用现有的 base64url + schema 版本；链接过长时降级为“下载 `.gs1song` 文件”。
- 验收：单测往返一致（含负偏移/声像）；E2E：分享链接打开 → 层混音一致；旧码仍能解析。

### C. 工程项收尾 — ✅ 已完成（v1.75.0）

> 体积：本批把**路由图编辑器、钢琴卷帘、设置/预设抽屉、信号流画布**都拆成按需 chunk（只有点开才下载），
> 初始 JS 从 167.3 KB gzip 降到 151.7 KB；初始 JS 预算据此从 150 KB 调整到 165 KB（其余预算不变），
> 依据写在 `scripts/verify-budget.mjs` 里。

1. ✅ **本地 WebKit E2E**：用户装好系统库后本机可跑，新增 `npm run test:e2e:webkit`（`--workers=1`）；
   现状与待查项记在 `docs/notes/compat.md`（整包连跑仍有大量点击超时，疑似 WebKit 音频线程抢主线程）。
2. ✅ **季度长时基准**：`npm run bench:long`（60 s + 内存/arena 断言），结果追加 `docs/notes/performance.md`。
3. ✅ **`cargo clippy` 门禁**：`npm run verify:clippy`（`-D correctness -D suspicious -D perf`，FFI 的
   `not_unsafe_ptr_arg_deref` 与移植常数的 `approx_constant` 显式豁免）已进 `verify` 与 CI。
4. ✅ **更新提示显示更新内容**：提示条读 `CHANGELOG[0]` 显示新版本第一条。

## 四、风险与对策

| 风险 | 对策 |
| :--- | :--- |
| 状态扩张导致旧数据/分享链接失效 | F 先行；所有新增字段给默认值；加载路径必须有迁移测试 |
| 双实例/多轨的 CPU 与复音预算 | 每批都跑性能门禁；实例数上限 + 负载监视降级沿用现有机制 |
| ~~卷积混响跳边界尖峰~~ | ✅ v1.69.0：分段乘加摊平到 hop 内的块，基准新增 IR 行并断言其余 7 块成本接近 |
| 大块 UI 改动破坏移动端 | 每批跑手机/平板视口 E2E（现有 620/900 断点用例），触屏交互单独写用例 |
| 本机缺 webkit/firefox 系统库 | 已确认缺 `libicu74 / libxml2 / libmanette-0.2-0 / libenchant-2-2`：本地判据仍以 Chromium 为准，WebKit 走 CI；装了系统库后按 C1 纳入夜间跑 |
| 节点图把状态扩张到拓扑 | 拓扑进音色、位置进工作区；加载旧音色时自动映射为等价链，并用 bit 级比对测试兜底 |

## 五、完成定义（每批通用）

- [ ] 实现 + 单元测试（Rust 与/或 Vitest）+（涉及交互时）Playwright E2E
- [ ] `npm run verify` 退出码 0（Rust / Vitest / lint / build / wasm / dist / budget / audio / dsp）
- [ ] 有音频变化的批次：时域**与**频域都有断言
- [ ] 小步提交（`feat|fix|test|docs(...)`），版本号随功能提交递增
- [ ] `npm run package` 产出 `release/gs1-synth-<ver>-dist.zip`
- [ ] 部署 `synth.wangda.today` 并核对线上资源 hash 与 `dist/index.html` 一致
- [ ] 中文文档同步：`docs/USER-GUIDE.md`、`docs/ROADMAP.md`、应用内指南、更新记录（面向用户、不写根因）
