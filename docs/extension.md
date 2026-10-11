# 浏览器扩展：存到 Vixel / Save to Vixel

Chrome / Edge 扩展（Manifest V3）：右键网页图片「存到 Vixel」，或右键页面「保存页面截图到 Vixel」，
存进本机 Vixel 的收集箱。源码在仓库的 `extension/` 目录。

## 工作方式（和隐私）

- **图片由扩展在浏览器里自己取**（它本来就显示着这张图），然后把字节 POST 给本机 Vixel 的收集服务。
  **Vixel 本身从不发起任何对外请求**。
- 收集服务**默认关闭**，只监听 `127.0.0.1`（局域网其他设备连不上），要求**每次安装随机生成的配对令牌**，
  校验 `Origin`（只认 `chrome-extension://…`）、只收 `image/*`、单张上限 50 MB、有限速。
- 一并记录的元数据：图片地址、页面地址、页面标题（检查器里显示为「来源」）。

## 安装（加载已解压的扩展程序）

1. 打包或直接用源码目录：
   ```bash
   npm run build:extension   # 产出 dist/vixel-extension-<版本>.zip（解压备用）
   ```
2. 打开 `chrome://extensions`（Edge：`edge://extensions`），右上角打开**开发者模式**。
3. 点**加载已解压的扩展程序**，选仓库里的 `extension/` 目录（或解压后的目录）。
4. 在 Vixel 里：**设置 → 通用 → 浏览器扩展**，勾选「允许浏览器扩展收集」，**拷贝**配对令牌。
5. 右键扩展图标 → **选项**，粘贴令牌（端口默认 41720，和 Vixel 设置里保持一致），保存。
6. 点扩展图标：弹窗显示「已连接 Vixel」即配对成功。

## 使用

- 右键网页上的图片 → **存到 Vixel**。
- 右键页面空白处 → **保存页面截图到 Vixel**（当前可见区域）。
- 已在库里的内容不会重复保存（按内容判重），Vixel 会提示「已在库中」并定位到已有的那张。
- 弹窗里能看到连接状态和最近保存的记录。

## English quick start

1. `npm run build:extension` (or just use the `extension/` folder as-is).
2. Open `chrome://extensions` (Edge: `edge://extensions`), enable **Developer mode**, click **Load unpacked**, pick `extension/`.
3. In Vixel: **Settings → General → Browser extension**, enable it and **copy** the pairing token.
4. Extension **Options** → paste the token (default port 41720) → Save.
5. Right-click any image → **Save to Vixel**; or right-click the page → **Save page screenshot to Vixel**.

The extension fetches image bytes itself and POSTs them to Vixel's local server (`127.0.0.1` only, off by
default, random per-install token, `chrome-extension://` origin check, `image/*` only, 50 MB cap, rate limited).
Vixel itself never makes outbound requests.
