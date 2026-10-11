// 接触表：把 picks 里的缩略图 + 标签拼成一张图，人工判断精度。
// ELECTRON_RUN_AS_NODE=1 npx electron scripts/autotag-sheet.cjs <picks.json> <out.png> [start] [count]
const sharp = require('sharp')
const [file, out, start = '0', count = '30'] = process.argv.slice(2)
const picks = require(file).slice(Number(start), Number(start) + Number(count))
const W = 260, H = 200, COLS = 6
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
;(async () => {
  const tiles = []
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i]
    let img
    try {
      img = await sharp(p.path).rotate().resize(W, H - 40, { fit: 'cover' }).toBuffer()
    } catch {
      img = await sharp({ create: { width: W, height: H - 40, channels: 3, background: '#888' } }).png().toBuffer()
    }
    const label = Buffer.from(`<svg width="${W}" height="40"><rect width="${W}" height="40" fill="#fff"/>` +
      `<text x="4" y="15" font-size="12" font-family="Helvetica">${i + Number(start)}. ${esc(p.name.slice(0, 34))}</text>` +
      `<text x="4" y="33" font-size="14" font-weight="bold" font-family="Helvetica" fill="#b00">${esc(p.tags.join(', '))}</text></svg>`)
    const x = (i % COLS) * W, y = Math.floor(i / COLS) * H
    tiles.push({ input: img, left: x, top: y }, { input: label, left: x, top: y + H - 40 })
  }
  const rows = Math.ceil(picks.length / COLS)
  await sharp({ create: { width: COLS * W, height: rows * H, channels: 3, background: '#ddd' } }).composite(tiles).png().toFile(out)
})()
