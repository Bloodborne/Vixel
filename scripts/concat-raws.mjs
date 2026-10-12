/**
 * 拼接多段 VIXEL_RECORD 录屏（各自带 .timeline.json），时间轴按偏移合并，
 * 供 make-promo.mjs / make-vertical.mjs 当作一段录屏处理。
 *
 *   node scripts/concat-raws.mjs <out.mp4> <raw1.mp4> <raw2.mp4> [...]
 *
 * 所有输入必须同分辨率 / 帧率（VIXEL_RECORD 固定 1920×1080@30）。重新编码一次（crf 16），
 * 画质损失可忽略；最终成片还会再压一遍。
 */
import { readFileSync, writeFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')

const [out, ...raws] = process.argv.slice(2)
if (!out || raws.length < 2) { console.error('usage: node scripts/concat-raws.mjs <out.mp4> <raw1.mp4> <raw2.mp4> [...]'); process.exit(1) }

const dur = (f) => {
  const r = spawnSync(ffmpeg, ['-i', f], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr)
  return +m[1] * 3600 + +m[2] * 60 + +m[3]
}

let offset = 0
const timeline = []
for (const raw of raws) {
  const t = JSON.parse(readFileSync(`${raw}.timeline.json`, 'utf8'))
  for (const s of t) timeline.push({ ...s, start: s.start + offset, end: s.end + offset })
  offset += dur(raw)
}

const inputs = raws.flatMap((r) => ['-i', r])
// 不同屏幕缩放下录出的分辨率可能不同（如 2560×1440 vs 1920×1080），先统一到 1080p 再拼
const norm = raws.map((_, i) => `[${i}:v]scale=1920:1080:flags=lanczos,setsar=1[v${i}]`).join(';')
const filter = `${norm};` + raws.map((_, i) => `[v${i}]`).join('') + `concat=n=${raws.length}:v=1:a=0[v]`
const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs,
  '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-r', '30', out], { stdio: 'inherit' })
if (r.status !== 0) { console.error('ffmpeg concat failed'); process.exit(1) }
writeFileSync(`${out}.timeline.json`, JSON.stringify(timeline, null, 2))
console.log(`concat → ${out} (${dur(out).toFixed(1)}s, ${timeline.length} scenes)`)
