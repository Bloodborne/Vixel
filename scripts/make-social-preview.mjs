/**
 * GitHub 社交预览图（1280×640）：左侧标题 + 卖点，右侧真实界面截图（圆角）。
 *
 *   node scripts/make-social-preview.mjs <screenshot.png> <out.png>
 *
 * 截图取 VIXEL_CAPTURE 的 light-search.png 之类（16:10 左右为宜）。
 */
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const [frame, out] = process.argv.slice(2)
if (!frame || !out) { console.error('usage: node scripts/make-social-preview.mjs <screenshot.png> <out.png>'); process.exit(1) }
const W = 1280, H = 640
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const text = (x, y, size, t, { weight = 400, color = '#F2EDE6', anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Hiragino Sans GB, PingFang SC, Helvetica Neue" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(t)}</text>`

// 右侧：截图缩放到高约 560，圆角，露出左边一栏文字
const SHOT_H = 560
const shot = await sharp(frame).resize({ height: SHOT_H }).toBuffer()
const meta = await sharp(shot).metadata()
const mask = Buffer.from(`<svg width="${meta.width}" height="${meta.height}"><rect width="${meta.width}" height="${meta.height}" rx="14" fill="#fff"/></svg>`)
const rounded = await sharp(shot).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
const icon = await sharp('build/icon.png').resize(96).png().toBuffer()

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><radialGradient id="g" cx="0.3" cy="0.3" r="1"><stop offset="0" stop-color="#262A3B"/><stop offset="1" stop-color="#0B0C11"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  ${text(64, 206, 64, 'Vixel', { weight: 600 })}
  ${text(64, 268, 30, '本地 AI 搜索：照片 · 视频 · 音频 · 设计文件', { color: '#D9B48A', weight: 600 })}
  ${text(64, 312, 24, 'Offline AI search for your media library', { color: '#C9C2B8' })}
  ${text(64, 388, 24, '一句话找到视频里的那一刻', { color: '#F2EDE6' })}
  ${text(64, 428, 24, '完全离线 · 免费开源（MIT）', { color: '#F2EDE6' })}
  ${text(64, 500, 22, 'macOS (Apple Silicon) · Windows (x64)', { color: '#D9B48A', weight: 600 })}
  ${text(64, 540, 20, '模型内置 · 无账号 · 不上传任何数据', { color: '#8E877E' })}
</svg>`
await sharp(Buffer.from(svg))
  .composite([
    { input: icon, left: 64, top: 64 },
    { input: rounded, left: W - meta.width + 180, top: Math.round((H - SHOT_H) / 2) },
  ])
  .png()
  .toFile(out)
console.log(`social preview → ${out}`)
