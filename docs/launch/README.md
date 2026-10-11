# 宣发物料

- [wave1/](wave1/) —— 第一波（中文社区，v0.3.0）：定位「免费开源、完全离线，一句话找到视频素材里的那一秒」，面向剪辑师 / 自媒体 / 摄影师。
  Eagle 目前只当作「可以搭配使用」，不打「替代」。后续以「更强更好用的同类替代」定位，靠自身功能取胜；
  刻意不做 Eagle 资源库读取 / 导入（2026-10-11 决定）。
- 总体策略、已知局限、发布前清单：[../launch.md](../launch.md)。

## 素材和成片（不进仓库）

都在 `~/workspace/dancer/vixel-demo/`：

| 路径 | 内容 |
|---|---|
| `footage/` | 22 段演示视频（公有领域 / CC0，来源见 `footage/LICENSES.md`） |
| `footage-data/` | 用 Vixel 索引好的演示库（`--user-data-dir` 指向它） |
| `promo/video-search-16x9.mp4` | 横版 1080p，约 65 秒（B 站 / V2EX / 少数派） |
| `promo/video-search-9x16.mp4` | 竖版 1080×1920，约 61 秒（小红书 / 抖音 / 视频号） |
| `promo/video-search.gif` | 搜「火箭发射」→ 直接跳到命中片段，约 7 秒、3.4 MB（V2EX / README） |
| `promo/cover-xiaohongshu.png` | 小红书封面 1080×1440 |

## 重新生成

```bash
npm run build
D=~/workspace/dancer/vixel-demo
VIXEL_PROMO=video VIXEL_RECORD=$D/promo/video-raw.mp4 npx electron . --user-data-dir=$D/footage-data
PROMO_PRESET=video node scripts/make-promo.mjs $D/promo/video-raw.mp4 $D/promo/video-search-16x9.mp4
node scripts/make-vertical.mjs $D/promo/video-raw.mp4 $D/promo/video-search-9x16.mp4
ffmpeg -ss 13 -i $D/promo/video-raw.mp4 -frames:v 1 $D/promo/frame-seagull.png
ELECTRON_RUN_AS_NODE=1 npx electron scripts/make-cover.mjs $D/promo/frame-seagull.png $D/promo/cover-xiaohongshu.png
```

演示里用的查询都在这个库上验证过能稳定命中第一条（`window.api.search` / `vixel search`）：

| 查询 | 命中 | 说明 |
|---|---|---|
| 海鸥喂小鸟 | seagull-chicks.mp4 · 0:32–0:45 | 动作 |
| 火箭发射 | rocket-falcon9.mp4 · 0:32–0:45（第二条 rocket-jason3） | 跳到片段中段 |
| train arriving at a station | train-zagreb.mp4 · 0:32–0:45 | 英文查询 |
| OLD SACRAMENTO | horse-wagons.mp4（图中文字 + 片段） | 画面里的字 |
| 烟花 | fireworks-kamakura.mp4 | 场景 |
| 猫在喝水 / 马在吃草 / 雪中的树林 / 夜晚的城市灯光 | cat-puddle / horse-grazing / snow-falling / rain-window-night | 备用 |

不要用：「狗在跑」（库里没有合适的镜头，会给出低置信度结果）、「下雨的街道」（第一条不对）。
