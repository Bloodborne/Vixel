# Vixel Server（Docker / NAS 版）设计与测试计划

起因：V2EX 首发帖下两位用户要服务器版——"手机/电脑网页端访问"、"装到群晖上"。2026-10-13。

## 目标

- 一个 Docker 镜像（linux/amd64 + linux/arm64），群晖 Container Manager / docker compose 一条命令跑起来。
- 浏览器访问（电脑 + 手机），功能和桌面版的"找"一致：语义搜索、视频片段跳转、图中文字、以图搜图、人物、地图、标签 / 收藏 / 筛选 / 智能相册。
- 和桌面版同一套 `src/core`（索引、搜索、数据库），**搜索结果必须和桌面版一致**（同一个模型、同一套排序）。
- 依旧完全离线：镜像内置模型，运行时不对外发请求。原文件只读（建议 `:ro` 挂载）。

非目标（第一版不做）：多用户 / 权限分级、在线转码播放所有编码（浏览器播不了的给下载）、浏览器扩展收集、文件写回。

## 架构

```
Docker 容器（Node 22，无 Electron）
├── server/            HTTP + WebSocket（同一端口，默认 8080）
│   ├── api            与桌面 window.api 一一对应的 JSON 接口（search / getPhoto / people / tags …）
│   ├── media          /thumb/:id  /face/:id  /frame/:id  /file/:id（Range 支持，视频拖动）
│   ├── events         WebSocket：索引进度、库变化（替代 IPC 事件）
│   └── auth           单用户口令 → HttpOnly 会话 cookie；可选 API token
├── inference worker   child_process.fork（替代 Electron utilityProcess），LiteRT CPU（XNNPACK）
├── src/core/*         原样复用：db / watcher / indexer / search / face / ocr / autotag …
└── web/               复用 src/renderer 的 React 界面；window.api 换成 fetch/WebSocket 实现
```

- **一套界面两种后端**：renderer 只认 `window.api`。桌面版由 preload 注入（IPC），网页版注入一个同签名的 HTTP 实现（`src/web/api.ts`）。桌面专属能力（在访达中显示、系统播放器、全局快捷键、托盘、拷贝文件、收集箱拖入）在网页版里隐藏或换成"下载"。
- **平台差异**：sips / qlmanage（仅 macOS）在 Linux 走已有的跨平台分支；PDF / AI 预览桌面版用隐藏窗口里的 pdf.js，服务器版需要一个不依赖 Electron 的实现（候选：pdfjs-dist + @napi-rs/canvas，或第一版不支持 PDF，明确列出）。
- **配置**：环境变量 + 首次进入的网页设置页。`VIXEL_PASSWORD`（必填，或首次访问时设置）、`VIXEL_LIBRARY_DIRS`（逗号分隔，默认扫描 `/photos` 下的一级目录）、`VIXEL_DATA_DIR=/data`、`PUID/PGID`（群晖权限）、`VIXEL_THREADS`（CPU 推理线程，默认核数一半）。
- **省资源**：NAS 常见 4–8 GB 内存、低功耗 CPU。沿用电源策略的"回填 / 实时"分级；后台索引低优先级；首次索引在网页上显示进度和预估。

## 测试计划（先于实现）

| 层级 | 测什么 | 怎么测 | 通过标准 |
|---|---|---|---|
| 1. 单元 | 认证（口令、cookie、过期、错误口令限速）、媒体路由的路径校验（只能读库内文件和 data 目录，`../`、符号链接、绝对路径都拒绝）、Range 请求、配置解析 | vitest | 全过；路径穿越用例全部 403 |
| 2. 接口契约 | 网页版 `window.api` 覆盖桌面版 `Api` 的每个方法：要么有服务端实现，要么显式标记"桌面专属" | 类型层面：`WebApi satisfies Api`（tsc）+ 一个列出桌面专属方法的测试 | tsc 通过；新增 IPC 方法而没处理网页版时测试失败 |
| 3. 搜索一致性 | 服务器版和桌面版对同一个库给出同样的结果 | `npm run eval -- --server http://localhost:8080`：评测脚本通过 HTTP 跑同一套 evals（demo + footage） | 与 `evals/baseline.json` 完全一致（Δ = 0） |
| 4. 端到端（浏览器） | 登录、首页网格、搜索、打开视频跳到命中片段并能拖动播放、以图搜图（上传）、人物、地图、标签 / 收藏 / 筛选、索引进度实时更新 | 本机 Chrome 无头 + CDP 驱动（沿用 capture 的做法），桌面 1440×900 和手机 390×844 两种视口截图，逐张看 | 每个场景截图正确；手机视口可用（不横向溢出、可点） |
| 5. Docker（arm64） | 镜像能构建、能跑、能索引 demo + footage 库 | 本机 Docker Desktop（arm64 原生）：`docker compose up`，库目录 `:ro` 挂载，数据卷独立 | 索引 0 错误；层级 3、4 在容器里重跑通过 |
| 6. Docker（amd64） | 群晖主流是 Intel/AMD | buildx 构建 amd64；在 601_win（x86_64）上跑，或本机 qemu 跑冒烟 | 容器能启动、能索引、能搜索 |
| 7. 离线 | 运行时零出站请求 | 容器挂在 `internal: true` 的网络上（无外网），所有层级 4 场景照常；另外抓容器出站连接（应为 0） | 全部功能正常、无出站 |
| 8. 资源 | NAS 内存 | 索引 footage 库期间采样容器内存峰值（`docker stats`） | 峰值 < 2 GB（内部指标，不对外宣传） |
| 9. 安全 | 默认不裸奔 | 未登录访问任何 API / 媒体 → 401；错误口令多次 → 限速；不设口令时拒绝启动或强制首次设置 | 全部符合 |
| 10. 回归 | 桌面版不受影响 | 原有 tsc / npm test / test:db / 截图巡检 / eval | 全过、截图无变化 |

## 交付顺序

1. 服务器骨架：Node 进程跑起 core + 推理 worker + HTTP API + 认证 + 媒体路由（层级 1、2、3、9）。
2. 网页前端：renderer 复用 + Web API 实现 + 桌面专属功能降级 + 手机布局（层级 4）。
3. Docker 镜像 + compose + 群晖说明（层级 5、6、7、8）。
4. 文档、README、CHANGELOG；发布 `ghcr.io/rgb-loop/vixel` 镜像（需要时）。
