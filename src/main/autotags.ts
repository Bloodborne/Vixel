/**
 * 自动标签的后台服务（主进程）：
 *   - 词表文字向量：第一次用时经推理进程编码（和搜索框同一条 encodeText 路径），存库；词表版本变了才重算
 *   - 基线：从本库抽样的图片向量 / 片段向量各算一份（见 assign.ts），库变化超过 10% 才重算
 *   - 判定：每批 BATCH 项，批间让出事件循环；新内容的 embed / 片段完成后由 indexer 事件触发
 * 只读向量、只写 tags / item_tags / autotag_*，不碰原文件。
 */
import { BrowserWindow, ipcMain } from 'electron'
import type { DatabaseInstance } from '../core/db'
import { getEmbeddingService } from '../core/embedding'
import { AUTOTAG_CHANNELS, type AutoTagStatus } from '../shared/autotags'
import { VOCABULARY, VOCABULARY_VERSION, type Label } from '../core/autotag/vocabulary'
import { ACTIVITY_EXTRA_Z, BASELINE_MIN_ITEMS, assignLabels, labelBaseline, mergeAssignments, type Baseline, type LabelVector } from '../core/autotag/assign'
import { AutoTagStore } from '../core/autotag/store'

const ENABLED_KEY = 'autotags.enabled'
/** 每批判定的内容数：153 个标签 × 768 维，一项 ~0.2 ms，一批远低于 50 ms */
const BATCH = 40
/** 基线抽样条数 */
const BASELINE_SAMPLE = 400

export interface AutoTagService {
  /** 有新向量了（embed 完成 / 视频片段完成）：排一次判定 */
  kick(): void
  /** 视频片段向量更新了：让这个视频的代表帧重新判定 */
  videoUpdated(videoId: number): void
}

export function registerAutoTags(db: DatabaseInstance, onTagsChanged: () => void): AutoTagService {
  const store = new AutoTagStore(db.raw)
  const labels = new Map<string, Label>(VOCABULARY.map((l) => [l.id, l]))
  let labelVecs: LabelVector[] | null = null
  let baselines: { image: Baseline; segment: Baseline; count: { image: number; segment: number } } | null = null
  let running = false
  let again = false

  const enabled = (): boolean => db.getMetaState(ENABLED_KEY) !== '0'

  const status = (): AutoTagStatus => {
    const c = store.counts(VOCABULARY_VERSION)
    return { enabled: enabled(), running, ...c, waitingForLibrary: db.countVectors().image < BASELINE_MIN_ITEMS }
  }
  const broadcast = (): void => {
    const s = status()
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(AUTOTAG_CHANNELS.CHANGED, s)
  }

  /** 词表文字向量：库里有本版本的就用，否则编码一遍（约 150 × 1–3 句，GPU 上十几秒） */
  async function ensureLabelVectors(): Promise<LabelVector[] | null> {
    if (labelVecs) return labelVecs
    let cached = store.loadLabelVectors(VOCABULARY_VERSION)
    if (cached.size < VOCABULARY.length) {
      const svc = getEmbeddingService()
      if (!svc.isReady()) return null
      const fresh = new Map<string, Float32Array>()
      for (const l of VOCABULARY) {
        const vs: Float32Array[] = []
        for (const p of l.prompts) vs.push(await svc.encodeText(p))
        const avg = new Float32Array(vs[0].length)
        for (const v of vs) for (let i = 0; i < avg.length; i++) avg[i] += v[i] / vs.length
        const n = Math.hypot(...avg)
        fresh.set(l.id, avg.map((x) => x / n))
      }
      store.saveLabelVectors(VOCABULARY_VERSION, fresh)
      cached = fresh
    }
    labelVecs = VOCABULARY.filter((l) => cached.has(l.id)).map((l) => ({
      id: l.id,
      vector: cached.get(l.id)!,
      extraZ: l.facet === 'activity' ? ACTIVITY_EXTRA_Z : 0,
    }))
    return labelVecs
  }

  function ensureBaselines(vecs: LabelVector[]): typeof baselines {
    const count = db.countVectors()
    const stale = (k: 'image' | 'segment'): boolean =>
      !baselines || Math.abs(count[k] - baselines.count[k]) > Math.max(10, baselines.count[k] * 0.1)
    if (!baselines || stale('image') || stale('segment')) {
      baselines = {
        image: labelBaseline(db.sampleVectors('image', BASELINE_SAMPLE), vecs),
        segment: labelBaseline(db.sampleVectors('segment', BASELINE_SAMPLE), vecs),
        count,
      }
    }
    return baselines
  }

  async function run(): Promise<void> {
    if (running) { again = true; return }
    if (!enabled() || db.countVectors().image < BASELINE_MIN_ITEMS) return
    running = true
    broadcast()
    try {
      const vecs = await ensureLabelVectors()
      if (!vecs) return
      let changed = 0
      for (;;) {
        if (!enabled()) break
        const hashes = store.pendingHashes(VOCABULARY_VERSION, BATCH)
        if (hashes.length === 0) break
        const b = ensureBaselines(vecs)!
        for (const hash of hashes) {
          const img = store.imageVector(hash)
          const primary = img ? assignLabels(img, vecs, b.image) : []
          // 视频 / 音频：各片段（画面 + 声音）也判一遍，合并；只在片段里出现的标签门槛更高
          const segs = store.segmentVectors(hash).map((seg) => assignLabels(seg, vecs, b.segment))
          changed += store.apply(hash, VOCABULARY_VERSION, mergeAssignments(segs, undefined, primary), labels)
        }
        broadcast()
        await new Promise((r) => setImmediate(r))
      }
      if (changed > 0) onTagsChanged()
    } catch (err) {
      console.error('[autotags] failed:', err)
    } finally {
      running = false
      broadcast()
      if (again) { again = false; void run() }
    }
  }

  ipcMain.handle(AUTOTAG_CHANNELS.STATUS, async () => status())
  ipcMain.handle(AUTOTAG_CHANNELS.SET_ENABLED, async (_e, on: unknown) => {
    db.setMetaState(ENABLED_KEY, on ? '1' : '0')
    // 关掉：去掉还没确认的自动标签（确认过的已经是普通标签）
    if (!on) { store.clearAuto(); onTagsChanged() } else void run()
    broadcast()
    return status()
  })
  ipcMain.handle(AUTOTAG_CHANNELS.RERUN, async () => {
    store.reset()
    baselines = null
    onTagsChanged()
    void run()
    return status()
  })

  // 启动后稍等再补跑存量（先让首屏、索引队列跑起来）
  setTimeout(() => void run(), 15_000)

  return {
    kick: () => { setTimeout(() => void run(), 2000) },
    videoUpdated: (videoId) => {
      const hash = store.representativeHashOfVideo(videoId)
      if (hash) store.forget(hash)
      setTimeout(() => void run(), 2000)
    },
  }
}
