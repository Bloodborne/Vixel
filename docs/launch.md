# 宣发准备清单

## 一句话

**Vixel：用一句话找到照片和视频里的那一刻。完全离线，不上传，不需要账号。**

三个支点（**主打本地和隐私，不宣传速度**）：

1. **真的离线，没有例外**：模型、地图底图都随应用分发；渲染进程的一切网络请求被代码强制拦截（`enforceOfflinePolicy`），`vixel doctor` 可自查。不需要账号，没有遥测。
2. **连视频里的字和人都能搜**：视频按全分辨率帧做 OCR 和人脸识别（招牌、白板、菜单上的字都能搜到）。
3. **不糊弄**：语义 + 图中文字 + 文件名四路融合；没有把握时直说，不硬凑一屏结果。

> 不要对外引用速度数字（搜索延迟、索引速度）。文案只说“导入后立刻可以浏览，语义索引在后台进行”。

## 演示脚本（录屏 / 现场）

在演示用的库上先跑一遍，挑稳定命中的查询（用 CLI 先验：`vixel search "<查询>" --json`）：

1. 自然语言：一个**物体**（“西瓜”）+ 一个**场景**（“清真寺”）+ 一个**动作**（“跳舞”）。
2. 图中文字：招牌 / 价签上的词（“微信支付”），结果卡片上会出现“图中文字”角标。
3. 说“没有”：搜一个库里确实没有的东西（“海边”），展示“没有明确匹配”提示。
4. 视频：悬停拖动预览、详情里时间轴高亮命中片段。
5. 人物：人物页 →“是同一个人吗？”→ 合并 → 命名。
6. 离线：断网后重复第 1 步。

### 素材怎么重做

演示库：`~/workspace/dancer/vixel-demo/library`（34 项，来自 [Immich test-assets](https://github.com/immich-app/test-assets)，公有领域），
索引数据在同目录的 `data/`。重新生成（先 `npm run build`）：

```bash
D=~/workspace/dancer/vixel-demo
# 宣传片：按脚本操作真实界面录屏（src/main/capture.ts 的 PROMO_SCENES），再合成片头 / 字幕 / 片尾
VIXEL_RECORD=$D/promo/raw.mp4 npx electron . --user-data-dir=$D/data
node scripts/make-promo.mjs $D/promo/raw.mp4 docs/media/vixel-promo.mp4
# 截图：浅色 / 深色各一套
VIXEL_CAPTURE=$D/shots VIXEL_CAPTURE_QUERIES="花,STARBUCKS,猫" npx electron . --user-data-dir=$D/data
```

宣传片目前没有配乐；需要的话在剪辑软件里加，或用 ffmpeg 混入一段有授权的音乐。

⚠️ 不要用个人照片库做公开素材（家人、路人的脸）。Immich 官方 demo 服务器上的 3 万张照片**没有声明许可**，也不要用。

## 发布前必须完成（阻塞项）

- [x] **签名 + 公证**：决定暂不加入 Developer Program，发布 ad-hoc 签名版本（`build/adhoc-sign.cjs`），release 说明里写清首次打开步骤。（2026-10-10 查过：当前 Apple 账号**未加入** Apple Developer Program，只是免费账号）。
      - 推荐：加入 Developer Program（个人约 ¥688 / 年，需 Apple 账号开启双重认证，审核一般 1–2 天），之后用
        Developer ID 证书签名，发布构建跑 `electron-builder --mac --c.mac.notarize=true`，配置 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`。
      - 暂不加入：只能发未公证的版本。用户第一次打开会被拦截，需在「系统设置 → 隐私与安全性」里点“仍要打开”，
        或执行 `xattr -dr com.apple.quarantine /Applications/Vixel.app`。适合内测，不适合公开宣发。
- [ ] **模型随包**：确认 `resources/models` 下有 `litert/embeddinggemma-2-740m.litertlm`、`paddleocr/ppocrv5_dict.txt`（v5 字典，不是 `ppocr_keys_v1.txt`）、人脸模型，`resources/litert/<平台>` 下有 LiteRT 运行库（`npm run models:download`；交叉准备用 `LITERT_PLATFORM=win32-x64`）。安装包约 600 MB，下载页注明。
- [x] **全新目录冒烟**：打包后的 app 用空数据目录启动、用演示库跑完截图巡检（搜索 / 图中文字 / 视频 / 地图 / 人物）均正常。真机全新用户仍建议再试一次。
- [x] **版本号**：首个公开版本 v0.2.0（2026-10-11 发布，macOS + Windows）。
- [x] **宣传片 / README 配图**：已用演示库按真实界面重做（2026-10-10）。README 里内嵌播放的视频需要把新的 mp4 拖进 GitHub 网页编辑器生成附件链接。

### Windows 安装包

在 Windows 上构建（`npm ci` → `npm run models:download` → `npm run build` → `npx electron-builder --win --x64 --publish never`），产物 `release/Vixel-<版本>-setup.exe`（NSIS 一键安装到 `%LOCALAPPDATA%\Programs\Vixel`）。

- electron-builder 解压 winCodeSign 时要建符号链接，普通用户没有权限会反复失败：开“开发者模式”，或先手动把 `winCodeSign-2.6.0.7z` 解压到 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`。
- 国内网络：`ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 指向 npmmirror。
- 通过 ssh 远程构建时，ssh 会话结束会杀掉子进程，长任务用 `schtasks` 跑。

## 推广：怎么拿到 star

### 定位（一句话说清和别人的区别）

同类很多：Eagle（3 月已上线离线 AI 搜索，付费 ¥229）、Immich（要自建服务器）、Apple 照片（只限照片图库）、
SCM / rclip / Queryable（只搜图片，英文为主）。Vixel 站得住的点：

1. **免费开源 + 真离线**：装好就能用，首次也不下载模型，不需要账号 / 服务器 / API Key。
2. **视频和声音也能搜**：按片段搜画面 + 声音，打开直接跳到那一刻；视频画面里的字也能搜。别家大多只搜图片。
3. **中文最好用**：中文查询、中文 OCR（PaddleOCR v5）、中文界面。
4. **直接用你现有的文件夹**：不导入、不复制、不改原文件（Eagle 要把文件导入它自己的库）。

### 第一波：中文社区（界面是中文，先打这里）

48 小时内集中发，star 增速决定能不能上 GitHub Trending：

| 渠道 | 形式 | 要点 |
|---|---|---|
| V2EX「分享创造」 | 帖子 + GIF | 标题写痛点：“搜‘猫在沙发上’直接找到 3 年前那段视频”；作者在评论区及时回复 |
| 即刻 / 小红书 | 30 秒竖屏录屏 | 小红书搜“照片整理”“Eagle 替代”的人多；用演示库，不要露个人照片 |
| B 站 | 2–3 分钟演示 | 和 Eagle AI 搜索做同题对比（视频片段、图中文字）最有说服力 |
| 少数派 | Matrix 投稿 | 偏使用体验：怎么找回旧照片 / 截图里的发票 |
| 掘金 / 知乎 | 技术长文 | 《在 Electron 里用 LiteRT 跑 EmbeddingGemma 2》：koffi 调 C API、sqlite-vec、四路 RRF、相关性门槛，以及 mAP 0.844 → 0.974 的实测（docs/review/06）。技术文章带来的 star 最稳 |
| HelloGitHub、阮一峰《科技爱好者周刊》 | 提交 issue 自荐 | 月刊 / 周刊，长尾流量 |

### 第二波：英文社区（先做英文界面）

界面只有中文时，英文社区的转化很差，**做英文界面是国际推广的前提**（i18n，工作量中等）。做完再发：

- **Show HN**：标题直白（“Show HN: Vixel – offline semantic search for your photos and videos”）；美国时间工作日上午发。
- Reddit：r/macapps、r/DataHoarder、r/photography、r/selfhosted（说明不需要服务器）。
- **Google AI Edge / LiteRT-LM**：在 LiteRT-LM 仓库的 Discussions / showcase 里分享。这是少见的 C API + Electron 桌面应用案例，官方转发的可能性不小。
- Hugging Face：在 EmbeddingGemma 2 模型页的社区区发应用案例。
- Product Hunt：等英文界面和签名都就绪后再上。
- awesome 列表：awesome-mac、awesome-electron、awesome-privacy、awesome-local-ai。

### 仓库本身（转化率）

- [x] README：顶部 GIF、一句话、下载链接；英文 README；仓库描述、topics、社交预览图（2026-10-11）。
- [ ] README 加一张**对比表**（Vixel / Eagle / Immich / Apple 照片：离线、视频片段、图中文字、人物、价格、是否导入）。对比表是最容易被转发的部分。
- [ ] README 里内嵌宣传片（把 mp4 拖进 GitHub 网页编辑器生成附件链接）。
- [ ] **Homebrew cask**（自建 tap，`brew install --cask rgb-loop/tap/vixel`）：cask 安装时可以自动去掉 quarantine，绕开未公证的拦截。SCM 就是这么做的。
- [ ] 开 Discussions；准备 5–10 个 `good first issue`（比如格式支持、快捷键、翻译）。
- [ ] 每 2–3 周发一个小版本，每次发版就是一次再曝光。

### 不要做

- 不要刷 star、不要互刷群：GitHub 会清理，社区也会反感。
- 不对外宣传速度数字。
- 不要用个人照片做素材。

## 发布后一周盯什么

- 首次索引卡在哪一步、多久（任务面板 / `vixel doctor`）。
- “没有明确匹配”出现的频率：太高说明门槛 2.75σ 偏严（`RELEVANCE_MIN_Z`）。
- 人脸：非人脸（雕像、画像）被识别成人物的反馈 —— 目前靠用户“隐藏”。

## 已知局限（FAQ 里写清楚）

- 主要在 macOS（Apple Silicon）上测试。Windows x64 已在一台机器（RTX 3060）上冒烟：安装包、GPU 推理、索引、搜索、OCR、视频、地图、人物都正常；安装包未签名，SmartScreen 会提示“已保护你的电脑”→“仍要运行”。Linux 可构建、未测。
- Windows / Linux 上 RAW 用相机内嵌预览（分辨率以相机写入的预览为准）。
- 长视频只用首帧识别人脸（多帧采样待做）。
- 没有相册 / 收藏 / 编辑：Vixel 是“找”的工具，不替代照片管理软件。
