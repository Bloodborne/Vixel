/**
 * 标签：数据访问 + 搜索匹配。直接用 db.raw 写自己的语句（同 cleanupStore），不往 db.ts 的大接口里加东西。
 * 表在 db.ts 的 SCHEMA 里建（filterWhere / 内容 GC 要引用它们）。
 *
 * 标签挂在内容 hash 上（同一张照片的多份副本共享），原文件不动。
 * 没有任何内容的标签自动删掉（没有"空标签"这个概念，界面上也不提供单独创建）。
 */
import type Database from 'better-sqlite3'
import type { Tag, TagsForSelection } from '../shared/tags'
import { tokenizeForFtsSync } from './text/tokenize'
import { locale } from '../shared/i18n'
import { VOCABULARY } from './autotag/vocabulary'

const LABELS = new Map(VOCABULARY.map((l) => [l.id, l]))

/** 词表标签按界面语言显示；词表里没有了（旧版本的 id）就用存的名字 */
export function displayName(row: { name: string; labelId?: string | null }): string {
  const label = row.labelId ? LABELS.get(row.labelId) : undefined
  if (!label) return row.name
  return locale === 'zh-CN' ? label.zh : label.en
}

/** 搜索时一个标签可以用的名字：存的名字 + 词表标签的中英文名 */
function searchNames(row: { name: string; labelId?: string | null }): string[] {
  const label = row.labelId ? LABELS.get(row.labelId) : undefined
  return label ? [...new Set([row.name, label.zh, label.en])] : [row.name]
}

/** 标签名：去首尾空白、压缩内部空白；太长截断 */
export function normalizeTagName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 80)
}

/**
 * 查询 → 命中哪些标签，以及命中强度（越大越靠前）：
 *   3 整个查询就是标签名；2 标签名以整个查询开头（边打字边出）；
 *   1 查询分词（中文走 jieba）后某个词就是标签名，或标签名以某个 ≥ 2 字的词开头；
 *     含中文的标签名（≥ 2 字）出现在查询里也算（不依赖分词："花卉照片" 命中 "花卉"）。
 * 都不区分大小写。英文标签不做子串匹配（"barcelona" 不该命中 "bar"）。
 */
export function matchTagNames(query: string, tokens: string[], names: string[]): Map<string, number> {
  const q = query.trim().toLowerCase()
  const toks = [...new Set(tokens.map((x) => x.trim().toLowerCase()).filter(Boolean))]
  const out = new Map<string, number>()
  if (!q) return out
  for (const name of names) {
    const n = name.toLowerCase()
    let score = 0
    if (n === q) score = 3
    else if (n.startsWith(q)) score = 2
    else if (toks.some((t) => t === n || (t.length >= 2 && n.startsWith(t)))) score = 1
    else if (n.length >= 2 && /[　-鿿가-힯]/.test(n) && q.includes(n)) score = 1
    if (score > 0) out.set(name, score)
  }
  return out
}

/** 查询的分词：空白切开，含中文的再走 jieba */
export function queryTokens(query: string): string[] {
  return tokenizeForFtsSync(query).split(/\s+/).filter(Boolean)
}

/** 存活且未隐藏的内容（标签计数、搜索都按它） */
const LIVE = `EXISTS (SELECT 1 FROM photos p WHERE p.file_hash = it.file_hash AND p.deleted_at IS NULL)
  AND it.file_hash NOT IN (SELECT file_hash FROM hidden_items)`

export class TagStore {
  private stmts: ReturnType<TagStore['prepare']>

  constructor(private raw: Database.Database) {
    this.stmts = this.prepare()
  }

  private prepare() {
    const db = this.raw
    return {
      list: db.prepare(`
        SELECT t.id, t.name, t.label_id as labelId,
               (SELECT COUNT(DISTINCT it.file_hash) FROM item_tags it WHERE it.tag_id = t.id AND ${LIVE}) as count
        FROM tags t
        ORDER BY count DESC, t.name COLLATE NOCASE
      `),
      byName: db.prepare(`SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE`),
      byId: db.prepare(`SELECT id, name, label_id as labelId FROM tags WHERE id = ?`),
      insertTag: db.prepare(`INSERT INTO tags (name) VALUES (?)`),
      // 用户打的标签：已有自动链接就转成用户的（确认）
      link: db.prepare(`INSERT INTO item_tags (file_hash, tag_id) VALUES (?, ?) ON CONFLICT(file_hash, tag_id) DO UPDATE SET auto_score = NULL`),
      labelOf: db.prepare(`SELECT label_id FROM tags WHERE id = ?`).pluck(),
      reject: db.prepare(`INSERT OR IGNORE INTO autotag_rejections (file_hash, label_id) VALUES (?, ?)`),
      linksOfHash: db.prepare(`SELECT tag_id as tagId, auto_score IS NOT NULL as auto FROM item_tags WHERE file_hash = ?`),
      unlink: db.prepare(`DELETE FROM item_tags WHERE file_hash = ? AND tag_id = ?`),
      confirm: db.prepare(`UPDATE item_tags SET auto_score = NULL WHERE file_hash = ? AND tag_id = ?`),
      // 改了名就是用户自己的标签了：不再跟词表走（不再按界面语言换名字）
      rename: db.prepare(`UPDATE tags SET name = ?, label_id = NULL WHERE id = ?`),
      moveLinks: db.prepare(`INSERT OR IGNORE INTO item_tags (file_hash, tag_id) SELECT file_hash, ? FROM item_tags WHERE tag_id = ?`),
      dropLinks: db.prepare(`DELETE FROM item_tags WHERE tag_id = ?`),
      dropTag: db.prepare(`DELETE FROM tags WHERE id = ?`),
      gc: db.prepare(`DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM item_tags)`),
      names: db.prepare(`SELECT id, name, label_id as labelId FROM tags`),
      hashesForTag: db.prepare(`SELECT DISTINCT it.file_hash FROM item_tags it WHERE it.tag_id = ? AND ${LIVE}`).pluck(),
    }
  }

  list(): Tag[] {
    return (this.stmts.list.all() as Tag[]).map((t) => ({ ...t, name: displayName(t) }))
  }

  get(id: number): Tag | undefined {
    const row = this.stmts.byId.get(id) as Omit<Tag, 'count'> | undefined
    return row ? { ...row, name: displayName(row), count: 0 } : undefined
  }

  /** 按名字取标签，没有就建 */
  ensure(name: string): number {
    const clean = normalizeTagName(name)
    if (!clean) throw new Error('empty tag name')
    const row = this.stmts.byName.get(clean) as { id: number } | undefined
    if (row) return row.id
    return Number(this.stmts.insertTag.run(clean).lastInsertRowid)
  }

  /** 给一批内容加标签；返回标签 id */
  add(hashes: string[], name: string): number {
    return this.raw.transaction(() => {
      const id = this.ensure(name)
      for (const h of hashes) this.stmts.link.run(h, id)
      return id
    })()
  }

  /**
   * 从一批内容上去掉标签；没有内容了的标签随之删掉。
   * 词表标签记一笔"拒绝"：这些内容以后不会再被自动打上它（用户删过的不要再冒出来）
   */
  remove(hashes: string[], tagId: number): void {
    this.raw.transaction(() => {
      const labelId = this.stmts.labelOf.get(tagId) as string | null | undefined
      for (const h of hashes) {
        this.stmts.unlink.run(h, tagId)
        if (labelId) this.stmts.reject.run(h, labelId)
      }
      this.stmts.gc.run()
    })()
  }

  /** 确认自动标签：变成用户打的（之后重跑自动标签也不会动它） */
  confirmAuto(hashes: string[], tagId: number): void {
    this.raw.transaction(() => {
      for (const h of hashes) this.stmts.confirm.run(h, tagId)
    })()
  }

  /** 选中内容的标签：每一项都有的 / 只有部分有的 */
  forHashes(hashes: string[]): TagsForSelection {
    const unique = [...new Set(hashes)]
    if (unique.length === 0) return { all: [], some: [] }
    const counts = new Map<number, number>()
    const autos = new Map<number, number>()
    for (const h of unique) {
      for (const { tagId, auto } of this.stmts.linksOfHash.all(h) as Array<{ tagId: number; auto: number }>) {
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
        if (auto) autos.set(tagId, (autos.get(tagId) ?? 0) + 1)
      }
    }
    const all: Tag[] = []
    const some: Tag[] = []
    for (const [id, n] of counts) {
      const tag = this.get(id)
      if (!tag) continue
      // 选中的每一项上都是自动打的才算"自动"（有一项确认过就按普通标签显示）
      ;(n === unique.length ? all : some).push({ ...tag, auto: autos.get(id) === n })
    }
    const byName = (a: Tag, b: Tag): number => a.name.localeCompare(b.name)
    return { all: all.sort(byName), some: some.sort(byName) }
  }

  /** 改名；新名字和另一个标签重名（不分大小写）就合并进那个标签。返回最终的标签 id */
  rename(id: number, name: string): number {
    const clean = normalizeTagName(name)
    if (!clean) return id
    return this.raw.transaction(() => {
      const other = this.stmts.byName.get(clean) as { id: number } | undefined
      if (other && other.id !== id) {
        this.mergeInTx(id, other.id)
        return other.id
      }
      this.stmts.rename.run(clean, id)
      return id
    })()
  }

  merge(fromId: number, intoId: number): void {
    if (fromId === intoId) return
    this.raw.transaction(() => this.mergeInTx(fromId, intoId))()
  }

  private mergeInTx(fromId: number, intoId: number): void {
    this.stmts.moveLinks.run(intoId, fromId)
    this.stmts.dropLinks.run(fromId)
    this.stmts.dropTag.run(fromId)
  }

  delete(id: number): void {
    this.raw.transaction(() => {
      this.stmts.dropLinks.run(id)
      this.stmts.dropTag.run(id)
    })()
  }

  gc(): void {
    this.stmts.gc.run()
  }

  hashesForTag(id: number): Set<string> {
    return new Set(this.stmts.hashesForTag.all(id) as string[])
  }

  /** 搜索的标签通道：命中的标签 → 内容 hash，按命中强度（同一内容命中多个标签累加）排序 */
  search(query: string, limit: number): Array<{ fileHash: string; score: number }> {
    const rows = this.stmts.names.all() as Array<{ id: number; name: string; labelId: string | null }>
    if (rows.length === 0) return []
    const matched = matchTagNames(query, queryTokens(query), rows.flatMap(searchNames))
    if (matched.size === 0) return []
    const scores = new Map<string, number>()
    for (const r of rows) {
      const s = Math.max(0, ...searchNames(r).map((n) => matched.get(n) ?? 0))
      if (!s) continue
      for (const h of this.hashesForTag(r.id)) scores.set(h, (scores.get(h) ?? 0) + s)
    }
    return [...scores].map(([fileHash, score]) => ({ fileHash, score })).sort((a, b) => b.score - a.score).slice(0, limit)
  }
}
