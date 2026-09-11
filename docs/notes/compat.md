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
| WebKit | ❌ 缺系统库 `libicu74 / libxml2 / libmanette-0.2-0 / libenchant-2-2`，无法启动；装库后可纳入夜间跑 |

## 3. Firefox 仍未追平的用例（待查，非启动阻塞）

- `roll.spec.ts`「拖动右边缘改音符长度」：Firefox 下拖拽没有改变宽度（指针事件差异，待查）。
- `meter.spec.ts` 空闲电平、`flow.spec.ts` 连线动画、`audio.spec.ts` MPE、`pwa.spec.ts` 的 SW 控制：
  在 Firefox/Playwright 环境下不稳定，尚未判定是真实差异还是环境差异。
- `export.spec.ts` 的 MP3 离线渲染在 Firefox 下超出用例时限（渲染比 Chromium 慢很多）。
