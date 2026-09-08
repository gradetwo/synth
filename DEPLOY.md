# GROOVE SYNTH GS-1 部署与运维指南

纯前端静态架构：没有后端、没有外部采样、没有第三方 CDN 请求。部署产物是一个
可直接放进任意 Web 根目录的静态目录，首次访问后即可完全离线运行。

---

## 1. 部署产物

运行 `npm run package` 后生成：

| 文件 | 说明 |
| :--- | :--- |
| `release/gs1-synth-<version>.zip` | **推荐**。解压内容即站点根目录（`index.html` 在顶层） |
| `release/gs1-synth-<version>-dist.zip` | 多一层 `dist/` 包裹，适合要求目录名的场景 |
| `release/gs1-synth-<version>.tar.gz` | Linux 服务器常用格式 |
| `release/SHA256SUMS` | 上述文件的 SHA-256 校验和 |

`dist/` 结构：

```
index.html                    应用入口（相对路径引用）
manifest.webmanifest          PWA 清单
sw.js                         离线优先 Service Worker（构建时生成）
icons/                        SVG + PNG 图标（含 maskable / apple-touch-icon）
assets/
  index-<hash>.js  index-<hash>.css
  vendor-react-<hash>.js  vendor-fonts-<hash>.css
  synth_core-<hash>.wasm      Rust DSP 核心（~131 KB，gzip ~31 KB）
  worklet-processor-<hash>.js AudioWorklet 处理器
  *.woff2 / *.woff            自托管字体
```

> `base: './'` 让所有资源使用相对路径，因此站点既可部署在域名根目录，也可
> 部署在 `/synth/` 之类的子目录下。

---

## 2. 本地预览

```bash
npm run build
npm run preview          # http://localhost:4173
# 或
cd dist && python3 -m http.server 8080
```

⚠️ 必须通过 HTTP(S) 访问，不能用 `file://` 直接打开：`AudioWorklet` 与
`Service Worker` 都要求安全上下文（`localhost` 视为安全）。

---

## 3. 生产部署

### 方案 A · Nginx

```bash
unzip release/gs1-synth-1.0.0.zip -d /var/www/gs1
```

```nginx
server {
    listen 443 ssl http2;
    server_name synth.example.com;
    root /var/www/gs1;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json
               application/wasm image/svg+xml;

    # WebAssembly 必须使用正确的 MIME 类型
    types { application/wasm wasm; }

    # SPA 回退
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Service Worker 与清单必须不缓存，保证更新可被检测
    location ~* (sw\.js|manifest\.webmanifest)$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # 带内容哈希的静态资源可长期缓存
    location ~* \.(js|css|wasm|woff2?|svg|png|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**无需**配置 `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`：
本架构不依赖 `SharedArrayBuffer`，参数同步由 `AudioParam` 完成，音符事件走
`Transferable MessagePort`。因此也可以安全地嵌入第三方 iframe / Notion 页面。

### 方案 B · Docker

```dockerfile
FROM nginx:alpine
COPY dist /usr/share/nginx/html
# 让 nginx 正确返回 .wasm
RUN sed -i 's|application/wasm;||' /etc/nginx/mime.types || true
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 方案 C · Vercel / Netlify / Cloudflare Pages / GitHub Pages

- Build command: `npm run build`
- Output directory: `dist`
- 均为纯静态，自带 CDN 与 HTTPS。GitHub Pages 需将 `base` 保持相对路径（已默认）。

---

## 4. 离线与更新

1. 首次访问：Service Worker 预缓存全部 65 个构建产物（约 920 KB）。
2. 之后断网：刷新仍可完整运行（DSP 在本地 WASM 中，音色库在本地 JS 中）。
3. 发布新版本：`sw.js` 的缓存名由构建内容哈希决定；新 Worker 在后台完成安装。
4. 界面右下弹出 **“新版本已就绪 · 立即更新”**；用户点击后新版本才激活并重载，
   不会中断正在进行的演奏。
5. 更新检测时机：页面重新可见时 + 每 30 分钟一次。

如需强制立即更新（例如内部环境），可在部署后清理 CDN 缓存并让用户硬刷新一次；
应用本身会在下次可见时自动发现新版本。

---

## 5. 音频启动与平台注意事项

- **必须有一次用户手势**：浏览器（尤其 iOS Safari）要求用户交互后才能启动
  `AudioContext`。界面首屏会显示“启动音频引擎”按钮，点击任意位置也会自动启动。
- **iOS 静音开关**：WebAudio 走媒体通道，若设备开启静音开关可能无声，请关闭。
- **建议使用耳机**：内置扬声器在低延迟模式下可能出现回声/啸叫。
- 若设备性能不足，DSP 侧会自动通过 `gs_trigger_smooth_downgrade()` 降低复音数
  （8/16/32 可配置），并让超额声部平滑释放，不会产生爆音。

### 浏览器支持

| 浏览器 | 最低版本 |
| :--- | :--- |
| Chrome / Edge | 91+（AudioWorklet + WebAssembly SIMD） |
| Safari / iOS Safari | 16.4+ |
| Firefox | 89+ |

WebAssembly SIMD 是硬性要求（构建时同时开启 Rust `+simd128` 与 clang
`-msimd128`）。

---

## 6. 性能指标（16 复音基准）

| 指标 | 实测/设计值 |
| :--- | :--- |
| WASM 体积 | 131 KB（gzip 31 KB） |
| 渲染块 | 动态 128–1024 帧，随宿主 `AudioContext` 变化 |
| 实时线程分配 | 0 Bytes（`gs_alloc_violations()` 持续为 0） |
| 内存 | 固定 8 MiB arena，运行期不发生 `memory.grow` |
| 总 dist | ~920 KB（含自托管字体与图标） |

---

## 7. 故障排查

| 现象 | 处理 |
| :--- | :--- |
| 无声音 | 点击“启动音频引擎”；确认系统/浏览器未静音；检查 iOS 静音开关 |
| 控制台报 `application/wasm` MIME | Nginx 增加 `types { application/wasm wasm; }` |
| 更新后仍是旧版本 | 确认 `sw.js` 未被 CDN 长缓存；强制刷新一次 |
| 首次加载后离线打不开 | 确认 `sw.js` 与 `manifest.webmanifest` 可访问且未被缓存策略拦截 |
| 声音卡顿 | 关闭其他占用音频/CPU 的标签页；应用会自动降低复音数 |
