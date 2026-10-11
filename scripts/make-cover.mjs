/**
 * 小红书封面（1080×1440，3:4）：录屏里的一帧（详情页，命中片段高亮）+ 大标题。
 *
 *   node scripts/make-cover.mjs <frame.png> <out.png>
 *
 * 帧从 VIXEL_PROMO=video 的录屏里取，例如：ffmpeg -ss 13 -i raw.mp4 -frames:v 1 frame.png
 */
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const [frame, out] = process.argv.slice(2)
if (!frame || !out) { console.error('usage: node scripts/make-cover.mjs <frame.png> <out.png>'); process.exit(1) }
const W = 1080, H = 1440
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const text = (y, size, t, color = '#F2EDE6', weight = 600) =>
  `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Hiragino Sans GB, PingFang SC" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(t)}</text>`

// 截图放中下部，左右各留 40，圆角
const SHOT_W = W - 80
const shot = await sharp(frame).resize(SHOT_W).toBuffer()
const shotH = (await sharp(shot).metadata()).height
const mask = Buffer.from(`<svg width="${SHOT_W}" height="${shotH}"><rect width="${SHOT_W}" height="${shotH}" rx="22" fill="#fff"/></svg>`)
const rounded = await sharp(shot).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
const top = 560
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><radialGradient id="g" cx="0.5" cy="0.3" r="0.9"><stop offset="0" stop-color="#262A3B"/><stop offset="1" stop-color="#0B0C11"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  ${text(200, 96, '一句话')}
  ${text(330, 96, '找到素材里的那一秒', '#D9B48A')}
  ${text(440, 44, '剪辑师的免费离线素材搜索', '#C9C2B8', 400)}
  ${text(top + shotH + 120, 46, '免费开源 · 完全离线 · 不上传素材', '#F2EDE6', 400)}
  ${text(top + shotH + 190, 36, 'Vixel · macOS / Windows', '#8E877E', 400)}
</svg>`
await sharp(Buffer.from(svg)).composite([{ input: rounded, left: 40, top }]).png().toFile(out)
console.log(`cover → ${out}`)
