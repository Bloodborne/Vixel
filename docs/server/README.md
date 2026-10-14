# Vixel Server · Docker / NAS 部署指南

> English version below: [Deployment guide (English)](#vixel-server--docker--nas-deployment-guide)

Vixel 服务器版把桌面版的"找"搬进浏览器：同一套索引、同一套模型、同样的搜索结果，
跑在你自己的 NAS / 服务器上，手机和电脑网页直接访问。完全离线 —— 模型内置在镜像里，
运行时不发任何对外请求；照片原文件只读挂载，Vixel 永远不写、不动、不删它们。

支持架构：`linux/amd64`（Intel/AMD 群晖、威联通、x86 服务器）和 `linux/arm64`
（ARM 群晖、树莓派 5 等 ≥4 GB 内存的 ARM 设备）。

## 快速开始（docker run）

```bash
docker run -d --name vixel \
  -p 8080:8080 \
  -e VIXEL_PASSWORD='你的口令' \
  -v /path/to/photos:/photos:ro \
  -v vixel-data:/data \
  --restart unless-stopped \
  vixel:latest
```

浏览器打开 `http://<主机IP>:8080`，输入口令登录。首次启动会开始索引 `/photos`
下的全部照片和视频（语义向量、缩略图、图中文字、人物），索引进度在网页顶部实时显示；
索引是断点续跑的，中途重启容器不会从头来。全部跑完之前搜索就已经可用，只是结果会
随索引推进越来越全。

## docker compose

仓库根目录有带注释的 [docker-compose.yml](../../docker-compose.yml) 示例。最小形态：

```yaml
services:
  vixel:
    image: vixel:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      VIXEL_PASSWORD: "change-me"
      PUID: "1000"
      PGID: "1000"
    volumes:
      - /volume1/photo:/photos:ro
      - vixel-data:/data
volumes:
  vixel-data:
```

多个照片目录：各挂一行，再用 `VIXEL_LIBRARY_DIRS` 逗号分隔列出：

```yaml
    environment:
      VIXEL_LIBRARY_DIRS: /photos/family,/photos/travel
    volumes:
      - /volume1/photo/family:/photos/family:ro
      - /volume1/video/travel:/photos/travel:ro
```

## 群晖 Container Manager 逐步说明

1. **套件中心**安装 **Container Manager**（DSM 7.2+；旧版叫 Docker）。
2. 把镜像导入群晖（正式发布到镜像仓库前）：本机 `docker save vixel:latest | gzip > vixel.tar.gz`，
   上传到 NAS 任意目录，Container Manager → **映像 → 新增 → 从文件添加**选中它。
3. **项目 → 新增**：项目名 `vixel`，路径随意，来源选"创建 docker-compose.yml"，
   粘贴上面的 compose 内容并改两处：
   - `VIXEL_PASSWORD`：你的登录口令（至少 4 位）；
   - `volumes` 里的 `/volume1/photo`：你的照片共享文件夹实际路径。
4. **PUID / PGID**：填照片文件夹属主用户的 UID/GID，Vixel 以该身份读照片、写自己的
   数据目录。查法：SSH 进 NAS 执行 `id 你的用户名`（输出 `uid=1026(...) gid=100(...)`
   就填 `PUID: "1026"`、`PGID: "100"`）。照片挂载是 `:ro`（只读），Vixel 不会改动原文件。
5. 启动项目，浏览器打开 `http://<NAS-IP>:8080` 登录。

**首次索引要多久？** 取决于库的大小和 NAS 的 CPU（纯 CPU 推理，没有也不需要显卡）。
索引分级推进：缩略图和文件信息先行，语义向量、图中文字、人物随后补齐 —— 期间可以正常
浏览和搜索。进度条和预估显示在网页顶部；容器重启后从断点继续。

**内存建议**：建议 NAS 至少 4 GB 内存、给容器留出 2 GB 以上。镜像默认开低内存模式
（`VIXEL_LOW_MEMORY=1`）：语义模型和 OCR / 人脸模型从不同时驻留，索引按模型分组分批跑，
空闲几分钟后全部卸载 —— 设 `mem_limit: 2g` 也能完整索引（实测不触发 OOM、零失败任务），
搜索结果与常驻模式相同。代价是模型闲置后的第一次搜索要等模型重新加载（之后恢复即时）。
内存充裕（给容器 4 GB+）想要模型常驻、搜索永远即时，可设 `VIXEL_LOW_MEMORY=0`。
嫌索引吃 CPU 可以把 `VIXEL_THREADS` 调小（例如 `2`），索引会慢一些。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `VIXEL_PASSWORD` | （必填） | 网页登录口令，至少 4 位；不设则容器拒绝启动 |
| `VIXEL_LIBRARY_DIRS` | `/photos` | 容器内媒体库目录，逗号分隔 |
| `VIXEL_DATA_DIR` | `/data` | 索引数据库、缩略图、人脸向量等 |
| `PUID` / `PGID` | `1000` / `1000` | 运行身份（root 启动时 entrypoint 降权；只 chown `/data`，从不动照片挂载） |
| `VIXEL_THREADS` | 核数一半 | CPU 推理线程数 |
| `VIXEL_LOW_MEMORY` | `1`（镜像默认） | 低内存模式：语义模型与 OCR / 人脸模型不同时驻留，空闲后卸载（搜索时按需重载）。设 `0` 换回模型常驻（建议给容器 4 GB+） |
| `VIXEL_BACKEND` | `cpu`（镜像默认） | 语义模型推理后端：`cpu` / `gpu` / `auto`（GPU 优先，失败退 CPU）。设置页里选过的以设置为准 |
| `VIXEL_PORT` | `8080` | 容器内监听端口 |
| `VIXEL_COOKIE_SECURE` | 关 | `=1` 会话 cookie 永远带 `Secure`（全程 HTTPS 时用） |
| `VIXEL_TRUST_PROXY` | 关 | `=1` 信任反代头：`X-Forwarded-Proto` 为 https 时自动加 `Secure`，登录限速按 `X-Forwarded-For` 计 |

## 反向代理 / HTTPS

内网 HTTP 直连即可用。要从公网访问，务必放在 HTTPS 反向代理后面（群晖：控制面板 →
登录门户 → 高级 → 反向代理；或 Nginx / Caddy / Traefik），并给容器加 `VIXEL_TRUST_PROXY=1`。
WebSocket（索引进度实时推送）需要反代支持 Upgrade：群晖反向代理在"自定义标头"里点
"创建 → WebSocket"即可；Nginx 加 `proxy_set_header Upgrade $http_upgrade;` 和
`proxy_set_header Connection "upgrade";`。

认证是单用户口令 + HttpOnly / SameSite=Strict 会话 cookie，登录按 IP 限速。
即便如此，不建议把它裸暴露在公网 —— 套一层 VPN（Tailscale / WireGuard）更稳妥。

## 更新与备份

- **更新**：换新镜像重建容器即可（compose：`docker compose pull && docker compose up -d`，
  或 Container Manager 里重建项目）。索引数据在 `/data` 卷里，不会丢。
- **备份**：备份 `/data` 卷（里面是索引数据库、缩略图、人脸数据 —— 没有你的原始照片）。
  丢了也只是重新索引一遍的事，但大库重索引耗时。Vixel 自身每天还会在 `/data/backups`
  里滚动保留数据库备份。
- **回收**：删除容器 + `/data` 卷即可完全清除，照片原文件不受任何影响。

## 限制（当前版本）

- **单用户**：一个口令，所有人看到同一个库。多用户 / 权限分级还没有。
- **CPU 推理**：容器里不用 GPU。索引比桌面版（Apple Silicon GPU）慢。同一种 CPU 架构上搜索结果与桌面版完全一致；
  x86（多数群晖）和 ARM 的浮点运算有细微差别，得分几乎相同的结果偶尔会互换名次，整体准确度不变。
- **浏览器播不了的视频编码**（如部分 HEVC / ProRes）提供下载，暂不在线转码。
- **EPS 不支持**（桌面版同样不支持）；PDF / AI（PDF 兼容存储）、SVG、PSD/PSB 正常索引。
- 桌面专属能力（在访达中显示、系统播放器、收集箱、快速搜索面板等）在网页版隐藏或降级为下载。

---

# Vixel Server · Docker / NAS deployment guide

The server edition brings the desktop "find" experience to the browser: same indexing
pipeline, same models, the same search quality — running on your own NAS or server,
reachable from any phone or desktop browser. Fully offline: all models are baked into
the image, nothing ever phones home; your originals are mounted read-only and never touched.

Architectures: `linux/amd64` (Intel/AMD Synology, QNAP, x86 servers) and `linux/arm64`
(ARM Synology models, Raspberry Pi 5 and other ARM boxes with ≥4 GB RAM).

## Quick start (docker run)

```bash
docker run -d --name vixel \
  -p 8080:8080 \
  -e VIXEL_PASSWORD='your-password' \
  -v /path/to/photos:/photos:ro \
  -v vixel-data:/data \
  --restart unless-stopped \
  vixel:latest
```

Open `http://<host>:8080`, log in with your password. The first start indexes everything
under `/photos` (semantic vectors, thumbnails, text-in-image OCR, people). Progress is
shown live at the top of the page; indexing is resumable, so restarting the container
continues where it left off. Search works while indexing is still running — results
simply get more complete as it progresses.

## docker compose

See the annotated [docker-compose.yml](../../docker-compose.yml) at the repo root.
For multiple photo folders, mount each one and list them in `VIXEL_LIBRARY_DIRS`
(comma-separated container paths).

## Synology Container Manager, step by step

1. Install **Container Manager** from Package Center (DSM 7.2+).
2. Until the image is published to a registry, import it: on your machine run
   `docker save vixel:latest | gzip > vixel.tar.gz`, upload it to the NAS, then
   Container Manager → **Image → Add → From file**.
3. **Project → Create**: paste the compose file; set `VIXEL_PASSWORD` and point the
   photo volume at your shared folder (keep `:ro`).
4. **PUID / PGID**: the UID/GID of the user that owns your photo folders. Find them
   via SSH: `id yourname` → `uid=1026(...) gid=100(...)` → `PUID: "1026"`, `PGID: "100"`.
   Vixel drops privileges to that identity on start and chowns only its own `/data`
   directory — never the photo mounts.
5. Start the project and open `http://<nas-ip>:8080`.

**How long does the first index take?** It depends on library size and the NAS CPU
(inference is CPU-only; no GPU needed or used). Indexing is tiered — thumbnails and
file info first, then semantic vectors, OCR and faces — and the library stays browsable
and searchable throughout. A progress bar with an estimate is shown in the web UI.

**Memory guidance**: plan for a NAS with at least 4 GB RAM and leave the container 2 GB
or more. The image ships with low-memory mode on (`VIXEL_LOW_MEMORY=1`): the semantic
model and the OCR / face models are never resident at the same time, indexing batches
tasks by model group, and all models are unloaded after a few idle minutes — a
`mem_limit: 2g` cap completes a full index (measured: no OOM kill, zero failed tasks)
with search results identical to the resident mode. The trade-off: the first search after the
models have gone idle waits for a reload (instant again afterwards). With plenty of RAM
(4 GB+ for the container), set `VIXEL_LOW_MEMORY=0` to keep models resident and every
search instant. Lower `VIXEL_THREADS` (e.g. `2`) for a gentler, slower index.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `VIXEL_PASSWORD` | (required) | Web login password, min 4 chars; the container refuses to start without it |
| `VIXEL_LIBRARY_DIRS` | `/photos` | Comma-separated library directories (container paths) |
| `VIXEL_DATA_DIR` | `/data` | Index database, thumbnails, face vectors |
| `PUID` / `PGID` | `1000` / `1000` | Runtime identity (entrypoint drops privileges when started as root; chowns `/data` only) |
| `VIXEL_THREADS` | half the cores | CPU inference threads |
| `VIXEL_LOW_MEMORY` | `1` (image default) | Low-memory mode: semantic and OCR/face models are never resident together and unload when idle (reloaded on demand for search). Set `0` to keep models resident (give the container 4 GB+) |
| `VIXEL_BACKEND` | `cpu` (image default) | Inference backend for the semantic model: `cpu` / `gpu` / `auto` (GPU first, fall back to CPU). A choice made in Settings takes precedence |
| `VIXEL_PORT` | `8080` | Port inside the container |
| `VIXEL_COOKIE_SECURE` | off | `=1` always sets `Secure` on the session cookie (all-HTTPS setups) |
| `VIXEL_TRUST_PROXY` | off | `=1` trusts proxy headers: `Secure` cookie when `X-Forwarded-Proto` is https, login rate limit keyed by `X-Forwarded-For` |

## Reverse proxy / HTTPS

Plain HTTP on the LAN works out of the box. For internet exposure, put it behind an
HTTPS reverse proxy (Synology Login Portal → Reverse Proxy, or Nginx / Caddy / Traefik)
and set `VIXEL_TRUST_PROXY=1`. The live-progress WebSocket needs Upgrade support:
on Synology add the WebSocket custom headers in the reverse-proxy rule; on Nginx set
`proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";`.

Auth is a single-user password with HttpOnly / SameSite=Strict session cookies and
per-IP login rate limiting. Still, prefer a VPN (Tailscale / WireGuard) over raw
internet exposure.

## Updating and backup

- **Update**: recreate the container from the new image (`docker compose pull &&
  docker compose up -d`). Index data lives in the `/data` volume and is kept.
- **Backup**: back up the `/data` volume (index DB, thumbnails, face data — none of
  your originals live there). Losing it only means re-indexing. Vixel also keeps
  daily rolling DB backups in `/data/backups`.
- **Removal**: delete the container and the `/data` volume; your photos are untouched.

## Limitations (current release)

- **Single user**: one password, everyone sees the same library.
- **CPU-only inference**: indexing is slower than the desktop app on Apple Silicon. On the
  same CPU architecture search results are identical to desktop; between x86 (most Synology
  models) and ARM, tiny floating-point differences can swap near-tied results — overall
  accuracy is unchanged.
- Video codecs the browser can't decode (some HEVC / ProRes) get a download button;
  no server-side transcoding yet.
- **EPS is not supported** (same as desktop). PDF / AI (PDF-compatible), SVG and
  PSD/PSB index normally.
- Desktop-only features (Reveal in Finder, system player, collection inbox, Quick
  Search panel) are hidden or degrade to "Download" in the web UI.
