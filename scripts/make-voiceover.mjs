/**
 * 给宣传片加 AI 旁白（ByteDance Seed Audio 1.0 TTS）。
 *
 *   node scripts/make-voiceover.mjs <video.mp4> <narration.json> <out.mp4> [--lines-dir <dir>] [--reference <mp3>]
 *
 * narration.json：[{ "start": 秒, "text": "台词", "voice": "声音/语气描述（自然语言，以“说：”或 says: 结尾）",
 *                    "speech_rate": 可选整数 }]
 *   顶层也可以是 { "voice": "…", "lines": [...] }，lines 里省略 voice 时用顶层的。
 *
 * 凭据从环境读取（SEEDAUDIO_APP_ID / SEEDAUDIO_ACCESS_KEY / SEEDAUDIO_BASE_URL / SEEDAUDIO_MODEL），
 * 未设置时尝试加载 ~/.config/vixel/seedaudio.env。绝不在仓库里存任何密钥。
 *
 * 行为：逐句调用 TTS（结果按 voice+text 哈希缓存在 lines-dir，重跑不重复计费），检查每句时长
 * 是否在下一句开始之前放得下，然后 adelay 定位 → amix → loudnorm（约 -16 LUFS）→ AAC 192k，
 * 视频流原样 copy（不重编码，字幕/画面不变）。--reference 传一个 mp3 作为音色参考（references.audio_data）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { homedir } from 'os'
import { createHash, randomUUID } from 'crypto'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')

// ── args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flags = {}
for (let i = args.length - 2; i >= 0; i--) {
  if (args[i] === '--lines-dir') { flags.linesDir = args[i + 1]; args.splice(i, 2) }
  else if (args[i] === '--reference') { flags.reference = args[i + 1]; args.splice(i, 2) }
}
const [video, narrationPath, out] = args
if (!video || !narrationPath || !out) {
  console.error('usage: node scripts/make-voiceover.mjs <video.mp4> <narration.json> <out.mp4> [--lines-dir <dir>] [--reference <mp3>]')
  process.exit(1)
}

// ── credentials（仅环境变量 / 用户目录下的 env 文件，绝不硬编码）────────────
const ENV_FILE = join(homedir(), '.config/vixel/seedaudio.env')
if (!process.env.SEEDAUDIO_APP_ID && existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
  }
}
const { SEEDAUDIO_APP_ID, SEEDAUDIO_ACCESS_KEY } = process.env
const BASE = process.env.SEEDAUDIO_BASE_URL || 'https://openspeech.bytedance.com'
const MODEL = process.env.SEEDAUDIO_MODEL || 'seed-audio-1.0'
if (!SEEDAUDIO_APP_ID || !SEEDAUDIO_ACCESS_KEY) {
  console.error('missing SEEDAUDIO_APP_ID / SEEDAUDIO_ACCESS_KEY (env or ~/.config/vixel/seedaudio.env)')
  process.exit(1)
}

// ── narration ────────────────────────────────────────────────────────────
const parsed = JSON.parse(readFileSync(narrationPath, 'utf8'))
const defaultVoice = Array.isArray(parsed) ? '' : (parsed.voice || '')
const lines = (Array.isArray(parsed) ? parsed : parsed.lines).map((l) => ({ ...l, voice: l.voice ?? defaultVoice }))
const linesDir = flags.linesDir || join(dirname(out), basename(out).replace(/\.mp4$/, '') + '-lines')
mkdirSync(linesDir, { recursive: true })

const run = (a, opts = {}) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-y', ...a], { encoding: 'utf8', ...opts })
  if (r.status !== 0) throw new Error(`ffmpeg failed (${a.join(' ')}):\n${r.stderr}`)
  return r
}
const probeDur = (f) => {
  const r = spawnSync(ffmpeg, ['-i', f], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr)
  if (!m) throw new Error(`no duration for ${f}`)
  return +m[1] * 3600 + +m[2] * 60 + +m[3]
}

const reference = flags.reference
  ? [{ audio_data: readFileSync(flags.reference).toString('base64') }]
  : undefined

const tts = async (line) => {
  const prompt = line.voice
    ? (/[:：]\s*$/.test(line.voice) ? `${line.voice}“${line.text}”` : `${line.voice}：“${line.text}”`)
    : line.text
  const body = {
    model: MODEL,
    text_prompt: prompt,
    audio_config: { format: 'mp3', sample_rate: 44100 },
  }
  if (Number.isInteger(line.speech_rate)) body.audio_config.speech_rate = line.speech_rate
  if (reference) body.references = reference
  const res = await fetch(`${BASE}/api/v3/tts/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-App-Id': SEEDAUDIO_APP_ID,
      'X-Api-Access-Key': SEEDAUDIO_ACCESS_KEY,
      'X-Api-Request-Id': randomUUID(),
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.audio) throw new Error(`tts failed (${res.status}): ${JSON.stringify(json).slice(0, 400)}`)
  return Buffer.from(json.audio, 'base64')
}

// ── 逐句生成（带缓存）＋ 时长检查 ──────────────────────────────────────────
const videoDur = probeDur(video)
const clips = []
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  const hash = createHash('sha256').update(`${l.voice}\n${l.text}\n${l.speech_rate ?? ''}\n${flags.reference ?? ''}`).digest('hex').slice(0, 12)
  const file = join(linesDir, `${String(i + 1).padStart(2, '0')}-${hash}.mp3`)
  if (!existsSync(file)) {
    process.stdout.write(`tts ${i + 1}/${lines.length}: ${l.text.slice(0, 30)}… `)
    writeFileSync(file, await tts(l))
    console.log('ok')
  }
  const dur = probeDur(file)
  const end = l.start + dur
  const limit = i + 1 < lines.length ? lines[i + 1].start : videoDur
  const over = end - limit
  console.log(`  [${String(i + 1).padStart(2)}] ${l.start.toFixed(2)}s +${dur.toFixed(2)}s → ${end.toFixed(2)}s${over > 0 ? `  ⚠ overruns next slot by ${over.toFixed(2)}s` : ''}  ${l.text}`)
  clips.push({ ...l, file, dur })
}

// ── 混音：adelay 定位 → amix → loudnorm ≈ -16 LUFS → AAC 192k，视频 copy ──
const inputs = clips.flatMap((c) => ['-i', c.file])
const graph = clips.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.start * 1000)}:all=1[a${i}]`).join(';') +
  `;${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0,` +
  `loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad[aout]`
run(['-i', video, ...inputs, '-filter_complex', graph,
  '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-t', String(videoDur), '-movflags', '+faststart', out])
console.log(`voiced → ${out} (video ${videoDur.toFixed(1)}s, ${clips.length} lines, lines in ${linesDir})`)
