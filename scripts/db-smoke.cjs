/**
 * 数据库集成冒烟测试：better-sqlite3 按 Electron ABI 编译，vitest（纯 Node）加载不了，
 * 所以 db.ts 的删除级联 / GC / 只读打开 / 文件名转义在这里用 Electron-as-Node 跑。
 *   npm run test:db
 */
const { initDatabase } = require(require('path').join(__dirname, '..', 'dist', 'cli', 'core', 'db.js'))
const fs = require('fs'); const path = require('path').join(require('os').tmpdir(), 'vixel-db-smoke.db')
for (const f of [path, path + '-wal', path + '-shm']) fs.rmSync(f, { force: true })
const db = initDatabase(path)
const vec = () => { const v = new Float32Array(768); v[0] = 1; return v }
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1 } else console.log('ok  ', m) }
const f = db.addFolder('/tmp/f1')
// two photos share hash h1, one unique h2
const p1 = db.addPhoto(f.id, '/tmp/f1/a.jpg', 'a.jpg', 1, 1, 'h1')
const p2 = db.addPhoto(f.id, '/tmp/f1/b.jpg', 'b.jpg', 1, 1, 'h1')
const p3 = db.addPhoto(f.id, '/tmp/f1/c.jpg', 'c.jpg', 1, 1, 'h2')
db.saveImageVec('h1', vec()); db.saveImageVec('h2', vec()); db.saveOcrText('h2', 'hello world')
const n = (sql) => db.raw.prepare(sql).get().n
assert(n('select count(*) n from image_vec_map') === 2, 'two vectors saved')
// video with a frame photo
const vid = db.addVideo(f.id, '/tmp/f1/v.mp4', 'v.mp4', 10, 1, 'vh', 'video')
const fp = db.addPhoto(f.id, '/tmp/vf/seg0.jpg', 'seg0.jpg', 1, 1, 'fh', { videoId: vid, frameTimeMs: 0 })
db.saveImageVec('fh', vec())
const r = db.cascadeRemoveVideo('/tmp/f1/v.mp4')
assert(r && r.orphanedFrameHashes.join() === 'fh', 'cascadeRemoveVideo returns orphaned frame hash')
assert(n("select count(*) n from image_vec_map where file_hash='fh'") === 0, 'frame vector GCd')
assert(n(`select count(*) n from videos where id=${vid} and deleted_at is not null`) === 1, 'video soft-deleted')
// removeFramesForVideo on second video whose frame shares hash with live photo h1 -> not orphaned
const vid2 = db.addVideo(f.id, '/tmp/f1/w.mp4', 'w.mp4', 10, 1, 'wh', 'video')
db.addPhoto(f.id, '/tmp/vf/w0.jpg', 'w0.jpg', 1, 1, 'h1', { videoId: vid2, frameTimeMs: 0 })
assert(db.removeFramesForVideo(vid2).length === 0, 'shared frame hash not orphaned')
assert(n("select count(*) n from image_vec_map where file_hash='h1'") === 1, 'shared vector kept')
// filename LIKE escaping
assert(db.searchByFileName('_.jpg', 10).length === 0, 'underscore is literal in filename search')
assert(db.searchByFileName('a.jpg', 10).length === 1, 'plain filename search still matches')
// favorites (per hash; duplicates share) + filtered browse
db.setFavorite(['h1'], true)
assert(db.getFavoriteHashes().has('h1') && db.getLibraryCounts().favorites === 1, 'favorite saved and counted once for shared hash')
const fav = db.getRepresentativePhotosFiltered(50, 0, { favorite: true })
assert(fav.length === 1 && fav[0].fileHash === 'h1' && !!fav[0].favorite, 'favorite filter returns the representative with favorite flag')
db.raw.prepare("update photos set width = 4000, height = 3000 where file_hash = 'h1'").run()
db.raw.prepare("update photos set width = 1000, height = 3000 where file_hash = 'h2'").run()
const hashesOf = (f) => db.getRepresentativePhotosFiltered(50, 0, f).map((x) => x.fileHash).sort().join()
assert(hashesOf({ orientation: 'landscape' }) === 'h1', 'orientation landscape')
assert(hashesOf({ orientation: 'panorama' }) === 'h2', 'orientation panorama (3:1 portrait)')
assert(hashesOf({ minPixels: 12000000 }) === 'h1', 'min pixels')
assert(hashesOf({ maxPixels: 4000000 }) === 'h2', 'max pixels')
assert(hashesOf({ durationMax: 30000 }) === '', 'duration filter excludes images')
assert(hashesOf({ orientation: 'landscape', favorite: true, folderId: f.id }) === 'h1', 'combined filters')
db.setFavorite(['h1'], false)
assert(db.getLibraryCounts().favorites === 0, 'unfavorite')
db.setFavorite(['h2'], true)
// folder delete GCs all
const orphans = db.deletePhotosByFolder(f.id)
assert(['h1','h2'].every(h => orphans.includes(h)), 'deletePhotosByFolder returns orphaned hashes')
assert(n('select count(*) n from image_vec_map') === 0, 'all vectors GCd')
assert(n('select count(*) n from image_ocr') === 0, 'OCR GCd')
assert(n('select count(*) n from favorites') === 0, 'favorites GCd with content')
// readonly reopen
db.close()
const ro = initDatabase(path, { readonly: true })
assert(ro.getFolders().length === 1, 'readonly open works')
try { ro.addFolder('/x'); assert(false, 'readonly rejects writes') } catch { assert(true, 'readonly rejects writes') }
ro.close()
