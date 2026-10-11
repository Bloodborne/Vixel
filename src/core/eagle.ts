/**
 * Eagle 资源库（*.library）只读接入。格式按 Eagle 4.0 源码核实，见 docs/review/08-eagle-library-format.md：
 *
 *   <名字>.library/
 *     metadata.json            { folders: [{ id, name, children: [...] }], smartFolders, quickAccess, tagsGroups, ... }
 *     mtime.json / tags.json   Eagle 自己的缓存，我们不用
 *     images/<ID>.info/        ID 为 13 位（新版 guid）或 36 位（旧版 uuid）
 *       metadata.json          { id, name, ext, tags, folders: [文件夹 id], annotation, url, star, isDeleted, width, height, duration, ... }
 *       <name>.<ext>           原文件 —— 我们只索引它
 *       <name>_thumbnail.png   Eagle 的缩略图（小图没有），跳过
 *
 * 只读：绝不往 .library 里写任何东西。标签、文件夹（作为标签）、注释、来源链接、星级同步进 Vixel 自己的库；
 * 在 Eagle 里移到回收站（isDeleted）的条目不索引。
 */
import { existsSync, readFileSync } from 'fs'
import { readFile, readdir } from 'fs/promises'
import { basename, dirname, join } from 'path'
import type Database from 'better-sqlite3'
import type { EagleItemInfo } from '../shared/tags'
import { TagStore } from './tagStore'

const ITEM_DIR = /^[A-Za-z0-9-]{13,36}\.info$/

export interface EagleItem {
  id: string
  name: string
  ext: string
  tags: string[]
  /** Eagle 文件夹 id */
  folders: string[]
  annotation: string
  url: string
  star: number
  isDeleted: boolean
}

/** 目录是不是 Eagle 资源库：有 metadata.json（含 folders 数组）和 images/ */
export function isEagleLibrary(dir: string): boolean {
  try {
    if (!existsSync(join(dir, 'images'))) return false
    const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8')) as { folders?: unknown }
    return Array.isArray(meta.folders)
  } catch {
    return false
  }
}

/** 资源库显示名：去掉 .library */
export function eagleLibraryName(dir: string): string {
  return basename(dir.replace(/[\\/]+$/, '')).replace(/\.library$/i, '')
}

/** 文件夹树 → id 到 "父/子" 路径的映射 */
export function parseFolderPaths(metadata: unknown): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (nodes: unknown, prefix: string): void => {
    if (!Array.isArray(nodes)) return
    for (const n of nodes as Array<{ id?: unknown; name?: unknown; children?: unknown }>) {
      if (typeof n?.id !== 'string' || typeof n.name !== 'string') continue
      const name = n.name.replace(/\//g, '／').trim()
      if (!name) continue
      const path = prefix ? `${prefix}/${name}` : name
      out.set(n.id, path)
      walk(n.children, path)
    }
  }
  walk((metadata as { folders?: unknown } | null)?.folders, '')
  return out
}

/** 条目 metadata.json → EagleItem；格式不对返回 null */
export function parseItem(raw: unknown): EagleItem | null {
  const m = raw as Record<string, unknown> | null
  if (!m || typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.ext !== 'string' || !m.ext) return null
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [])
  const star = typeof m.star === 'number' && Number.isFinite(m.star) ? Math.max(0, Math.min(5, Math.round(m.star))) : 0
  return {
    id: m.id,
    name: m.name,
    ext: m.ext,
    tags: strings(m.tags),
    folders: strings(m.folders),
    annotation: typeof m.annotation === 'string' ? m.annotation : '',
    url: typeof m.url === 'string' ? m.url : '',
    star,
    isDeleted: m.isDeleted === true,
  }
}

/** 条目的原文件名（Eagle 存成 <name>.<ext>） */
export const originalFileName = (item: EagleItem): string => `${item.name}.${item.ext}`

/** 路径是否形如 <库>/images/<ID>.info/<文件>；是的话返回条目目录 */
export function eagleItemDir(filePath: string): string | null {
  const dir = dirname(filePath)
  return ITEM_DIR.test(basename(dir)) && basename(dirname(dir)) === 'images' ? dir : null
}

/** 读条目 metadata.json */
export async function readItem(itemDir: string): Promise<EagleItem | null> {
  try {
    return parseItem(JSON.parse(await readFile(join(itemDir, 'metadata.json'), 'utf8')))
  } catch {
    return null
  }
}

/** 这个文件是否应该被索引：条目里的原文件、且没在 Eagle 回收站里 */
export async function isIndexableEagleFile(filePath: string): Promise<boolean> {
  const dir = eagleItemDir(filePath)
  if (!dir) return false
  const item = await readItem(dir)
  return !!item && !item.isDeleted && basename(filePath).toLowerCase() === originalFileName(item).toLowerCase()
}

/** Eagle 条目 → 同步进 Vixel 的标签名：Eagle 标签 + 所在文件夹的路径 */
export function itemTagNames(item: EagleItem, folderPaths: Map<string, string>): string[] {
  const names = [...item.tags, ...item.folders.map((id) => folderPaths.get(id)).filter((x): x is string => !!x)]
  return [...new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()])).values()].filter(Boolean)
}

export interface EagleSyncResult {
  /** 这次同步里变成"已删除"的原文件路径（调用方从索引里移除） */
  removed: string[]
  /** 从回收站恢复的原文件路径（调用方重新加入索引） */
  restored: string[]
}

export class EagleSync {
  private tags: TagStore
  private stmts: ReturnType<EagleSync['prepare']>

  constructor(private raw: Database.Database) {
    this.tags = new TagStore(raw)
    this.stmts = this.prepare()
  }

  private prepare() {
    const db = this.raw
    return {
      rows: db.prepare(`SELECT eagle_id as eagleId, source_path as sourcePath, deleted FROM eagle_items WHERE folder_id = ?`),
      upsert: db.prepare(`
        INSERT INTO eagle_items (folder_id, eagle_id, source_path, name, annotation, url, star, tag_names, folder_paths, deleted)
        VALUES (@folderId, @eagleId, @sourcePath, @name, @annotation, @url, @star, @tagNames, @folderPaths, @deleted)
        ON CONFLICT(folder_id, eagle_id) DO UPDATE SET
          source_path = excluded.source_path, name = excluded.name, annotation = excluded.annotation, url = excluded.url,
          star = excluded.star, tag_names = excluded.tag_names, folder_paths = excluded.folder_paths, deleted = excluded.deleted
      `),
      dropRow: db.prepare(`DELETE FROM eagle_items WHERE folder_id = ? AND eagle_id = ?`),
      dropLibrary: db.prepare(`DELETE FROM eagle_items WHERE folder_id = ?`),
      dropLinks: db.prepare(`DELETE FROM item_tags WHERE origin = ?`),
      liveRows: db.prepare(`SELECT eagle_id as eagleId, source_path as sourcePath, tag_names as tagNames FROM eagle_items WHERE folder_id = ? AND deleted = 0`),
      setHash: db.prepare(`UPDATE eagle_items SET file_hash = ? WHERE folder_id = ? AND eagle_id = ?`),
      // 原文件 → 内容 hash：图片是 photos 行本身；音视频是代表帧（首帧 / 封面）
      imageHash: db.prepare(`SELECT file_hash FROM photos WHERE file_path = ? AND deleted_at IS NULL AND video_id IS NULL`).pluck(),
      videoHash: db.prepare(`
        SELECT p.file_hash FROM videos v JOIN photos p ON p.video_id = v.id
        WHERE v.file_path = ? AND v.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY p.id LIMIT 1
      `).pluck(),
      link: db.prepare(`INSERT OR IGNORE INTO item_tags (file_hash, tag_id, origin) VALUES (?, ?, ?)`),
      pendingRows: db.prepare(`SELECT folder_id as folderId, source_path as sourcePath FROM eagle_items WHERE deleted = 0 AND file_hash IS NULL`),
      info: db.prepare(`
        SELECT e.name, e.annotation, e.url, e.star, e.folder_paths as folderPaths, f.path as libraryPath
        FROM eagle_items e JOIN watched_folders f ON f.id = e.folder_id
        WHERE e.file_hash = ? AND e.deleted = 0 LIMIT 1
      `),
    }
  }

  /**
   * 读整个资源库，刷新 eagle_items，并重建这个库同步来的标签关联。
   * 返回删除状态有变化的原文件，调用方据此增删索引。isSupported：Vixel 能不能索引这种文件（watcher 的 classifyMedia）
   */
  async sync(folderId: number, root: string, isSupported: (fileName: string) => boolean): Promise<EagleSyncResult> {
    let folderPaths = new Map<string, string>()
    try {
      folderPaths = parseFolderPaths(JSON.parse(await readFile(join(root, 'metadata.json'), 'utf8')))
    } catch { /* 顶层 metadata.json 坏了：文件夹不同步，条目照常 */ }

    const imagesDir = join(root, 'images')
    let dirs: string[] = []
    try { dirs = (await readdir(imagesDir)).filter((d) => ITEM_DIR.test(d)) } catch { /* 库被移走 */ }
    const items: Array<{ item: EagleItem; sourcePath: string }> = []
    for (const d of dirs) {
      const item = await readItem(join(imagesDir, d))
      // Vixel 不认识的格式（PSD、字体、3D…）不镜像：反正不会被索引，也就永远挂不上标签
      if (item && isSupported(originalFileName(item))) items.push({ item, sourcePath: join(imagesDir, d, originalFileName(item)) })
    }

    const before = new Map((this.stmts.rows.all(folderId) as Array<{ eagleId: string; sourcePath: string; deleted: number }>)
      .map((r) => [r.eagleId, r]))
    const result: EagleSyncResult = { removed: [], restored: [] }
    this.raw.transaction(() => {
      const seen = new Set<string>()
      for (const { item, sourcePath } of items) {
        seen.add(item.id)
        const prev = before.get(item.id)
        if (item.isDeleted && prev && !prev.deleted) result.removed.push(sourcePath)
        if (!item.isDeleted && prev?.deleted) result.restored.push(sourcePath)
        this.stmts.upsert.run({
          folderId, eagleId: item.id, sourcePath, name: item.name, annotation: item.annotation, url: item.url, star: item.star,
          tagNames: JSON.stringify(itemTagNames(item, folderPaths)),
          folderPaths: JSON.stringify(item.folders.map((id) => folderPaths.get(id)).filter(Boolean)),
          deleted: item.isDeleted ? 1 : 0,
        })
      }
      for (const id of before.keys()) if (!seen.has(id)) this.stmts.dropRow.run(folderId, id)
    })()
    this.relink(folderId)
    return result
  }

  /** 重建某个库的标签关联：内容 hash 能解析出来的条目才挂标签（视频要等首帧出来） */
  relink(folderId: number): void {
    this.raw.transaction(() => {
      this.stmts.dropLinks.run(folderId)
      for (const r of this.stmts.liveRows.all(folderId) as Array<{ eagleId: string; sourcePath: string; tagNames: string }>) {
        const hash = (this.stmts.imageHash.get(r.sourcePath) ?? this.stmts.videoHash.get(r.sourcePath) ?? null) as string | null
        this.stmts.setHash.run(hash, folderId, r.eagleId)
        if (!hash) continue
        let names: string[] = []
        try { names = JSON.parse(r.tagNames) as string[] } catch { /* 跳过 */ }
        for (const name of names) {
          try { this.stmts.link.run(hash, this.tags.ensure(name, 'eagle'), folderId) } catch { /* 空名字 */ }
        }
      }
      this.tags.gc()
    })()
  }

  /**
   * 有条目还没解析出 hash 的库（文件刚索引完，或视频刚抽出首帧）：能解析了才重挂标签。
   * 解析不了的（坏文件）不会每次都触发重建。返回是否有变化
   */
  resolvePending(): boolean {
    const pending = this.stmts.pendingRows.all() as Array<{ folderId: number; sourcePath: string }>
    const ready = new Set(pending
      .filter((r) => this.stmts.imageHash.get(r.sourcePath) != null || this.stmts.videoHash.get(r.sourcePath) != null)
      .map((r) => r.folderId))
    for (const f of ready) this.relink(f)
    return ready.size > 0
  }

  /** 资源库从 Vixel 里移除：撤掉它同步来的一切 */
  removeLibrary(folderId: number): void {
    this.raw.transaction(() => {
      this.stmts.dropLinks.run(folderId)
      this.stmts.dropLibrary.run(folderId)
      this.tags.gc()
    })()
  }

  info(fileHash: string): EagleItemInfo | null {
    const r = this.stmts.info.get(fileHash) as
      | { name: string; annotation: string; url: string; star: number; folderPaths: string; libraryPath: string }
      | undefined
    if (!r) return null
    let folders: string[] = []
    try { folders = JSON.parse(r.folderPaths) as string[] } catch { /* 空 */ }
    return { libraryName: eagleLibraryName(r.libraryPath), name: r.name, annotation: r.annotation, url: r.url, star: r.star, folders }
  }

  /** 搜索的"注释"通道见 search.ts（直接查 eagle_items，CLI 不需要加载这个模块） */
}
