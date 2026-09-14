# 性能基准 / Performance baseline

由 `npm run bench -- --update` 写入：每行是一次 6 秒密集负载（双锯齿 + 各 3 声部齐奏、全套效果、16 个持续音）
在 Node 里跑 wasm 核心的结果。单位是微秒/块（128 帧，预算 2667 µs @48 kHz）。
带 `IR` 的行是同一负载再挂一条 2 秒导入脉冲响应（卷积混响），用来盯住最重的路径：
门的判据除了「不超预算」，还有「除了不能提前做的那次变换所在的块，一个 hop 内其余 7 个块的成本互相接近」，
也就是卷积的分段乘加确实摊平到了整个 hop，而不是挤在一个块里。

| 日期 | 负载 | 平均 | p50 | p99 | 最差 | 平均占用 | 声部 |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-09-11 | 6s · 16 notes | 243 | 245 | 320 | 940 | 9.1% | 10 |
| 2026-09-11 | 6s · 16 notes | 244 | 243 | 351 | 982 | 9.1% | 10 |
| 2026-09-11 | 6s · 16 notes · IR 2.0s | 333 | 288 | 708 | 1307 | 12.5% | 10 |

## 启动预算进发布门禁（P11.5，v1.110.0）

`npm run release` 现在把 `e2e/performance.spec.ts` 的 `[boot-budget]` 行当成**具名步骤**复核：
`[release] ▸ first-interactive budget (3200 ms)`，阈值由 `GS1_BOOT_BUDGET_MS` 覆盖（CI 与更慢的机器可以各自设）。
**正常路径不重复跑 E2E**：release 捕获 `npm run test:e2e` 的同一份输出并解析那一行；
只有 `--skip-e2e` 时才单独跑这一个 spec 文件（否则 `--skip-e2e` 会把启动门禁一起关掉，那是错的）。
新增 `--skip-git-check` 仅用于演练（脏树时也能跑到门禁）。

### 失败路径演练（自证，原始输出）

```
$ GS1_BOOT_BUDGET_MS=1 node scripts/release.mjs --skip-verify --skip-deploy --dry-run --skip-git-check --skip-e2e
[release] ▸ first-interactive budget only (1 ms; --skip-e2e)
[boot-budget] interactive 883 ms of [3118, 1493, 883] · FCP 2084 ms · budget 1 ms
  ✘  3 [chromium] › e2e/performance.spec.ts:130:3 › first interactive › the start gate is clickable and painted inside the boot budget
    Error: interactive best 883 ms of [3118, 1493, 883], FCP 2084 ms (budget 1 ms)
  1 failed   5 passed (43.0s)
[release] FAIL — npx playwright test e2e/performance.spec.ts --project=chromium --reporter=list exited 1
（EXIT=1）
```

还原成默认阈值：

```
$ node scripts/release.mjs --skip-verify --skip-deploy --dry-run --skip-git-check --skip-e2e
[release] ▸ first-interactive budget only (3200 ms; --skip-e2e)
[boot-budget] interactive 509 ms of [1145, 509, 524] · FCP 928 ms · budget 3200 ms
[release]   ✓ first interactive 509 ms ≤ 3200 ms (from e2e/performance.spec.ts)
[release] PASS — v1.109.0 (dry run: not deployed, not tagged)
```

两层都证明了：spec 自身的断言红 **且** 发布流程中止（不是只打印一行警告）。

### 运行时 fps 守卫（P11.5）

同一个 spec 现在盯**三种负载**，阈值仍是 **>20 fps**：`idle-with-engine`（引擎空转）、
**`playback`（真播放）**、**`graph-edit`（真拖节点/连线）**。取「多窗口里最快的一个」，
理由与启动预算、`bench` 的机器探针同源：本机是软件渲染 + 共享负载，单窗读数会被别的进程抢走。

| 场景 | 单跑（best of 5×800 ms） | 全量并行套件下 |
| :--- | ---: | ---: |
| idle-with-engine | 61.3 | 50.0 |
| **playback** | **60.0** | **28.8** |
| **graph-edit** | **61.3** | **31.3** |

并行套件下曾读到 playback 单窗 20.0 / graph-edit 17.5，所以窗口数从 best-of-3×1.2 s 改成
**best-of-5×0.8 s**——**没有动阈值**。改阈值要另开批次并说明原因。

> 表中「全量并行套件下」那一列是**历史**：v1.111.0 起该 spec 已不在 app 套件里（见下节），
> 那一列不再由 `npm run test:e2e` 产生。

### ✅ 已隔离修复：fps 守卫不再和并行套件抢核（v1.111.0）

**v1.110.0 发布时的原始观测（历史，保留不改）**：该次发布跑（`npm run release`，全量 E2E、多 worker）里读数是这样：

```
[fps] idle-with-engine best 47.5 of [47.5, 43.8, 43.8, 47.5, 42.5] fps
[fps] playback        best 22.5 of [16.3, 22.5, 18.8, 18.8, 18.8] fps
[fps] graph-edit      best 48.8 of [48.8, 26.3, 26.3, 36.3, 45.0] fps
```

**pass 了，但 playback 的 5 个窗口里有 3 个低于 20**（16.3 / 18.8 / 18.8）——它是靠最好的那一窗过的。
同一份代码在单跑时是 60.0 fps，所以这不是播放变慢，而是**测量被同套件的并行负载污染**：
`performance.spec.ts` 是套件里的第 77 条，跑的时候其它 worker 正在压 8 个核。
best-of-N 的选择是有理由的（本机软件渲染 + 共享负载，单窗会被别的进程抢走），但它**不能替代隔离**：
一个「靠运气窗口通过」的守卫会掩盖真实的性能回退。v1.111.0 的发布就因此被 playback 的
「20.0 fps of [17.5, 16.3, 20.0, 15.0, 13.8]」挡下（同一份代码单跑是 60.0），所以本批修的是**门禁的测量方式**。

**修复做法（隔离；一个阈值都没动）**：

- `playwright.config.ts`：新增 **`perf` project**（`testMatch: /performance\.spec\.ts/`，与 chromium 相同的
  `devices['Desktop Chrome']` 和 `--autoplay-policy=user-gesture-required`）；**chromium project 加
  `testIgnore: /performance\.spec\.ts/`**（webkit/firefox 早已 ignore 它，未动）。
- `package.json`：`test:e2e` 明确为 `playwright test --project=chromium`（**只跑 app 套件**），
  新增 `test:perf` = `playwright test --project=perf --workers=1`（**只跑性能**）。
- `scripts/release.mjs`：E2E 步骤改成**两段**——先 `npm run test:e2e`，再 `npm run test:perf`；
  启动预算仍从捕获输出解析 `[boot-budget]`（两段输出都扫，解析能力不变），并把三条 `[fps]`
  **连窗口明细**一起打进发布日志。`--dry-run` / `--skip-e2e` 语义不变（后者单独跑 perf project）。
- `.github/workflows/ci.yml`：Chromium E2E 之后新增一条 `npm run test:perf`，与 release 调用同一对命令；
  `scripts/verify-ci.mjs` 把 `test:perf` 列入必需命令（和 `test:e2e` 一样豁免 `verify` 链检查——
  浏览器套件本来就不在 `verify` 里）。

**阈值与纪律**：fps 仍是 **>20**、启动预算仍是 **3200 ms**、体积三线未动；**没有** retries，
**没有**「负载高就跳过断言」。

**隔离后实测（v1.111.0，同机，`npm run test:perf`，1 worker，6 passed / 34.0 s）**：

```
[boot-budget] interactive 907 ms of [1101, 907, 1225] · FCP 808 ms · budget 3200 ms
[fps] idle-with-engine best 61.3 of [61.3, 53.8, 61.3, 61.3, 60.0] fps
[fps] playback         best 52.5 of [42.5, 52.5, 50.0, 37.5, 48.8] fps
[fps] graph-edit       best 61.3 of [53.8, 56.3, 61.3, 58.8, 58.8] fps
```

playback 的 5 个窗口从并行时的 13.8…20.0 收敛到 **37.5…52.5**，**每一窗都在 20 之上**——这是隔离
带来的真实测量，而不是挑一窗过关。同一次验证里 app 套件（`npm run test:e2e`）是
**135 passed / 10 skipped（6.1m）**，两个套件都绿。

**门禁仍然有效（自证）**：临时把 `FPS_FLOOR` 改成 `999` → 三条 fps 守卫**全部红**
（`Expected: > 999` / `Received: 61.25`、`60`、`61.25`），EXIT=1；还原成 20 后三条绿。

**发布链两段式已实跑验证**：`node scripts/release.mjs --skip-verify --skip-deploy --dry-run --skip-git-check`
→ app 套件 **135 passed**，性能套件 **6 passed（35.3 s）**；release 从性能套件输出解析到
`[boot-budget] interactive 653 ms ≤ 3200 ms`，并把三条 `[fps]` 连窗口打进发布日志
（`idle 61.3 [61.3, 60.0, 61.3, 61.3, 61.3]`、`playback 61.3 [58.8, 46.3, 51.3, 48.8, 61.3]`、
`graph-edit 56.3 [50.0, 47.5, 42.5, 53.8, 56.3]`），最后 `[release] PASS`（EXIT=0）。
CI 与 release 现在调用同一对命令（`npm run test:e2e` + `npm run test:perf`）。

## 计时判据只有一份（P14.2）

三处门禁都在读墙上时钟。第三次全面回归里它们**各判各的**，同一台机器上「谁算红」于是取决于撞上
哪道判据；更糟的是其中两道**没有负载探针、失败也不打印读数**，它们给出的红和真回归长得一模一样：

| 门禁 | 计时判据 | 探针之前的行为 |
| :--- | :--- | :--- |
| `scripts/bench.mjs` | p50 < 60 % 量子、超预算块 ≤ 2 %（另有 IR 路径与 hop 摊平） | 早就有探针：`~ skipped` + `PASS (correctness only)` |
| `scripts/verify-audio.mjs` CPU 一节 | 16 声部满效果链、200 块 × 5 轮取最小，`perBlockUs / 2667 µs < 60 %` | **无探针、不打印读数**：load 16–21 读 232 % / 149 % / 155 %（FAIL），同一场景安静窗口读 26 % |
| `src/fuzz.test.ts` | 每个 parser 10k 输入 < 4000 ms | **无探针、成功不打印余量**：load 16–21 读 4050 / 4252 / 6001 / 7945 ms，安静窗口读 442 / 656 / 452 / 328 ms |

**一份实现**：`scripts/lib/host-load.mjs`。`bench.mjs` 的 `hostLoad()` / `cpuProbe()` **连注释一起搬过来**，
`bench.mjs` 改为 import——阈值、判据、输出格式一字未动（把前后两次短跑的读数归一化后 `diff` 为空）。

- `hostLoad()`：`/proc/loadavg` 的 1 分钟值 **> 0.5 × 核数** = busy。0.5 而不是 0.75 是量出来的：
  同一场景在 load ~2 读 p50 1169 µs（44 %）、load 5.8 读 1621 µs（61 %），宿主本身就能造成 38 % 的摆动，
  而那正是这道门禁要抓的回归量级。
- `cpuProbe()`：与 DSP 无关的固定循环（无 wasm、无分配），跑 7 次取**最小值**（「这个进程最快能跑多快」，
  被抢占只会让某一次更慢）。空闲参考 `PROBE_REFERENCE_US = 1600` µs，超过 **4×** 参考值 = 进程被饿。
  引擎自身的耗时**不参与**这个判断：P9.1b 的教训正是拿工作负载当自己的借口，会在引擎变重时把门禁悄悄关掉。
- `timingTrust()`：两个信号**任一**成立即不可信，返回 `{ trusted, reason, load, cpus, probeUs }`；
  `reason` 会被打在被它作废的那行读数旁边。被饿优先于 load 报告（它是更锐利的那个信号）。

**阈值一个都没动**：2667 µs、60 %、4000 ms、0.5 × 核数、4 × 参考值全部原值。这批只改可见性与判据统一。

**不可信时各自做什么**（退出码都是 **0**：CI 与开发机不该因为宿主忙而红）：

- `bench.mjs`：计时项 `~ … skipped, host is loaded (…)`，结论 `[bench] PASS (correctness only) — timing checks: N judged, M skipped`；
- `verify-audio.mjs`：CPU 那项 `⚠ worst-case block fits the budget — inconclusive: <reason>; perBlockUs … µs = …% of 2667 µs; rounds … µs (best of 5 × 200 blocks, 16 voices); host load … cpu probe …`，
  结论行 `[audio] PASS (correctness only — timing not judged: load 16.0 on 8 cpus, cpu probe 5200 µs vs 1600 µs idle)`，
  再跟一行 `↳ <哪一项>：<reason>`——**一眼可见**，不是普通的绿；
- `src/fuzz.test.ts`：读数**恒打印**（`[fuzz] decodePatch: 10000 inputs in 480 ms of 4000 ms budget (88.0% headroom)`），
  不可信时 `console.warn` 打出读数与理由，然后 `ctx.skip()`（vitest 2.1.9 的运行时跳过，汇总里出现 **skipped**）。
  读数先收集、在每个 `it` 末尾统一裁决，所以宿主忙**不会**让某个测试跑到一半就中断、丢掉后面的 parser。

**复跑（安静窗口）**：

```sh
awk '{print $1}' /proc/loadavg    # 1 分钟值，应 ≤ 0.5 × nproc
node scripts/verify-audio.mjs     # CPU 那行恒打印 perBlockUs / 百分比 / 每轮 / load / probe
npx vitest run src/fuzz.test.ts   # [fuzz] 行恒打印 elapsed / budget / 余量
node scripts/bench.mjs            # 短跑；p50 与超预算比例是判据
```

**只用于自证/演练的覆盖**（与 `GS1_BOOT_BUDGET_MS` 同类，默认不设 = 真实测量；两个信号正交，可单独演练）：
`GS1_TIMING_HOST=busy` 强制不可信、`GS1_TIMING_HOST=idle` 只覆盖 load 信号（探针照测，所以「宿主安静但
进程被饿」仍会被抓）、`GS1_TIMING_PROBE_US=<n>` 替换探针读数。

**自证（P14.2 原始输出，本机 load 4.5–14；本机同时有别的轨道在跑，所以 load 一直不低）**：

- 真实测量（无覆盖）：`⚠ worst-case block fits the budget — inconclusive: host is busy: load 7.8 on 8 cpus is over 0.5 × 8 cpus; perBlockUs 884 µs = 33% of 2667 µs; rounds 1159/884/1002/1573/1421 µs` +
  `[audio] PASS (correctness only — timing not judged: load 7.8 on 8 cpus, cpu probe 940 µs vs 1600 µs idle)`，EXIT=0
  （读数本来是绿的 33 %，宿主忙时依然只写成 `correctness only`）；
- `GS1_TIMING_HOST=busy`：`⚠ … inconclusive: forced busy by GS1_TIMING_HOST; perBlockUs 736 µs = 28% of 2667 µs`，EXIT=0
  （这一次读数本可过，但因为没判，不写成普通的绿）；
- `GS1_TIMING_PROBE_US=99999`：`⚠ … inconclusive: process is starved: cpu probe 99999 µs is over 4 × the 1600 µs idle reference`，EXIT=0；
- **可信宿主仍然会红**（`GS1_TIMING_HOST=idle` 强制可信，等 load 落到 ~4.7 的真实读数）：
  `✓ worst-case block fits the budget — perBlockUs 757 µs = 28% of 2667 µs; rounds 820/842/785/763/757 µs` + `[audio] PASS`，EXIT=0；
  把同一行读数 ×0.01 做对照 → `0% of 2667 µs` + `[audio] PASS`；改成 ×100（临时改动，已 `git checkout` 还原，**一行阈值都没改**）→
  `✗ worst-case block fits the budget — perBlockUs 708 µs = 2655% of 2667 µs` + `[audio] FAIL — worst-case block fits the budget`，EXIT=**1**。

