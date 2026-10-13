# syntax=docker/dockerfile:1
# Vixel Server（Docker / NAS 版）多阶段构建，linux/amd64 + linux/arm64。
#
#   docker buildx build --platform linux/arm64 -t vixel:latest --load .
#
# 需要构建前在仓库里准备好（均有 sha256 校验，见 scripts/download-models.mjs）：
#   resources/models/            EmbeddingGemma 2 (.litertlm) + PaddleOCR + 人脸模型
#   resources/litert/linux-x64 / linux-arm64   LiteRT-LM 原生库（LITERT_PLATFORM=… 下载）
# 镜像内置全部模型，运行时零出站请求。

# ─── 1. 编译：服务器 TS + 网页前端（平台无关，可被 buildx 跨平台复用）────────────
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts：跳过 postinstall（electron-builder install-app-deps 会下载 Electron 并按
# Electron ABI 重编原生模块 —— 桌面专用；这里只需要 tsc / vite 等纯 JS 工具链）
# --legacy-peer-deps：react-leaflet 5 声明 peer react 19、仓库用 react 18（运行时兼容，桌面同样组合）
RUN npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund
COPY tsconfig.json tsconfig.node.json tsconfig.server.json tsconfig.web.json vite.web.config.ts tailwind.config.js postcss.config.js ./
COPY scripts/server-postbuild.mjs scripts/
COPY src ./src
RUN npx tsc -p tsconfig.server.json && node scripts/server-postbuild.mjs \
 && npx vite build --config vite.web.config.ts

# ─── 2. 运行时依赖（Node ABI，按目标平台装；docker/package.json 是服务器专属依赖集）──
FROM node:22-bookworm AS deps
WORKDIR /app
COPY docker/package.json docker/package-lock.json ./
# onnxruntime-node 的 install 脚本在 linux-x64 上默认会去下载 CUDA EP（容器纯 CPU 用不上）；
# ffmpeg-static 的 install 脚本按当前平台下载对应二进制（buildx 每个平台各下各的）
RUN npm_config_onnxruntime_node_install=skip npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# ─── 3. 模型 + LiteRT 运行时（按目标架构挑选）───────────────────────────────────
FROM node:22-bookworm AS assets
ARG TARGETARCH
WORKDIR /staging
COPY resources/models ./resources/models
COPY resources/litert ./litert-all
RUN set -e; \
    case "$TARGETARCH" in \
      amd64) lp=linux-x64 ;; \
      arm64) lp=linux-arm64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    test -f "litert-all/$lp/liblitert-lm.so" || { echo "missing resources/litert/$lp — run LITERT_PLATFORM=$lp node scripts/download-models.mjs litert-runtime" >&2; exit 1; }; \
    mkdir -p resources/litert; \
    mv "litert-all/$lp" "resources/litert/$lp"; \
    rm -rf litert-all resources/models/README.md

# ─── 4. 运行镜像 ───────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    VIXEL_DATA_DIR=/data \
    VIXEL_LIBRARY_DIRS=/photos
WORKDIR /app

# 非 root 运行：基础镜像自带的 node(1000) 改名为 vixel；root 启动时 entrypoint 按 PUID/PGID
# 调整后降权（群晖习惯）。setpriv（util-linux）/ usermod 都在基础镜像里，无需额外安装。
RUN usermod -l vixel -d /app -s /usr/sbin/nologin node && groupmod -n vixel node \
 && mkdir -p /data /photos && chown vixel:vixel /data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/web ./dist/web
COPY --from=assets /staging/resources ./resources
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/vixel-entrypoint

EXPOSE 8080
VOLUME /data

# /healthz 免认证、无信息（src/server/index.ts）；slim 镜像没有 curl，用 node fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.VIXEL_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["vixel-entrypoint"]
# node 直接当 PID 1：SIGTERM 的优雅退出在 src/server/index.ts 里处理；
# 子进程（推理 worker / ffmpeg）都是 node 的直接子进程，由 child_process 回收
CMD ["node", "dist/server/index.js"]
