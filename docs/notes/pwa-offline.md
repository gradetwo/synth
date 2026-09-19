# 离线打不开：一份「重定向来的响应」和它藏了很久的原因

## 症状

对一个已经装好 Service Worker 的页面，**关掉网络再刷新**，得到浏览器的错误页（Playwright 里是
`page.reload: net::ERR_FAILED`）。最反直觉的是：

- `navigator.serviceWorker.ready` 已 resolve，`controller` 非空，worker 确实在控制页面；
- 缓存里 33 个文件一个不少，`caches.match('/index.html')` 拿得到响应；
- **在线**一切正常，所以「二次访问」的 E2E 一直是绿的。

线上（`https://synth.wangda.today/`）与本地 `vite preview` 都能用同一个脚本复现，所以不是环境差异。

## 原因

`cache.addAll()` 是**跟随重定向**的 `fetch`（redirect: follow）。而 Cloudflare 的静态资源服务器
（以及 `vite.config.ts` 里模拟它的 `prettyUrlPlugin`）会把 `/index.html` **307 重定向到 `/`**。
于是 `cache.addAll(['./index.html', …])` 存下来的那份响应带着 `response.redirected === true`，
只是键名仍是 `/index.html`。

导航请求的 redirect mode 是 `"manual"`，浏览器**拒绝消费**带 `redirected` 标记的响应——直接以
`net::ERR_FAILED` 中止这次加载。这就是「缓存齐全、worker 在岗、页面打不开」。

在线路径早就处理了这件事：worker 用 `./?v=<cache>` 取 shell 时，如果响应是重定向来的就重建一份再交出去
（这是 v1.52.1 修 `/index.html` → `/` 那次事故时加的）。**离线路径走的是缓存分支，把带标记的响应原样交给了浏览器。**

## 修法

`scripts/gen-sw.mjs` 里把重建抽成一个函数，导航处理器的**每一条分支**（网络、缓存、最终的网络兜底）都过一遍：

```js
const legal = async (response) => {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, { status: 200, statusText: 'OK', headers: response.headers });
};

event.respondWith(
  fetch('./?v=' + CACHE, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('shell');
      return legal(response);
    })
    .catch(() => caches.match('./index.html')
      .then((cached) => cached || caches.match('./'))
      .then((cached) => cached || fetch(request, { cache: 'no-store' })))
    .then(legal)
);
```

另一个可选修法是把 `./` 而不是 `./index.html` 放进预缓存列表（`/` 是 200，不带重定向）。没有采用，原因是
预缓存键与「导航 URL 可能是 `/` 也可能是 `/index.html`」这件事会纠缠在一起，而 `legal()` 对所有分支都成立、
也不依赖宿主是否重定向。

## 回归测试

1. `e2e/pwa.spec.ts › opens from the precache with the network off`：联网装载并受 worker 控制 → 断网重载 →
   出现启动按钮 → **断网点击启动**，断言 `.kbd-dock.open`（即缓存的 wasm 与 worklet 真能跑）。
   **双向验证过**：把缓存响应按修复前的方式原样交出，这条测试就会以 `page.reload: net::ERR_FAILED` 失败。
2. `src/pwa/register.test.ts`（4 条，单元）：横幅上报、`applyUpdate` 只重载一次、非生产/无 worker 返回
   `'unsupported'`、`recoverFromStaleBuild` 清缓存且每会话只重定向一次。

## 顺带发现的第二件事

`checkForUpdate()` 原来用 `'serviceWorker' in navigator` 判断，但**非安全来源**（非 localhost 的
普通 `http://`）上该属性存在、值是 `undefined`：点「检查更新」会抛 `TypeError`，而不是回答「不支持」。
`recoverFromStaleBuild` / `registerServiceWorker` 早已检查容器本身，现在三处一致。

## 自己复现

```bash
npm run build                      # 生成 dist/（含 sw.js）
npx vite preview --port 4174       # 需要一个真实 http 源：Service Worker 在 file:// 下不工作
PLAYWRIGHT_BROWSERS_PATH=.pw-browsers npx playwright test e2e/pwa.spec.ts --project=chromium
```

要点：**必须真的把网络关掉**（Playwright 的 `context.setOffline(true)`）才算测到；只验证「受 worker 控制」
和「缓存列表齐全」曾经看起来通过，而问题恰恰在这两者之间。
