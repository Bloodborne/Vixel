# v0.4.1 发布包 · Launch kit

所有帖子由作者本人发布、本人回复；这里只是可直接粘贴的草稿。
**发帖前置条件**：v0.4.1 Release 已发布且安装包可下载
（https://github.com/RGB-loop/Vixel/releases/tag/v0.4.1 —— 写稿时尚未发布，发帖前务必确认），
README 顶部新 GIF / 截图已在 main 分支可见。

## 文件索引

| 文件 | 平台 | 语言 | 形式 |
|---|---|---|---|
| [v2ex.md](v2ex.md) | V2EX 分享创造 | 中 | 长帖 + 回复预案 |
| [xiaohongshu.md](xiaohongshu.md) | 小红书 | 中 | 竖版视频笔记 |
| [bilibili.md](bilibili.md) | B 站 | 中 | 2–3 min 视频脚本 + 简介 |
| [jike.md](jike.md) | 即刻 | 中 | 短帖 |
| [sspai.md](sspai.md) | 少数派 Matrix | 中 | 投稿大纲 + 开头全文 |
| [zhihu.md](zhihu.md) | 知乎 | 中 | 回答 + 专栏文章 |
| [juejin.md](juejin.md) | 掘金 | 中 | 技术长文大纲 |
| [weibo.md](weibo.md) | 微博 | 中 | 短文案 |
| [douyin.md](douyin.md) | 抖音 / 视频号 | 中 | 竖版脚本 + 文案 |
| [show-hn.md](show-hn.md) | Hacker News | 英 | 标题 + maker 首评（含 FAQ） |
| [reddit.md](reddit.md) | r/macapps · r/DataHoarder · r/VideoEditing · r/opensource · r/software | 英 | 分 sub 草稿 + 规则注意 |
| [producthunt.md](producthunt.md) | Product Hunt | 英 | tagline / 描述 / 首评 / 画廊 |
| [x-twitter.md](x-twitter.md) | X / Twitter | 英 | 7 帖 thread + 3 条单发 |
| [linkedin.md](linkedin.md) | LinkedIn | 英 | 短帖 |

## 72 小时发布时间线（中文先行，英文次日）

> D1 取周二或周三。时间均为北京时间；英文频道换算成美东 / 太平洋时间执行。

| 时间 | 渠道 | 物料 | 备注 |
|---|---|---|---|
| **D1** 10:00 | V2EX 分享创造 | GIF | 前 2 小时守回复 |
| D1 12:00 | 即刻 | 横版 16:9 zh | 同步「独立开发者」圈 |
| D1 20:00 | 小红书 | 竖版 9:16 + 封面 | 外链不可点，写 GitHub 搜索词 |
| D1 20:00 | 微博 | 横版 16:9 zh + 截图 | 与小红书同晚 |
| D1 20:30 | 抖音 / 视频号 | 竖版 9:16 | 文案同小红书精简 |
| **D2** 上午 | 知乎 | GIF + 截图 | 回答挂现成问题，文章进专栏 |
| D2 12:00 | B 站 | 需另录 2–3 min 视频 | 简介放链接与素材来源 |
| D2 21:00（= 美东 9:00） | **Show HN** | 仓库链接 | 发完立刻贴 maker 首评；全天守 |
| D2 21:30 | X thread | GIF / en 16:9 | 首帖带 HN 讨论链接可互导 |
| **D3** 15:01（= 太平洋 0:01） | Product Hunt | en 16:9 + 画廊 8 图 | 前 4–6 小时在线回复 |
| D3 晚 | r/macapps | en 16:9 或 GIF | 首个 Reddit 帖 |
| D3 晚 | 少数派 Matrix 投稿 | 截图 | 审核需几天，不赶窗口 |
| D3–D4 | 掘金 | 技术长文 | 工作日上午 |
| **D4+** | r/DataHoarder → r/opensource → r/software → r/VideoEditing（先私信 mod） | 各自草稿 | 每天最多一个 sub |
| D4+ | LinkedIn | en 16:9 | 一条即可 |
| D5+ | HelloGitHub / 阮一峰周刊自荐 | 一句话 + 链接 + GIF | 在其仓库提 issue |

**r/editors 不发布任何推广帖**（版规明确禁止 self-promotion）；仅在他人求工具的帖子里
带披露地回复。

## 物料清单（文件 → 用途）

本地路径：`~/workspace/dancer/vixel-demo/promo-0.4.1/`

| 文件 | 规格 | 用在 |
|---|---|---|
| `vixel-0.4.1-zh-16x9.mp4` | 1920×1080 · 79 s · 中文字幕 | 即刻、微博、B 站素材、知乎 |
| `vixel-0.4.1-en-16x9.mp4` | 1920×1080 · 87 s · 英文字幕 · 英文界面 | PH 视频位、X、LinkedIn、Reddit |
| `vixel-0.4.1-zh-9x16.mp4` | 1080×1920 · 75 s | 小红书、抖音、视频号、Shorts |
| `voiced/vixel-0.4.1-zh-16x9-voice.mp4` | 同上 + AI 男声旁白（Seed Audio 1.0，≈-16 LUFS） | 优先用这版：B 站、知乎、微博 |
| `voiced/vixel-0.4.1-en-16x9-voice.mp4` | 同上 + 英文男声旁白 | 优先用这版：PH、X、LinkedIn、Reddit |
| `voiced/vixel-0.4.1-zh-9x16-voice.mp4` | 同上 + 竖版男声旁白（开头 3 s 钩子） | 优先用这版：抖音、小红书、视频号 |
| `voiced/narration-*.txt` + `voiced/lines-*/` | 台词 + 起始时间 + 单句 mp3 | 校对 / 重混音 |
| `vixel-0.4.1-demo.gif` | 720 px · 15 s · 5.8 MB | V2EX、X、知乎、HN 评论区（图床） |
| `hero-0.4.1.gif` | 640 px · 4.7 MB | 已提交为 `docs/media/hero.gif`（README） |
| `cover-xiaohongshu-0.4.1.png` | 1080×1440 | 小红书封面 |
| `social-preview-0.4.1.png` | 1280×640 | 已提交为 `docs/media/social-preview.png`；GitHub 仓库 Settings → Social preview 需手动上传 |
| `shots-zh/` | 2880×1800 截图 ×64（light/dark 全视图） | 中文平台配图 |
| `shots-en/` | 同上，英文界面 | PH 画廊、Reddit、X |
| `raw-*.mp4` + `combined-*.mp4` | 原始录屏 + 拼接版（带 timeline.json） | 重新剪辑用，不直接发布 |

复现 / 重录：`src/main/capture.ts`（场景）、`scripts/concat-raws.mjs`、`scripts/make-promo.mjs`
（`PROMO_PRESET=video`、`PROMO_LANG=en`）、`scripts/make-vertical.mjs`、`scripts/make-cover.mjs`、
`scripts/make-social-preview.mjs`。演示库在 `/Users/Shared/Vixel Demo/`（检查器里只显示中性路径），
数据目录 `~/workspace/dancer/vixel-demo/{footage,photos}-data-shared`。

旁白：`node scripts/make-voiceover.mjs <video.mp4> <narration.json> <out.mp4> [--lines-dir d] [--reference ref.mp3]`
—— narration.json 是 `{voice, lines:[{start,text}]}`（voice 为自然语言音色描述，以「说：」结尾）；
逐句调 Seed Audio 1.0（按 voice+text 缓存，重跑不重复计费），检查每句放不放得下，adelay 定位 →
loudnorm ≈ -16 LUFS → AAC 192k，视频流原样 copy。凭据读环境变量 `SEEDAUDIO_*`
（或 `~/.config/vixel/seedaudio.env`），仓库里不存任何密钥。三个 narration JSON 在
`promo-0.4.1/voiced/` 下，16:9 版场景时间 = timeline.json + 2.8 s（片头 3.4 s − 交叉淡化 0.6 s），竖版不加偏移。

## 共用 FAQ（各平台用自己的话说）

**为什么安装包约 600 MB？**
语义模型（EmbeddingGemma 2）、OCR、人脸模型全部打包在内。代价是下载体积，换来的是装好即离线可用、
首次启动不再下载任何东西。

**安装包没有签名，怎么装？安全吗？**
签名证书未购买。macOS：系统设置 → 隐私与安全性 → 「仍要打开」（或
`xattr -dr com.apple.quarantine /Applications/Vixel.app`）；Windows：SmartScreen → 更多信息 → 仍要运行。
代码完全开源（MIT），可自行审计、自行编译。

**真的离线吗？怎么证明？**
断网使用即可验证。实现上：模型内置、渲染进程网络请求整体拦截（源码 `enforceOfflinePolicy`）、
地图为打包的离线底图；无账号、无遥测。唯一例外（0.4 起）：从浏览器拖入仅含 URL 的图片时，
主进程为这一次拖放下载该 URL 一次；浏览器扩展的本地服务默认关闭、只听 127.0.0.1、从不对外请求。

**支持什么格式？**
图片 jpg/png/webp/heic/avif 等；RAW cr2/cr3/nef/arw/dng/raf/orf/rw2；设计 svg/psd/psb/pdf/ai
（Windows 上 PDF/AI 用内置 pdf.js，无需装 Ghostscript）；视频 mp4/mov/m4v/webm/mkv/avi；
音频 mp3/m4a/aac/wav/flac/ogg/opus。EPS 不支持。

**会动我的文件吗？**
不会。原文件只读；索引、缩略图、标签都在 Vixel 自己的数据目录。只有「清理相似照片」里
你确认后才会把多余副本移到废纸篓（可恢复）。

**和 Eagle 什么区别？**
Eagle 是成熟的付费素材管理：收集链、标签体系很强，文件导入它自己的资源库，AI 搜索限图片。
Vixel 免费开源、直接原地索引你现有的文件夹，强项是视频按片段搜画面和声音并跳到那一段。
不做 Eagle 资源库导入；两者可共存。

**和 DigUp 什么区别？**
同一个基础模型（EmbeddingGemma 2），取舍不同。Vixel：有 Windows 版；中文做了分词（DigUp 的 FAQ
说明中文等不分词语言的精确词匹配受影响）；模型随安装包、首启即离线（DigUp 首启下载约 865 MB、
每天在线检查一次更新，可关闭）；多一层整理（人物 / 标签 / 智能相册 / 相似清理 / 收集箱）。
DigUp 的覆盖面在文档类（PDF 全文、代码）更广，macOS 专注。都 MIT，按需选、可并用。

**和 Immich 什么区别？**
Immich 是自建服务器方案，强在多设备同步与手机备份；Vixel 是桌面应用，装上就能用，不需要服务器。

**和 Apple 照片什么区别？**
系统相册只管「照片」图库且绑苹果生态；Vixel 索引任意文件夹（含素材盘），跨 macOS / Windows，
视频按片段搜、图中文字可搜。

**支持 Linux / Intel Mac 吗？**
Linux 能编译但未测试；Intel Mac 暂无安装包。GitHub issue +1 是最有效的催更。

**搜索质量怎么衡量的？**
仓库内置公开评测集（`evals/`，两个标注集约 80 条查询，含反例），`npm run eval` 可复现：
demo 库 top-1 1.00、footage 库 0.94（均为"我们的评测集上"）。已知搜不准的例子直接打印在
评测输出里。不发布速度数字。

## 纪律（沿用 wave1）

- 不刷 star、不互赞群；不对外说任何速度数字；不用私人照片 / 真人面孔做素材。
- 竞品一律客观陈述可验证差异，不贬损。
- 报 bug 的引导到 GitHub Issues；自己先建好 issue 再贴链接。
- 记录高频问题与 bad case，作为 0.5 排期输入。
