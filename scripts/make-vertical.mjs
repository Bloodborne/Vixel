/**
 * 竖版宣传片（小红书 / 抖音，1080×1920）：复用 VIXEL_RECORD 的录屏和 timeline.json。
 * 上方大标题，中间是完整的应用画面（不裁切，保持真实界面），下方是这一幕的搜索词（timeline 里的 query）
 * 和字幕，最后接竖版片尾卡。
 *
 *   node scripts/make-vertical.mjs <raw.mp4> <out.mp4>
 *
 * 文案是视频素材版的（配 VIXEL_PROMO=video 录屏）。字体同 make-promo（macOS：Hiragino Sans GB）。
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')
const sharp = require('sharp')

const [raw, out] = process.argv.slice(2)
if (!raw || !out) { console.error('usage: node scripts/make-vertical.mjs <raw.mp4> <out.mp4>'); process.exit(1) }
const timeline = JSON.parse(readFileSync(`${raw}.timeline.json`, 'utf8'))
const FONT = process.env.PROMO_FONT || '/System/Library/Fonts/Hiragino Sans GB.ttc'
const W = 1080, H = 1920, FPS = 30, XF = 0.6
// 应用画面：整幅缩到 1080 宽（16:9 → 1080×608），放在标题下面
const VIDEO_Y = 600, VIDEO_H = 608
const CAPTION_Y = VIDEO_Y + VIDEO_H + 110
const tmp = mkdtempSync(join(tmpdir(), 'vixel-vertical-'))
const run = (args) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`)
}
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const text = (x, y, size, t, { weight = 400, color = '#F2EDE6', anchor = 'middle' } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Hiragino Sans GB, PingFang SC" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(t)}</text>`
const bg = `<defs><radialGradient id="g" cx="0.5" cy="0.35" r="0.9"><stop offset="0" stop-color="#232637"/><stop offset="1" stop-color="#0B0C11"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>`

// 背景：图标 + 标题 + 底部一行承诺；应用画面和字幕叠在上面
const icon = await sharp('build/icon.png').resize(150).png().toBuffer()
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}
  ${text(W / 2, 360, 76, 'Vixel', { weight: 600 })}
  ${text(W / 2, 470, 58, '一句话，找到视频素材里的那一秒', { weight: 600, color: '#D9B48A' })}
  <rect x="0" y="${VIDEO_Y - 2}" width="${W}" height="${VIDEO_H + 4}" fill="#000"/>
  ${text(W / 2, 1700, 44, '完全离线 · 免费开源 · 不上传素材', { color: '#C9C2B8' })}
  ${text(W / 2, 1770, 36, 'macOS · Windows', { color: '#8E877E' })}
</svg>`)).composite([{ input: icon, left: (W - 150) / 2, top: 140 }]).png().toFile(join(tmp, 'bg.png'))

await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}
  ${text(W / 2, 760, 84, '完全离线', { weight: 600 })}
  ${text(W / 2, 870, 84, '免费开源', { weight: 600 })}
  ${text(W / 2, 1000, 44, '模型在你的电脑上运行', { color: '#C9C2B8' })}
  ${text(W / 2, 1066, 44, '素材不上传，不需要账号', { color: '#C9C2B8' })}
  ${text(W / 2, 1230, 40, 'GitHub 搜索 RGB-loop/Vixel', { color: '#D9B48A' })}
</svg>`)).png().toFile(join(tmp, 'outro.png'))

// 主体：背景 + 录屏 + 搜索词（大号，金色）+ 字幕。字号 52 一行约 18 个字，场景文案都在这以内
const fade = (s) => {
  const a = s.start + 0.3, b = s.end - 0.2
  return `if(lt(t,${a}),0,if(lt(t,${a + 0.35}),(t-${a})/0.35,if(lt(t,${b - 0.35}),1,if(lt(t,${b}),(${b}-t)/0.35,0))))`
}
const captions = timeline.flatMap((s) => {
  const parts = []
  if (s.query) {
    const qf = join(tmp, `q-${s.name}.txt`)
    writeFileSync(qf, `搜「${s.query}」`)
    parts.push(`drawtext=fontfile='${FONT}':textfile='${qf}':fontsize=64:fontcolor=0xD9B48A:alpha='${fade(s)}':x=(w-text_w)/2:y=${CAPTION_Y}`)
  }
  const f = join(tmp, `cap-${s.name}.txt`)
  writeFileSync(f, s.caption)
  parts.push(`drawtext=fontfile='${FONT}':textfile='${f}':fontsize=52:fontcolor=white:alpha='${fade(s)}'` +
    `:box=1:boxcolor=white@0.08:boxborderw=26:x=(w-text_w)/2:y=${CAPTION_Y + 130}`)
  return parts
}).join(',')
run(['-loop', '1', '-i', join(tmp, 'bg.png'), '-i', raw, '-filter_complex',
  `[1:v]scale=${W}:${VIDEO_H}:flags=lanczos[v];[0:v][v]overlay=0:${VIDEO_Y}:shortest=1,${captions},format=yuv420p[o]`,
  '-map', '[o]', '-r', String(FPS), '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', join(tmp, 'main.mp4')])
run(['-loop', '1', '-t', '3.4', '-i', join(tmp, 'outro.png'), '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-crf', '16', join(tmp, 'outro.mp4')])

const dur = (f) => {
  const r = spawnSync(ffmpeg, ['-i', f], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr)
  return +m[1] * 3600 + +m[2] * 60 + +m[3]
}
run(['-i', join(tmp, 'main.mp4'), '-i', join(tmp, 'outro.mp4'), '-filter_complex',
  `[0][1]xfade=transition=fade:duration=${XF}:offset=${dur(join(tmp, 'main.mp4')) - XF}[v]`,
  '-map', '[v]', '-c:v', 'libx264', '-crf', '19', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
console.log(`vertical → ${out} (${dur(out).toFixed(1)}s)`)
