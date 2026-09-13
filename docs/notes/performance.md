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
