# 浏览器兼容记录 / Browser compatibility notes

记录只在特定浏览器/环境出现、且已定位的问题，以及本机 E2E 能力现状。用户可见的结论写进
`docs/USER-GUIDE.md` 与更新记录；这里留技术细节与复现方式。

## 1. Firefox：启动卡在「正在启动…」（v1.72.0 修复）

**现象**：Firefox 里点「启动音频引擎」后按钮一直显示“正在启动…”，启动遮罩不消失，页面进不去；
控制台只有一条 JavaScript 警告，没有报错。

**定位**：`preload()` 在页面载入时就创建了 `AudioContext`（此时还没有用户手势）。Firefox 会把这样的
上下文视为被自动播放策略拦住，随后在点击手势里调用的 `ctx.resume()` 返回的 promise **永不 settle**
（既不 resolve 也不 reject）。启动流程 `await resume` 因此挂住，`busy` 一直是 true。
Chromium 下同一个上下文往往自己就变成 `running`，所以本地 Chromium E2E 从未暴露它。

**修复**：`src/audio/settle.ts::settleWithin(promise, ms)`——启动等待 `resume()` 最多 2.5 s，
超时就按上下文当前状态继续（`running` 或 `suspended`）；图已建好即视为「跑过」，于是遮罩收起、
显示「点按恢复」提示，之后任何手势都会再试一次 `resume()`。回归用例：
`e2e/boot.spec.ts`「a resume that is never answered still leaves a usable app」把 `resume()` 换成
永不 settle 的 promise，断言遮罩收起、键盘可用。

**验证**：本机 Firefox 跑同一套 E2E：修复前 `smoke.spec.ts` 45 s 超时，修复后 11 s 通过；
整包 Firefox 72 passed / 7 failed（修复前大面积卡在启动）。

## 2. 本机浏览器可用性

| 引擎 | 状态 |
| :--- | :--- |
| Chromium（Playwright 自带） | ✅ 全量 91 项 |
| Firefox（Playwright 自带） | ✅ 可跑；比 Chromium 慢，滚动/拖拽类用例偶有差异 |
| WebKit | ✅ 系统库装好后可本地运行（`npm run test:e2e:webkit`，单 worker）；比 Firefox 更慢：单个用例常 30–45 s，整包连跑会有大量用例在「点击后卡住」处超时 |

## 3. WebKit（Safari 内核）本机现状

依赖装好后 WebKit 能跑起来：单独跑 `e2e/fxgraph.spec.ts`、`e2e/smoke.spec.ts` 之类的用例可以通过，
但整包连跑（24 个用例的抽样）出现 23 个超时。超时的形态一致：Playwright 报 “attempting click action …”
之后一直不返回，而页面快照显示点击其实已经生效（例如预设抽屉已经打开）。也就是说 **WebKit 下点击之后
主线程会有一次很长的停顿**，怀疑与 AudioWorklet 渲染线程抢 CPU（或 WebKit 的自动播放/音频线程调度）有关，
需要单独用一个快速开关（例如不启动引擎只测 UI）来隔离，暂记为待查。

实践建议：本地用 `npm run test:e2e:webkit`（`--workers=1`）逐个 spec 跑，或分文件跑；整包的判据仍然放在 CI。

## 4. Firefox 仍未追平的用例（待查，非启动阻塞）

- `roll.spec.ts`「拖动右边缘改音符长度」：Firefox 下拖拽没有改变宽度（指针事件差异，待查）。
- `meter.spec.ts` 空闲电平、`flow.spec.ts` 连线动画、`audio.spec.ts` MPE、`pwa.spec.ts` 的 SW 控制：
  在 Firefox/Playwright 环境下不稳定，尚未判定是真实差异还是环境差异。
- `export.spec.ts` 的 MP3 离线渲染在 Firefox 下超出用例时限（渲染比 Chromium 慢很多）。

## 5. 部署后核对线上资源的两个坑（Cloudflare）

1. `wrangler deploy` 之后 **CF 边缘可能还缓存着旧的 `index.html`**（`cache-control: max-age=0,
   must-revalidate`，但边缘 HIT 会先给旧副本）：用带随机查询串的请求核对资源 hash，
   若第一次仍是旧的，**再跑一次 `npx wrangler deploy`**（第二次会提示 “No updated asset files”，
   但会把新清单推上去），几秒后即一致。
2. 核对方式：`curl -s "https://synth.wangda.today/?cb=$RANDOM" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'`
   与 `grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html` 对比，两边一致才算部署成功。
