# 慢轨打包 / Slow-lane handoff packs

**要解决的问题**：WebKit / Firefox 套件在本机跑不完——本机 WebKit 默认子集 **>96 min 未完成**、
`--all` **>132 min 未完成**（数字见 `docs/notes/nightly.md` 与 `docs/notes/compat.md`）。把这些套件
放到更快的机器上跑，如果只拿回一行「passed/failed」，**归因还得从头再来一遍**（要日志、要失败上下文、
要「到底是哪个内核哪个版本哪个 bundle」）。所以 `scripts/slow-lane-pack.mjs` 一次把**结果**打成一个包。

## 用

在**跑测试的那台机器**上（仓库根、已 `npm install`、已 `npx playwright install webkit firefox`）：

```bash
node scripts/slow-lane-pack.mjs                     # webkit+firefox × 核心子集（默认）
node scripts/slow-lane-pack.mjs --subset=all        # 全量（数小时）
node scripts/slow-lane-pack.mjs --engine=webkit --subset=nightly
node scripts/slow-lane-pack.mjs --specs=e2e/player.spec.ts,e2e/flow.spec.ts
node scripts/slow-lane-pack.mjs --dry-run           # 只打印计划，不跑
node scripts/slow-lane-pack.mjs --self-test         # 拿 chromium 的 1 个 spec 走完整管线（约 1 min）
```

`npm run slow-lane` 等价于第一条，`npm run slow-lane:self-test` 等价于最后一条。子集名（`core` /
`nightly` / `all`）与 `npm run nightly` 共用**同一份常量** `scripts/lib/e2e-subsets.mjs`，不会两处各说各话。

| 参数 | 默认 | 说明 |
| :-- | :-- | :-- |
| `--engine=` | `webkit,firefox` | 逗号分隔，按顺序串行跑 |
| `--subset=` | `core` | `core` / `nightly` / `all`，或改用 `--specs=` 给文件清单 |
| `--port=` | `4805` | 每个引擎 +1；`vite preview` 是 `--strictPort`，端口被占会立刻红 |
| `--timeout-min=` | `300` | 单次运行的墙钟上限，超时**杀整个进程组**（SIGTERM，10 s 后 SIGKILL） |
| `--skip-build` | 关 | 复用现有 `dist/`（树没变时才用；`environment.json` 里记了用的是哪个 bundle） |
| `--label=` | `slow-lane` | 进目录名与归档名 |
| `--out=` | `.tmp/slow-lane` | 归档落地目录 |

**单个 run 红掉不会中断打包**：它的退出码、日志、失败上下文照常收进包里，后面的引擎继续跑；只要
有任何一次红或超时，脚本退出码是 1。默认会先 `npm run build`（失败也只记一笔，然后用它已有的 `dist`）。

## 跑门禁 / 整套 E2E（`--steps=`）

同一套采集与打包，只是跑的是仓库自己的 npm 脚本而不是 Playwright 子集：

```bash
node scripts/slow-lane-pack.mjs --steps=verify        # 快轨门禁（clippy + Rust 测试打头，本机约 20 min）
node scripts/slow-lane-pack.mjs --steps=e2e           # Chromium 整包 E2E（本机 10–14 min）
node scripts/slow-lane-pack.mjs --steps=verify,e2e    # npm run gate-pack
node scripts/slow-lane-pack.mjs --steps=test:e2e,test,verify:dist,verify:budget   # 按需子集
```

别名：`e2e`→`test:e2e`、`perf`→`test:perf`、`visual`→`test:visual`、`unit`→`test`、`dsp`→`test:dsp`；
其它名字按原样当 npm 脚本用。浏览器类步骤自动分配 `GS1_E2E_PORT` 并写 JSON 报告。

**同一个包里也能放进慢轨**：步骤名写成 `pw:<project>:<subset>` 就是一次 Playwright 引擎运行
（`pw:webkit:all`、`pw:firefox:all`、`pw:chromium:core`、`pw:chromium:smoke`）。于是「门禁 + 跨引擎全量」
可以一次跑完、一个包带走：

```bash
node scripts/slow-lane-pack.mjs --steps=verify,e2e,pw:webkit:all,pw:firefox:all   # npm run gate-pack:full
```

**注意 `--subset=all`（不带 `--steps`）是另一件事**：它只跑慢轨——默认 `webkit + firefox` 的整个套件，
**不含 Chromium、也不含 `verify` 的那套门禁**。要「一次全跑」请用上面的 `--steps=...pw:...` 形式。

**产物**：每个步骤一份 `logs/<step>.log`（边跑边写）、`reports/*.json`、`test-results-<step>/`、
`SUMMARY.md`（步骤表 + 抓出来的关键行 + 失败明细）、`environment.json`（**含 git HEAD 与「树是否脏」+ diffstat**）、
`dist-manifest.sha256`（被测量那份产物的逐文件哈希）、`manifest.sha256`，最后打成 `.tmp/gate/gate-<时间戳>.tar.gz`。

**读的时候注意**（SUMMARY 顶部也写了）：计时类门禁（bench / perf / boot 预算）只在**跑它的那台机器**上有意义；
确定性门禁（rust / vitest / presets / dsp / dist / budget / 协议与文档门禁）与机器无关。
所以「在快机器上跑 `--steps=verify`」的**失败信号可信**，但**它的计时数字不能当作本机的通过证据**。

**前置**：`verify` 以 clippy 与 Rust 测试开头，需要那台机器有 `cargo`；没有时脚本会在开头明确警告，
让那两个步骤失败、其余照跑（打包器从不中途停），也可以只跑 `--steps=e2e,verify:dist,verify:budget` 这类子集。

## 包里有什么

```
SUMMARY.md                  内核 × 计数表 + 全部失败用例的报错（截前 12 行）
environment.json            宿主 CPU/内存/OS、node、playwright、包版本、git HEAD、
                            dist 入口 JS 名与 index.html 的 sha256、每个 run 的退出码
logs/<引擎>-<子集>.log       边跑边写的完整输出（含 [WebServer] 与列出的每一条用例）
reports/<引擎>-<子集>.json   Playwright 的 json reporter 原始产物（SUMMARY 就是由它生成的）
test-results-<run>/         该 run 自己的失败上下文（error-context.md 等）
manifest.sha256             包内每个文件的哈希，`sha256sum -c manifest.sha256` 可校验
```

`test-results/` 是**每个 run 开始时被清空**的，所以脚本在每次 run 结束后**立刻**按 run 名复制一份；
这也是「引擎串行、不并发」的原因。

## 拿回来之后怎么读

1. 先看 `SUMMARY.md` 的表：`failed` 与 `flaky` 分开算（本仓库的口径是 **flaky = 假红**，不是绿）；
2. 有失败再看同名 `logs/` 里的**上下文行**，`test-results-<run>/error-context.md` 是页面快照；
3. 判断「是不是环境问题」用 `environment.json`：CPU 型号/核数决定 `boot`/`performance` 那几项能不能
   当信号，`(pointer: coarse)`、音频后端、合成器有无这类**宿主差异**在 `docs/notes/compat.md` 里；
4. 归档里的 `dist` 入口名要与被验证的那一版一致，否则测的是旧 bundle——`environment.json` 就是为了
   钉住这一点（发布流程里也用同一条判据，见 `docs/notes/release.md`）。

**不要把包里的日志当门禁**：绿/红仍以 `npm run verify` 与 CI 为准，这个包只是把慢轨的**信号**带回来。
