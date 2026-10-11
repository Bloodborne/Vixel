// 等自动标签跑完，再打印结果。ELECTRON_RUN_AS_NODE=1 npx electron scripts/autotag-wait.cjs <library.db> <expectedDone>
const { join } = require('path')
const { initDatabase } = require(join(__dirname, '..', 'dist/cli/core/db'))
const [dbPath, expected = '1'] = process.argv.slice(2)
const deadline = Date.now() + 200_000
const tick = () => {
  const db = initDatabase(dbPath, { readonly: true }).raw
  const done = db.prepare('select count(*) from autotag_done').pluck().get()
  if (done < Number(expected) && Date.now() < deadline) { db.close(); return setTimeout(tick, 3000) }
  console.log('done', done, 'labels', db.prepare('select count(*) from autotag_labels').pluck().get(),
    'auto links', db.prepare('select count(*) from item_tags where auto_score is not null').pluck().get())
  for (const r of db.prepare(`select t.name, t.label_id l, count(*) n from item_tags it join tags t on t.id = it.tag_id group by t.id order by n desc limit 15`).all()) console.log(' ', r.n, r.name, r.l ?? '')
  db.close()
}
tick()
