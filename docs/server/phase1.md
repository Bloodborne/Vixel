# Vixel Server · 阶段 1 实现说明（服务器骨架）

对应 [plan.md](plan.md) 交付顺序 1：Node 进程跑起 core + 推理 worker + HTTP API + 认证 + 媒体路由，
覆盖测试层级 1、2、3、9。网页前端（阶段 2）、Docker 镜像（阶段 3）还没做。

## 跑起来

```bash
npm run server:deps        # 一次性：server/node_modules 装 Node ABI 的 better-sqlite3（见下）
npm run build:server       # tsc -p tsconfig.server.json → dist/server + 入口 shim
VIXEL_DATA_DIR=~/vixel-data \
VIXEL_LIBRARY_DIRS=~/Pictures,~/Movies \
VIXEL_PASSWORD=yourpass \
node dist/server/index.js
```

环境变量：`VIXEL_DATA_DIR`（必填）、`VIXEL_LIBRARY_DIRS`（逗号分隔）、`VIXEL_PORT`（8080）、
`VIXEL_HOST`（0.0.0.0）、`VIXEL_PASSWORD`（必填，或 `VIXEL_ALLOW_NO_AUTH=1` 仅限本机开发）、
`VIXEL_MODELS_DIR` / `VIXEL_LITERT_DIR`（默认 resources/…）、`VIXEL_THREADS`（LiteRT CPU 线程数，
默认核数一半）。解析逻辑见 `src/server/config.ts`。

## 架构决定

### 共享服务层（桌面 / 服务器不漂移的根）

原来写在 `src/main/index.ts` 各 IPC handler 里的逻辑全部移到 **`src/services/`**（传输无关）：

- `services/api.ts` — `createServices(ctx)`，`api` 对象的方法名 / 参数与 preload 的 `window.api`
  一一对应（嵌套组同形：`tags.*` / `cleanup.*` / `autoTags.*` / `collect.*`）。
  桌面 IPC handler 和服务器 HTTP 分发表都从这个对象来。
- `services/events.ts` — 事件总线；桌面把频道转成原 IPC 事件广播到各窗口，服务器转成 WebSocket 推送。
- `services/backup.ts` / `services/autotags.ts` / `services/media.ts` — 备份调度、自动标签服务、
  媒体路径解析（`vixel://` 与 `/media` 共用）。

桌面专属能力（原生对话框 / 菜单 / shell / 快速面板 / 收集箱导入 / 移到废纸篓）留在 `src/main`，
清单见 `src/server/apiSurface.ts` 的 `DESKTOP_ONLY_METHODS`；服务器对它们回 **501 + 说明**。

### 原生模块 ABI 策略

仓库的 `node_modules` 由 postinstall（`electron-builder install-app-deps`）按 **Electron** 的
NODE_MODULE_VERSION（130）重建。各原生依赖在普通 Node 22（127）下的实际情况：

| 模块 | 机制 | 纯 Node 可用 |
|---|---|---|
| better-sqlite3 | ABI 绑定（bindings） | ✗ 需要单独构建 |
| sharp / onnxruntime-node / @node-rs/jieba / koffi | N-API（ABI 稳定）或多 ABI 预编译 | ✓ |
| sqlite-vec | 纯 SQLite 扩展动态库 | ✓ |

解法：`server/package.json` 声明同版本 better-sqlite3，`npm run server:deps` 在
`server/node_modules` 装出 Node ABI 构建；`src/server/bootstrap.ts`（服务器入口的第一个 import）
在非 Electron 进程里把这些包的模块解析重定向过去。桌面 / CLI / eval（Electron ABI）零影响；
Docker 镜像（阶段 3）整个 `node_modules` 直接按 Node ABI `npm ci`，override 目录不存在时 bootstrap
是空操作 —— 同一份代码两边都能跑。`server/node_modules` 不入库（.gitignore 的 node_modules 规则）。

### 推理 worker

- 核心逻辑（embed / face / ocr 处理器 + 串行队列 + 搜索请求插队）移到
  `src/core/inference/worker.ts`；客户端通用逻辑（按需拉起、崩溃重启、卡死看门狗）移到
  `src/core/inference/client.ts`。
- 桌面：`src/main/inference.ts`（utilityProcess 接线）+ `src/main/inference-client.ts`（适配器）。
- 服务器：`src/server/inference-worker.ts` + `src/server/inference.ts`，`child_process.fork` 带
  **`serialization: 'advanced'`**（结构化克隆）—— Float32Array / Buffer 过进程边界语义与
  utilityProcess.postMessage 一致，消息协议不变。
- 后端选择不动：`backend: 'auto'`（macOS 上 GPU，Linux 容器里自动退 CPU/XNNPACK）；
  CPU 线程数走 `VIXEL_THREADS`（没设则核数一半）。CPU / GPU 向量一致，搜索结果不受影响。

### HTTP / WebSocket（一个端口，零框架；唯一新依赖 `ws`）

- `POST /api/<method>`，body `{"args": [...]}` → `{"ok":true,"result":…}`；方法名与 `window.api`
  完全一致（嵌套用点号 `tags.list`）。分发表由 `services.api` 扁平化生成（`src/server/api.ts`）。
- 以图搜图：`POST /api/searchByImage`，`application/octet-stream`（或 image/*）原始字节上传
  （上限 64 MB，query 参数 `limit` / `text` / `filters`）；JSON 形态只接受 `{fileHash}` ——
  `path` 指服务器文件系统，明确拒绝。
- 事件：`ws://host:port/events`（升级时验会话 cookie），消息 `{channel, payload}`；频道 =
  renderer 的 `on*` 订阅（library-changed / smart-albums-changed / index-progress /
  people-changed / tags-changed / autotags-changed / cleanup-progress）。
- 媒体：`GET /media/{thumb|image|media|sprite|face}/<id>`，与 `vixel://` 五个 host 一一对应，
  同一套 `services/media.ts` 解析器；`/media/media` 走与桌面相同的 `serveMediaFile`
  （手写 Range，200/206/416，视频拖动）。路径安全（`src/server/pathSafety.ts`）：路由只收数字 id，
  解析出的文件还要 realpath 落在监视文件夹或数据目录之内（`../`、编码穿越、符号链接逃逸、
  库外绝对路径一律拒绝）。
- `GET /healthz`：免认证、无信息，给 Docker healthcheck。

### 认证（`src/server/auth.ts`）

单用户口令（`VIXEL_PASSWORD`，不设则拒绝启动）→ `POST /api/login` 发无状态签名会话 cookie
（HttpOnly / SameSite=Strict / 30 天；HMAC 密钥随机生成持久化在 `<dataDir>/server-secret`，0600，
删除即吊销全部会话）。口令比较常数时间；登录按 IP 限速（15 分钟窗口 5 次失败，限速期间先拒后验）。
CSRF：所有 POST（含 login）必须带 `X-Vixel` 头 —— 服务器不回任何 CORS 头，跨站预检必败，
加上 SameSite=Strict 双保险。运行时零出站请求（桌面唯一的联网点"收集箱按 URL 下载"是桌面专属）。

### PDF / AI 的决定

桌面版 PDF/AI 靠隐藏 BrowserWindow 里的 pdf.js（Win/Linux）或 sips/qlmanage（macOS）。服务器版
没有 Electron：**macOS 本机开发仍走 sips，Linux（Docker/NAS）阶段 1 明确不支持 PDF/AI** ——
启动时 `restrictDesignExts(['.svg','.psd','.psb'])` 把它们从支持格式里拿掉，这两类文件不入库、
不出现在任务队列里（而不是每个 PDF 一条失败任务）。SVG/PSD/PSB 照常（sharp 纯 Node 可渲染）。
阶段 3 再评估 pdfjs-dist + @napi-rs/canvas（两者许可 Apache-2.0 / MIT，均有 linux x64/arm64 预编译；
代价是镜像 +~10 MB 和一条纯 Node 渲染路径的维护），或维持"列明不支持 + 给下载"。

## 测试（对应 plan.md 层级）

| 层级 | 怎么跑 | 内容 |
|---|---|---|
| 1 单元 | `npm test`（vitest） | `src/server/auth.test.ts`（口令 / cookie 签名 / 过期 / 伪造 / 限速）、`pathSafety.test.ts`（`../`、编码穿越、符号链接逃逸、库外绝对路径、根本身是符号链接）、`config.test.ts`；Range 解析已有 `src/core/media/range.test.ts` + `serve.test.ts` |
| 2 契约 | `npm run typecheck` + `npm test` | `src/server/apiSurface.contract.test.ts`：类型层把 `Api`（preload）展开成点号方法名，必须被 IMPLEMENTED / DESKTOP_ONLY / EVENT / SPECIAL 四清单精确覆盖（两个方向都查，新增 IPC 方法没归类 → tsc 报错带方法名）；参数签名相容性同文件检查；运行时再断言 HTTP 分发表 ≡ IMPLEMENTED_METHODS |
| 3 搜索一致性 | `npm run eval -- --set <set> --server <url> --password <pw> --compare evals/baseline.json --strict` | 评测走 HTTP。服务器跑在"库副本"上：拷 `library.db(+wal/shm)` 到临时 `VIXEL_DATA_DIR`（库根绝对路径保持不变）；副本里先 `INSERT OR REPLACE INTO meta_state VALUES('autotags.enabled','0')`——否则服务器的自动标签服务会在旧 schema 的评测库上新打标签，标签通道改变结果（桌面 eval 是裸引擎 + 只读副本，没有这个服务）。适配器会先等 `getModelStatus.embeddingReady`（模型没热时搜索退化成纯文本通道，和桌面 UX 一致，但评测必须等）。两个库均 **Δ = 0** |
| 9 安全 | `npm run test:server:security` | 黑盒打真实服务器：未登录 /api /media /ws → 401；无 X-Vixel → 403；错误口令连续 → 429（限速期间正确口令也拒）；伪造 cookie → 401；桌面专属 → 501；媒体路由拒绝路径样式 id；注销清 cookie；不设口令拒绝启动 |

层级 10（桌面回归）在阶段 1 收尾时全量跑过：typecheck / vitest / test:db / 本地 eval Δ=0 /
`npm run build` / 演示库截图巡检。

## 阶段 2（网页前端）注意事项

- `src/web/api.ts` 实现 `window.api` 同签名对象：方法 → `fetch POST /api/<name>`，`on*` → 一条
  WebSocket 按 channel 分发，`locale` → 登录后由 `getLocaleSetting` 解析。桌面专属方法按
  `DESKTOP_ONLY_METHODS` 隐藏/降级（下载代替"在访达中显示"等）。
- 媒体 URL：renderer 的 `vixel://thumb/<id>` 等换成 `/media/thumb/<id>`（`mediaUrl.ts` 抽一层）。
- 静态文件路由（服务 renderer 构建产物）还没加 —— 阶段 2 在 `src/server/index.ts` 挂。
- cleanup.scan 的进度现在广播给所有 WS 客户端（单用户场景；桌面原来只发起窗口）。

## 阶段 3（Docker）注意事项

- 镜像内直接 `npm ci --omit=dev`（Node ABI），不需要 server/node_modules override；
  `scripts/download-models.mjs` 已支持 `LITERT_PLATFORM=linux-arm64`（aarch64 wheel，sha256 校验）。
- ffmpeg：桌面用 ffmpeg-static（有 linux x64/arm64 包）；容器里也可改用发行版 ffmpeg，
  `isFfmpegAvailable` 已有探测。
- `GET /healthz` 可直接用作 HEALTHCHECK；优雅退出已处理 SIGTERM。
- 反代 TLS 下的 cookie Secure 旗标：目前不加（内网 HTTP 常态）；上公网文档里要求反代 + 考虑
  `VIXEL_COOKIE_SECURE=1`（待加）。
