// 搜索质量评测：真实引擎（SearchEngine + LiteRT 向量 + FTS5/jieba + 文件名/标签）跑标注查询集。
// 评测库永远用"副本"：每次运行把 library.db 拷到临时目录再只读打开，原库不动。
//
// 用法（npm run eval 会先 build:cli 再运行）：
//   npm run eval                              # 两个库都跑，打表格
//   npm run eval -- --set footage             # 只跑一个
//   npm run eval -- --json                    # 机器可读 JSON 到 stdout（表格转 stderr）
//   npm run eval -- --json --out evals/baseline.json   # 写基线文件
//   npm run eval -- --compare evals/baseline.json      # 与基线对比，打印各指标增减和排名变化
//
// 评测库不在仓库里，位置用环境变量或旗标指定（默认指向 vixel-demo）：
//   VIXEL_EVAL_DEMO_DATA / --demo-data        demo 库的数据目录（含 library.db）
//   VIXEL_EVAL_DEMO_LIB / --demo-lib          demo 媒体文件的根目录（期望路径的基准）
//   VIXEL_EVAL_FOOTAGE_DATA / --footage-data  footage 同上
//   VIXEL_EVAL_FOOTAGE_LIB / --footage-lib
//   VIXEL_MODELS_DIR（默认 resources/models）、VIXEL_LITERT_DIR
//
// 指标：top-1 命中率 / MRR / Recall@5 / mAP、负例正确率（无结果或全部 lowConfidence 才算对）、
// 平均返回条数。不统计耗时（速度另有 bench，不对外发布）。
// 片段期望 `file@a-b`（秒）：命中 = 返回该文件且其 segment 与 [a,b] 有重叠；无区间则命中文件即可。

const { join, relative, basename } = require('path')
const os = require('os')
const fs = require('fs')

const root = join(__dirname, '..')
const HOME = os.homedir()
const SEARCH_LIMIT = 10

// ---------- 参数 ----------
const argv = process.argv.slice(2)
const flags = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) continue
  const key = a.slice(2)
  const next = argv[i + 1]
  if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++ } else { flags[key] = true }
}

const SETS = {
  demo: {
    dataDir: flags['demo-data'] || process.env.VIXEL_EVAL_DEMO_DATA || join(HOME, 'workspace/dancer/vixel-demo/data'),
    libRoot: flags['demo-lib'] || process.env.VIXEL_EVAL_DEMO_LIB || join(HOME, 'workspace/dancer/vixel-demo/library'),
    queries: join(root, 'evals/demo.json'),
  },
  footage: {
    dataDir: flags['footage-data'] || process.env.VIXEL_EVAL_FOOTAGE_DATA || join(HOME, 'workspace/dancer/vixel-demo/footage-data'),
    libRoot: flags['footage-lib'] || process.env.VIXEL_EVAL_FOOTAGE_LIB || join(HOME, 'workspace/dancer/vixel-demo/footage'),
    queries: join(root, 'evals/footage.json'),
  },
}
const wantSets = flags.set ? String(flags.set).split(',') : Object.keys(SETS)
for (const s of wantSets) if (!SETS[s]) { console.error(`Unknown set: ${s} (have: ${Object.keys(SETS).join(', ')})`); process.exit(1) }

const asJson = !!flags.json
// --json 时表格走 stderr，stdout 只给 JSON
const out = (line = '') => (asJson ? console.error(line) : console.log(line))

// ---------- 引擎 ----------
if (!fs.existsSync(join(root, 'dist/cli/core/search.js'))) {
  console.error('dist/cli 不存在，先 npm run build:cli（npm run eval 会自动做）')
  process.exit(1)
}
const { initDatabase } = require(join(root, 'dist/cli/core/db'))
const { SearchEngine } = require(join(root, 'dist/cli/core/search'))
const { initEmbeddingServicePath, getEmbeddingService } = require(join(root, 'dist/cli/core/embedding'))
let litertPlatformDir = () => `${process.platform}-${process.arch}`
try { litertPlatformDir = require(join(root, 'dist/cli/core/embedding/providers/litert/native')).litertPlatformDir } catch { /* 用默认 */ }

function modelsDir() {
  const c = [process.env.VIXEL_MODELS_DIR, join(root, 'resources/models')]
  return c.find((d) => d && fs.existsSync(d))
}
function litertDir() {
  const c = [process.env.VIXEL_LITERT_DIR, join(root, 'resources/litert', litertPlatformDir())]
  return c.find((d) => d && fs.existsSync(d))
}

/** 把 library.db(+wal/shm) 拷到临时目录，返回副本 db 路径 */
function copyLibrary(dataDir, tmpBase) {
  const src = join(dataDir, 'library.db')
  if (!fs.existsSync(src)) throw new Error(`library.db not found in ${dataDir}`)
  const dir = fs.mkdtempSync(join(tmpBase, 'lib-'))
  for (const suffix of ['', '-wal', '-shm']) {
    const f = src + suffix
    if (fs.existsSync(f)) fs.copyFileSync(f, join(dir, basename(src) + suffix))
  }
  return join(dir, 'library.db')
}

// ---------- 期望与匹配 ----------
/** "path@a-b" → { path, range: [aMs, bMs] | null } */
function parseExpect(e) {
  const m = /^(.*)@([\d.]+)-([\d.]+)$/.exec(e)
  if (!m) return { path: e, range: null }
  return { path: m[1], range: [Number(m[2]) * 1000, Number(m[3]) * 1000] }
}

function resultRelPath(r, libRoot, videoPathById) {
  const abs = r.photo.videoId != null ? videoPathById.get(r.photo.videoId) ?? r.photo.filePath : r.photo.filePath
  return relative(libRoot, abs).split(require('path').sep).join('/')
}

function matches(res, exp) {
  if (res.rel !== exp.path) return false
  if (!exp.range) return true
  if (!res.segment) return false
  return res.segment.startMs < exp.range[1] && res.segment.endMs > exp.range[0]
}

// ---------- 指标 ----------
function scorePositive(results, expects) {
  // 每条期望最多被一条结果满足（贪心按排名）；AP 按标准定义对期望集合求平均精度
  const taken = new Set()
  const relevantAt = results.map((r) => {
    const i = expects.findIndex((e, idx) => !taken.has(idx) && matches(r, e))
    if (i >= 0) { taken.add(i); return true }
    return false
  })
  const rank = relevantAt.indexOf(true) + 1 // 0 = 没命中
  let hits = 0, apSum = 0, hitsAt5 = 0
  relevantAt.forEach((rel, i) => {
    if (!rel) return
    hits++
    apSum += hits / (i + 1)
    if (i < 5) hitsAt5++
  })
  return {
    rank: rank || null,
    top1: rank === 1 ? 1 : 0,
    mrr: rank ? 1 / rank : 0,
    recall5: hitsAt5 / expects.length,
    ap: apSum / expects.length,
  }
}

function aggregate(rows) {
  const pos = rows.filter((r) => r.kind === 'pos')
  const neg = rows.filter((r) => r.kind === 'neg')
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  return {
    n: rows.length,
    nPos: pos.length,
    nNeg: neg.length,
    top1: mean(pos.map((r) => r.top1)),
    mrr: mean(pos.map((r) => r.mrr)),
    recall5: mean(pos.map((r) => r.recall5)),
    map: mean(pos.map((r) => r.ap)),
    negOk: neg.length ? neg.filter((r) => r.negOk).length : null,
    avgResults: mean(rows.map((r) => r.nResults)),
  }
}

// ---------- 运行 ----------
async function runSet(name, cfg, tmpBase) {
  const spec = JSON.parse(fs.readFileSync(cfg.queries, 'utf8'))
  const dbPath = copyLibrary(cfg.dataDir, tmpBase)
  let db
  try {
    db = initDatabase(dbPath, { readonly: true, runCleanup: false })
  } catch {
    db = initDatabase(dbPath, { runCleanup: false }) // 副本，读写打开也安全（如旧库需迁移）
  }
  const videoPathById = new Map(
    db.raw.prepare('SELECT id, file_path FROM videos').all().map((r) => [r.id, r.file_path])
  )
  const engine = new SearchEngine(db)

  const rows = []
  for (const q of spec.queries) {
    const results = await engine.search(q.q, SEARCH_LIMIT)
    const resView = results.map((r) => ({
      rel: resultRelPath(r, cfg.libRoot, videoPathById),
      segment: r.segment ?? null,
      matchedBy: r.matchedBy ?? [],
      lowConfidence: !!r.lowConfidence,
      score: r.score,
    }))
    const expects = q.expect.map(parseExpect)
    const first = resView[0]
      ? {
          path: resView[0].rel,
          segment: resView[0].segment ? [resView[0].segment.startMs / 1000, resView[0].segment.endMs / 1000] : null,
          matchedBy: resView[0].matchedBy,
          lowConfidence: resView[0].lowConfidence,
        }
      : null
    if (expects.length === 0) {
      const confident = resView.filter((r) => !r.lowConfidence)
      rows.push({
        q: q.q, tag: q.tag, kind: 'neg',
        negOk: confident.length === 0,
        nResults: resView.length, nConfident: confident.length,
        first,
      })
    } else {
      rows.push({
        q: q.q, tag: q.tag, kind: 'pos',
        expect: q.expect,
        ...scorePositive(resView, expects),
        nResults: resView.length,
        lowConfidence: resView.length > 0 && resView[0].lowConfidence,
        first,
      })
    }
  }
  db.close()

  const perTag = {}
  for (const tag of [...new Set(rows.map((r) => r.tag))].sort()) {
    perTag[tag] = aggregate(rows.filter((r) => r.tag === tag))
  }
  return { set: name, overall: aggregate(rows), perTag, queries: rows }
}

// ---------- 展示 ----------
const fmt = (x, d = 2) => (x == null ? '    -' : x.toFixed(d).padStart(5))
function printSet(r) {
  out(`\n== ${r.set} — ${r.overall.n} queries ==`)
  out('tag           n  top1   MRR   R@5   mAP  neg-ok  avgN')
  const line = (label, a) =>
    out(
      `${label.padEnd(12)}${String(a.n).padStart(3)} ${fmt(a.top1)} ${fmt(a.mrr)} ${fmt(a.recall5)} ${fmt(a.map)}  ${
        a.negOk == null ? '    -' : `${a.negOk}/${a.nNeg}`.padStart(5)
      } ${fmt(a.avgResults, 1)}`
    )
  for (const [tag, agg] of Object.entries(r.perTag)) line(tag, agg)
  line('ALL', r.overall)

  const failures = r.queries.filter((q) => (q.kind === 'pos' ? q.rank !== 1 : !q.negOk))
  if (failures.length) {
    out(`-- failing (${failures.length}):`)
    for (const f of failures) {
      const firstStr = f.first
        ? `${f.first.path}${f.first.segment ? `@${f.first.segment[0]}-${f.first.segment[1]}s` : ''} [${f.first.matchedBy.join('+')}${f.first.lowConfidence ? ', lowConf' : ''}]`
        : '(no results)'
      if (f.kind === 'neg') {
        out(`  [${f.tag}] "${f.q}"  负例返回了 ${f.nConfident} 条明确结果，第一条: ${firstStr}`)
      } else {
        out(`  [${f.tag}] "${f.q}"  期望 ${f.expect.join(' | ')} → rank ${f.rank ?? '∅'}，第一条: ${firstStr}`)
      }
    }
  }
}

function printCompare(prev, cur) {
  out(`\n== compare vs ${flags.compare} ==`)
  const d = (a, b, digits = 2) => {
    if (a == null || b == null) return '    -'
    const delta = b - a
    const s = delta.toFixed(digits)
    return (delta > 0 ? '+' + s : s).padStart(6)
  }
  for (const curSet of cur) {
    const prevSet = (Array.isArray(prev.sets) ? prev.sets : []).find((s) => s.set === curSet.set)
    if (!prevSet) { out(`  ${curSet.set}: 基线里没有这个集合`); continue }
    out(`  ${curSet.set}: Δtop1 ${d(prevSet.overall.top1, curSet.overall.top1)}  ΔMRR ${d(prevSet.overall.mrr, curSet.overall.mrr)}  ΔR@5 ${d(prevSet.overall.recall5, curSet.overall.recall5)}  ΔmAP ${d(prevSet.overall.map, curSet.overall.map)}  Δneg ${prevSet.overall.negOk ?? '-'}→${curSet.overall.negOk ?? '-'}`)
    for (const [tag, agg] of Object.entries(curSet.perTag)) {
      const p = prevSet.perTag[tag]
      if (!p) continue
      const changed = ['top1', 'mrr', 'recall5', 'map'].some((k) => p[k] != null && agg[k] != null && Math.abs(p[k] - agg[k]) > 1e-9)
      if (changed) out(`    ${tag.padEnd(12)} Δtop1 ${d(p.top1, agg.top1)}  ΔMRR ${d(p.mrr, agg.mrr)}  ΔR@5 ${d(p.recall5, agg.recall5)}  ΔmAP ${d(p.map, agg.map)}`)
    }
    // 单条查询的排名变化
    const prevByQ = new Map(prevSet.queries.map((q) => [q.q, q]))
    for (const q of curSet.queries) {
      const p = prevByQ.get(q.q)
      if (!p) { out(`    new query: "${q.q}"`); continue }
      if (q.kind === 'pos' && p.rank !== q.rank) out(`    "${q.q}": rank ${p.rank ?? '∅'} → ${q.rank ?? '∅'}`)
      if (q.kind === 'neg' && !!p.negOk !== !!q.negOk) out(`    "${q.q}": neg ${p.negOk ? 'ok' : 'FAIL'} → ${q.negOk ? 'ok' : 'FAIL'}`)
    }
  }
}

async function main() {
  const models = modelsDir()
  if (!models) {
    console.error('未找到模型目录（VIXEL_MODELS_DIR 或 resources/models）。没有向量通道的评测没有意义，退出。')
    process.exit(1)
  }
  // 固定的 userData（litert 缓存放这里，第二次起跑得快）；库副本在一次性临时目录里
  const cacheDir = join(os.tmpdir(), 'vixel-eval-cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const tmpBase = fs.mkdtempSync(join(os.tmpdir(), 'vixel-eval-'))

  initEmbeddingServicePath(cacheDir, models, litertDir())
  const svc = getEmbeddingService()
  await svc.init()
  if (!svc.isReady()) {
    console.error('Embedding 服务初始化失败（模型 / LiteRT 运行时）。')
    process.exit(1)
  }

  const results = []
  try {
    for (const name of wantSets) results.push(await runSet(name, SETS[name], tmpBase))
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  }

  for (const r of results) printSet(r)

  if (flags.compare) {
    const prev = JSON.parse(fs.readFileSync(String(flags.compare), 'utf8'))
    printCompare(prev, results)
  }

  const payload = { generatedAt: new Date().toISOString(), limit: SEARCH_LIMIT, sets: results }
  if (flags.out) {
    fs.writeFileSync(String(flags.out), JSON.stringify(payload, null, 1) + '\n')
    out(`\nwrote ${flags.out}`)
  }
  if (asJson && !flags.out) console.log(JSON.stringify(payload, null, 1))
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
