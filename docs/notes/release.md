# 一键发布 / One-command release

```bash
npm run release -- 1.80.0            # 完整发布
npm run release -- 1.80.0 --dry-run  # 演练：跑真实门禁，但不部署、不打 tag
npm run release -- --check           # 只做发布前校验（`npm run verify` 也会跑它）
```

`scripts/release.mjs` 按固定顺序执行，任何一步失败立即停止：

| # | 步骤 | 失败原因示例 |
| :-- | :--- | :--- |
| 1 | **发布前校验**：版本号 `x.y.z`、`package.json` 一致、`src/changelog.ts` 最新一条就是它、日期是今天、`kind` 合法、每条都中英双份、版本号唯一且倒序、工作区干净、不在 detached HEAD | 忘记 bump 版本 / 更新记录日期写成昨天 |
| 2 | `npm run verify`（clippy、Rust、单测、lint、build、wasm、ci、release、dist、budget、audio、bench、dsp） | 任一门禁红 |
| 3 | Chromium 全量 E2E | 交互回归 |
| 4 | `npm run package`（release/ 里的 zip/tar.gz/SHA256SUMS） | 构建失败 |
| 5 | `wrangler deploy`（token 取环境变量，取不到就读 `~/.zshrc` 里的 `export CLOUDFLARE_API_TOKEN=`） | 未登录 / 网络 |
| 6 | **线上资源核对**：带随机查询串拉首页，比对 `assets/index-*.js` 与 `dist/index.html`；不一致时每 5 秒重试，第 3 次重试前**再部署一次**（CF 边缘偶尔还挂着旧清单）；6 次仍不一致即失败 | 边缘缓存 / 部署没推上去 |
| 7 | **保留本次发布**：把 `dist/index.html`、`dist/sw.js`、全站 `sha256.txt` 与 `release/gs1-synth-<version>.tar.gz` 复制进 `release/retained/<version>/`，更新 `release/retained/index.json`，**然后**把窗口外的旧版本删掉（N=5，见下文「保留 N 个版本」） | 快照缺失 / 快照指纹与已部署哈希不一致 |
| 8 | 打附注 tag `v<version>`（已存在则跳过，不覆盖） | — |

参数：`--skip-verify`、`--skip-e2e`、`--skip-deploy`（只打包打 tag，**不保留、不清理**）、`--quiet`、`GS1_SITE=<url>` 覆盖线上地址、
`GS1_KEEP_VERSIONS=<1…50>` 覆盖回滚保留窗口（默认 5）。

**线上地址就是 `https://synth.wangda.today/`**（`scripts/release.mjs` 里 `site` 的默认值）。它挂在 Worker `shiny-sky-9ea0` 的
自定义域名上（`GET /accounts/<id>/workers/domains` 可查），`wrangler.toml` 里的 `name` 就是这个 Worker。
**不要拿 `*.pages.dev` 的主机名核对**：本项目早已不通过 Pages 发布，旧主机名（如 `gs1.pages.dev`）现在对任何客户端
都返回 Cloudflare 的请求元数据 JSON——其中还有 `"pagesHostName"` 字样，很容易被误读成「站点正常」。核对时务必同时看
**返回体的 `assets/index-*.js` 哈希**与本地 `dist/index.html` 是否一致（第 6 步就是这么做的），只看 HTTP 200 没有意义。

设计取舍：

- **版本与更新记录的校验放在最前面**：一个版本号写错不该花 10 分钟跑完所有门禁才发现；同一个校验也以 `npm run verify:release` 挂在本地 `verify` 与 CI 的 verify 作业里，所以「版本和更新记录脱节」永远进不了 main。
- **CI 里只查「日期是真实日期且不是未来」**，不查「必须是今天」——CI 什么时候捡到这次提交不由我们决定，本地发布时才要求当天。
- **不在发布里自动回滚**：部署失败时重新跑一次比猜「该撤销什么」更可靠；tag 只在全部成功后打，所以「有 tag 的提交 = 已上线的那份代码」。
  回滚是一个**显式的运维动作**，不是发布脚本的自动分支——`npm run rollback -- <version>`（P12.4），见下文。
- **不自动 commit**：改动和更新记录仍随功能批次一起提交，发布脚本只负责校验、打包、部署、打 tag。

## 一次真实的发布事故：`git checkout -- package.json`（v1.108.0）

发布 v1.108.0 时，更新记录的第一版把首屏 JS 顶过了线，于是重做版本号；重做时我跑了
`git checkout -- src/changelog.ts src/changelog-head.ts package.json package-lock.json` 把它退回再
`bump`。问题是**那一刻 `package.json` 里还有子代理尚未提交的脚本文案**（P11.4 的
`verify:presets:2x` / `presets:update:2x` 与 `verify` 链里的那一条），于是它们被一起回退，随后我提交了
一个「只差版本号」的 `package.json`。后果：

- `npm run verify` **静默跳过了 2× 预设指纹门禁**；
- `.github/workflows/ci.yml` 里那条 `npm run verify:presets:2x` 在 CI 上会**直接失败**；
- 而 `scripts/verify-ci.mjs` **仍然报 `[ci] PASS`** —— 它当时只检查「CI 工作流文本里有没有这条命令」，
  不检查「这条 npm script 是否真的存在」。

两条结论，都已落地：

1. **重做版本号不要用 `git checkout -- <file>`**。要退回的只有版本字段时，直接改那一个字段；要整文件退回
   时先 `git status` 确认那些文件**没有他人未提交的改动**，或者先把子代理的成果提交再动。
2. **`verify:ci` 现在同时校验两半**：工作流文本里有这条命令 **∧** `package.json` 的 `scripts` 里真的定义了它
   （`npm run <name>` / `npm test` / `npm run <name> -- <args>` 都能解析）**∧** `verify` 链里点名了每个非 E2E
   必需命令。自证方式是把脚本名临时删掉或从链里摘掉，两种都必须让 `[ci]` 变红——见 P10.2（v1.109.0）的报告与提交。

## 快轨 / 慢轨：不要把全面测试塞进每一次迭代（2026-09-14 起）

每批都跑一遍完整 `npm run verify` + 全量 E2E 会把迭代周期拖到几十分钟，而其中绝大部分与本次改动无关
（而且本机 8 核在负载下会让 `src/fuzz.test.ts` 的时间预算和 `bench` 的 over-budget 判定**假红**，
见 `docs/NEXT-PLAN-2.md` §一.15 —— 花了大量时间去追一个不存在的回归）。

**快轨（每批）**：只跑与本批相关的定向门禁 —— 相关测试文件、相关音频/体积门禁脚本、`lint` / `typecheck` /
`build`；改了 UI 才跑 `test:visual`，改了 E2E 才跑那个 spec 文件。**不跑** `fuzz` / `bench` / 全量 E2E /
整链 `verify`。

**发布（快轨）**：`npm run release:fast -- <version>`（即 `release.mjs --skip-verify --skip-e2e`）——
preflight → package → deploy → 线上哈希核对 → tag，几分钟内完成。前提是快轨已绿、工作树干净。

**慢轨（每 3–4 个版本一次）**：另开一个 agent 在**安静主机**上做全面回归 —— 完整 `npm run verify`、
全量 E2E（app 套件 + 隔离的 perf 套件）、视觉基线、**WebKit 与 Firefox**（`e2e-engines` / nightly 子集）、
以及一段时间的连续观察；
> **Firefox / WebKit 只在慢轨测**（用户 2026-09-14 明确指示）：日常批次只跑 chromium，不碰 firefox/webkit project，也不跑 nightly。
它**只报告**，发现的问题回头**单独立批**修。慢轨与开发**解耦**：它慢它的，迭代继续。

这样分工的前提是**快轨必须真的跑**：慢轨是补网，不是替代品。任何一批如果连定向门禁都没跑就发布，
那就不是快轨而是没有轨。

## 保留 N 个版本：`release/retained/`（P12.4）

**策略写死在 `scripts/lib/retained.mjs` 的 `KEEP_VERSIONS`，默认 N = 5。**

- **什么时候保留**：一次**成功**的发布之后。`scripts/release.mjs` 的顺序是
  `package → deploy → 线上哈希核对 → 保留 → 打 tag`。只有「线上确实在跑这份字节」的版本才进窗口；
  `--skip-deploy` 不保留，失败的发布既不保留**也不清理**（没上线的东西不该进窗口，更不该把窗口挤掉一格）。
- **保留什么**：把该版本的 `dist/index.html`（shell 指针）、`dist/sw.js`（SW 缓存名）、全站文件的
  `sha256.txt`，以及 `release/gs1-synth-<version>.tar.gz`（完整站点快照）复制到 `release/retained/<version>/`。
  快照不重新打包，直接复用 `npm run package` 那三个产物之一——「要回滚到的东西」和「发布出去的东西」是同一份字节。
- **清理时机**：紧接着保留之后，同一处代码（`recordVersion`）把窗口外最旧的版本目录删掉。
  `recordVersion` 是整个回滚工具里**唯一**会删东西的地方。`--dry-run` 只打印将保留/删除哪些版本，不动磁盘。
- **保留哪些**：按保留时间排序的最新 5 个，**外加永远是 current 的那一版**（哪怕它已经在窗口外——
  它是「再坏一次时唯一能回去的地方」）。每个版本的 `index.json` 条目里还记了 `storeSchema`
  （见下面「回滚的真实风险」第 2 条）。
- **在哪里**：`release/retained/`，**只在本机**（已加进 `.gitignore`）。不进 git、不进 CDN。
  代价要认清：换机器或删掉 `release/` = 回滚点全丢。想要多点保障，就把 `release/retained/*/gs1-synth-*.tar.gz`
  另外抄一份到别处。
- **N 怎么改**：`GS1_KEEP_VERSIONS=<1…50>` 覆盖（一次性用）。非法值（`0`、`5o`、`51`、`2.5`）**报错而不是取整**——
  取整等于让一个笔误悄悄关掉清理。
- **怎么取回**：

  ```bash
  ls release/retained                       # 有哪些版本可回滚
  cat release/retained/index.json           # 每版的 shell/sw 指纹、storeSchema、保留时间、事件
  tar -xzf release/retained/<version>/gs1-synth-<version>.tar.gz -C /tmp/site   # 完整站点
  cat release/retained/<version>/sha256.txt # 每个文件的 sha256
  ```

  `rollback.mjs` 做的就是「解包 + 逐文件核对 sha256 + 用这个目录当 `[assets]` 重新部署」。

**为什么不让 Cloudflare 替我们留着旧部署**：Worker 服务的是**静态资源**，每个文件都带内容哈希，
所以新部署不会覆盖旧文件，而是**不再提供**它；唯一不带哈希的 `index.html` 正是指向 `assets/index-<hash>.js`
的指针。回滚因此需要**整棵旧树**，不是只要旧 HTML。Cloudflare 自己的版本历史也能回滚
（`wrangler rollback <version-id>`，不用重传，`wrangler versions list` 列最近 10 个版本），但那是远端、
不透明的列表：我们没法在动手前断言那一版还在，也没法对「它将要提供的字节」做校验。
保留一份本地、带校验的快照，才让回滚目标变成一个**可核对的事实**。

## 回滚：`npm run rollback`

```bash
npm run rollback                                   # 只列出现有可回滚版本
npm run rollback -- 2.0.3                          # 默认就是 dry-run：打印计划 + 只读看看线上现在是什么
npm run rollback -- 2.0.3 --apply                  # 真的回滚（要 CLOUDFLARE_API_TOKEN，会二次确认）
npm run rollback -- 2.0.3 --apply --yes            # 跳过交互确认（CI / 脚本用）
npm run rollback -- 2.0.3 --check-only             # 只读：现在线上跑的是不是 v2.0.3 这份字节
npm run rollback -- --self-test                    # 自检（无网络、不碰生产、不碰 release/retained）
npm run rollback -- 2.0.3 --cf-rollback <version-id>   # 用 CF 版本历史回滚，不重传
npm run rollback -- 2.0.3 --apply --force          # 绕过「已经就是这一版 / schema 倒退」的拒绝（危险，见下文风险 6）
```

其它开关：`--site <url>`（同 `GS1_SITE`）、`--store <dir>`（默认 `release/retained`）、`--keep <n>`（同 `GS1_KEEP_VERSIONS`）、
`--attempts <n>` / `--delay <ms>`（核对的重试次数与间隔）。

**`--dry-run` 是默认值**，不是额外开关；`--apply` 才动手。回滚这一件事不做「静默地干」。

回滚步骤（`--apply`）：

1. 从 `release/retained/index.json` 解析版本，拿不到就报错并列出可回滚的版本（被清理掉的版本只能靠重新发布恢复）。
2. 解包 `release/retained/<v>/gs1-synth-<v>.tar.gz` 到 `.tmp/retained-site/<v>/`，**先核对 tar 的 sha256、再逐文件核对
   `sha256.txt`、再核对解出来的 `index.html` 指向同一个 shell 哈希**。任何一项不符就停。
3. 生成一份回滚专用的 `wrangler.toml`（`.tmp/retained-site/<v>.wrangler.toml`，只把 `[assets] directory`
   指到解包目录，`name` 等其余照抄）。它写在快照**外面**，否则会被当成资源传上去。
4. 先跑 `wrangler deploy -c <config> --dry-run`（编译 + 读资源目录，**不上传、不需要 token**）确认这份目录可部署。
5. `npx wrangler deploy -c <config>`（token 从环境变量或 shell profile 取，**从不打印**）。
6. **线上核对**：带随机查询串轮询 `${GS1_SITE}/?cb=…`，要求返回的 `index.html` 指向
   `assets/index-<目标哈希>.js`（最多 6 次、每次隔 5 秒）。
7. **SW 核对（横幅联动）**：要求线上 `/sw.js` 的 cache 名等于快照里的 `gs1-<hash>`。
   不等就报红——那种情况意味着**已装客户端根本不会看到更新横幅**，回滚对最需要它的人静默失效。
8. 在 `index.json` 里把 current 改回目标版本并记一条 `action: "rollback"` 事件（并按窗口清理）。

**回滚命令真正能保证什么**：

- 能保证：**线上新访客**拿到的 `index.html` 指向的 JS 哈希 = 保留快照里的那个；线上 `sw.js` 是快照里的那个；
  快照本身与发布时逐文件一致。这三条都是核对过的，不是假设。
- **不能**保证：已装 PWA / Service Worker 的客户端立刻退回（见下一节）；不能保证回滚期间不同访客看到同一版本
  （回滚是「又发一次部署」，边缘传播需要时间，第 6 步的重试就是为此）；
  不能保证用户浏览器里的数据跟着退回去（见「回滚的真实风险」第 2 条）。

**如果第 6/7 步核对失败**：部署**已经发生**了，这时不要盲目重跑，先用只读的方式看一眼：

```bash
npm run rollback -- <version> --check-only
```

- 变绿 ⇒ 只是 CF 边缘传播慢。用 `npm run rollback -- <version> --apply --force` 把同一份字节重发一遍，
  顺便把 `index.json` 的 current 补正（`--force` 就是「我知道它现在是这一版，仍然执行」的显式开关）。
- 一直红 ⇒ 这次部署其实没生效（token / 账号 / worker 名不对，或快照本身有问题）。
  看 `wrangler` 自己的输出，**别把这里当成「回滚成功」**。

## 回滚与更新横幅：回滚**不**等于所有人立刻退回（PWA / Service Worker 边界）

这是最容易被误解的一点，所以写**实际**行为，不写我们希望的版本。

- 更新横幅不是服务器推的。它是 **Service Worker 的 waiting 状态**触发的
  （`src/pwa/register.ts`：`updatefound` → `installed` 且已有 `controller` → `announce()` → 横幅出现）。
  没有 waiting worker，就没有横幅。
- 横幅里的**版本号与标题来自正在运行的那份 bundle** 的 `CHANGELOG_HEAD`，**不是** waiting worker 的版本。
  客户端 API 拿不到 waiting worker 的版本（`registration.waiting.scriptURL` 永远是同一个 `sw.js`，
  而 `sw.js` 里只有内容哈希拼的缓存名 `gs1-<hash>`，没有版本号）。

于是从坏掉的 vW 回滚到 vX 之后，客户端分三种状态，**关键在于那份页面是什么时候打开的**：

| 客户端状态 | 回滚后的实际情况 |
| :--- | :--- |
| 新访客 / 没有 SW | **立刻是 vX**（服务器给什么就是什么）。 |
| 已装 PWA，**重新加载 / 重新打开** | 也是 **vX**。SW 的导航请求是 `fetch('./?v=<cache>', { cache: 'no-store' })`，从不复用旧 `index.html`；新页面是 vX 的 bundle，它要的 `assets/index-<新哈希>.js` 不在旧缓存里，于是从网络取。 |
| 已装 PWA，**页面还开着（自回滚后没重新加载）** | 页面仍然是 vW。它要等 `registration.update()`（切回标签页、或最长 30 分钟一次）发现 `sw.js` 变了 → 装成 waiting → 横幅出现 → 用户点「立即更新」→ 激活 vX 的 worker 并 reload 一次，这时才落到 vX。 |
| 离线中的 PWA | 一直跑它自己那份，直到联网并走完上面任一条。服务器上做什么都够不着它。 |

**矛盾点（本批要求写清的那一条）**只出在最后一种"页面还开着"的情况：横幅里的版本号与标题取自
**正在运行的那份 bundle** 的 `CHANGELOG_HEAD`（`src/App.tsx`），而此时运行的还是 vW，所以横幅会显示
「新版本已就绪 · **vW** · …」——**它报的是我们刚刚回滚掉的那个版本**；点下去实际装上的是 vX 的 worker，
reload 之后页面才是 vX。也就是说：

> 对一个「回滚时页面已经开着 vW」的客户端，**横幅的标签指向被回滚的版本**，但**按钮的结果**是回滚目标。
> 对「回滚后重新加载过」的客户端不会出现这个错位：它的页面已经是 vX，横幅标签就是 vX。

为什么不能顺手修掉：横幅要报 waiting worker 的版本，SW 必须先把这个版本号告诉页面（现在的 `sw.js` 里只有
内容哈希拼的缓存名 `gs1-<hash>`，没有版本号），也就是要动 SW 的 message 协议 + 横幅文案 + i18n，
还会吃首屏 JS 预算。那是一件独立的小批，不属于回滚工具本身——本批**写清交互，并把能断言的那一半断言掉**：

- **断言（`rollback.mjs` 部署后的第 7 步）**：回滚后线上 `/sw.js` 的 cache 名必须等于保留快照里的
  `gs1-<hash>`。这一条同时保证两件事：(a) 这次部署真的把我们要的那份 worker 推上去了（不存在
  「资源换了、worker 没换」的半吊子状态）；(b) 由于每个构建的 `sw.js` 都不同，已装客户端一定会拿到
  waiting worker、**横幅一定会重新出现**——也就是"页面还开着"的那类客户端唯一会被主动通知到的通道。
- **仍未断言（已知限制）**：横幅上写的版本号对不对。这需要上面那条 SW 协议改造，
  建议单独立批（本批的 P12.4 报告里已列为未完成项）。
- 另外提醒：横幅**不是**客户端拿到 vX 的唯一途径——重新加载/重新打开就够了（见上表）。横幅解决的是
  「用户不重新加载、我们也不推」的那段时间。

**操作含义（回滚后照做）**：

1. 回滚后**先不要**把 vW 再发一次，除非确认已装客户端已经更新到 vX；否则会出现「发上去又被横幅推回去」的来回。
2. 主动告知用户「刷新一次即可」：横幅只会出现在还开着的旧页面上（而且要等一次 update 检查），
   设置里也有手动「检查更新」；让人重新加载一次是最直接的。
3. 「回滚成功」只对**线上新访客 / 重新加载的客户端**是可证的事实。一个**还开着旧页面的**会话何时退回，
   服务器侧无法验证，脚本也不假装能验证——这正是它把这段说明每次都打出来的原因。

## 演练：`npm run rollback:drill`（默认 `--dry-run`）

一条命令跑完「部署候选 → 核对哈希 → 回滚 → 再核对 → 报告」：

```bash
npm run rollback:drill                              # dry run（默认）
npm run rollback:drill -- --to 2.0.3                # 指定回滚目标
npm run rollback:drill -- --expect-index deadbeef   # 把「核对」变成真检查并预期一个错哈希（演示红）
npm run rollback:drill -- --apply --yes             # 真演练：会部署、会回滚，需要 CLOUDFLARE_API_TOKEN
```

其它开关：`--to <version>` 指定回滚目标（默认取最新一个不是候选版本的保留版本）、`--skip-package`（复用 `release/` 里已有的产物）、
`--store <dir>`、`--candidate-version <v>`、`--site <url>`。

dry-run **不是「只打印」**：

- 用当前 `dist/` 当候选版本（真实字节），必要时 `npm run package`；
- 把候选**真的**保留进一个**丢弃式仓库** `.tmp/rollback-drill/retained`（走完整的 record + prune 路径，
  但**不碰** `release/retained/`）；
- 真的解包回滚目标并逐文件核对 pin，真的生成回滚用 `wrangler.toml`，真的跑
  `wrangler deploy -c … --dry-run`（编译 + 读资源目录，**不上传、不需要 token**）；
- 两处会改生产的步骤（部署候选、回滚）**只打印命令**，加 `MUTATING (dry run: not executed)` 前缀。

`--expect-index <hash>` 会把「核对线上哈希」从打印变成**真的只读检查**。给一个不在线上的哈希，
演练就红并退出 1——失败路径就是这样在本地演示的，**不需要把生产打回旧版本**。
真演练（`--apply`）会走一遍真部署 + 真回滚，属于**需要人工确认的生产操作**。

## 回滚的真实风险与限制（回滚前必读）

1. **回滚不是原子的、也不是瞬间的**：它是**又发一次部署**。CF 边缘在传播窗口内可能新旧并存
   （`release.mjs` 的线上核对为此重试 6 次）。这段时间不同访客可能拿到不同版本。
2. **它不回滚用户数据——这是最危险的一条**。工程/预设/场景都存在浏览器 `localStorage`，服务器上没有可回滚的用户数据。
   `src/state/persist.ts` 对「`schema` 比自己新的文档」的处理是**返回 `null`**（"a payload from a newer build read by
   an older one"），也就是**退回默认值**：用户看到的不是自己的工程。所以
   `rollback.mjs` 会在回滚前比较目标版本与线上版本记录的 `storeSchema`，**倒退就拒绝执行**，
   除非你确认过「那次 schema bump 是纯增量的、或没人用过新版本」并显式加 `--force`。
3. **它管不到已装 PWA / Service Worker**（见上一节）：回滚只对新访客立刻生效。
4. **它回滚不了别的服务**：只有 Worker 静态资源，没有 D1/R2/KV，也没有第三方服务可回滚。
5. **窗口很小（N=5）而且只在本机**：`release/retained/` 不进 git。换机器 / 清目录 = 回滚点全丢。
6. **`--force` 是危险开关**：它绕过「已经就是这一版 / 已经是最新」的保护和上面第 2 条的拒绝，允许把同一版重发一遍。
7. **窗口外的版本回不来**：被清理掉的版本只能靠重新发布（重新走一遍 `release`）恢复——前提是那时的提交还在。
8. **回滚不改 git**：`vW` 的 tag 仍然指向那份坏代码。回滚是**运行状态**的事实，不是 git 的事实。
   下一次发布基于哪个提交要人工判断；`index.json` 里的 `action: "rollback"` 事件就是为了留下这条线索。
9. **`--cf-rollback <version-id>` 是逃生门，不是默认路径**：它不重传、很快，但目标版本在 CF 的远端列表里，
   我们没法事先校验它对应的字节；脚本仍然按保留快照的 shell 哈希与 SW cache 名做线上核对，对不上就报红。
