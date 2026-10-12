/**
 * 查询分析（纯函数，不碰数据库和模型）：搜索前先看一眼查询本身。
 *
 * 1. 类型词：「火车的视频」「video of a waterfall」里的 视频 / video 说的是媒体类型，不是画面内容。
 *    留着它编向量会稀释查询（实测带「的视频」时真命中掉到第二名、还被标 lowConfidence），
 *    所以剥掉后再编向量；类型意图单独返回，融合阶段做软加权（不是过滤 —— 类型词有歧义，
 *    「截图」也可能真是画面里的手机）。查询只剩类型词时（「视频」），调用方直接按类型浏览。
 *
 * 2. 查号式查询：「IMG_2682」「N49」「2024-03」这类编号 / 代号，向量通道基本是噪声，
 *    真正的证据在 OCR / 文件名 / 标签这些精确文本通道里 —— 返回 isLookup，调用方把
 *    精确通道的融合权重加倍、向量通道减半。
 */

import type { MediaKind } from '../shared/types'

export interface QueryAnalysis {
  /** 查询里的类型词指向的媒体类型（去重；截图算 image）。空数组 = 没有类型词 */
  kinds: MediaKind[]
  /** 类型词更具体地说的是「截图 / screenshot」（目前同样按 image 软加权，字段留给以后用） */
  screenshot: boolean
  /** 剥掉类型词后的查询文本（空白已收拢）。拿它编向量和查文本通道 */
  strippedText: string
  /** 查询只有类型词（「视频」「screenshots」）：没有内容可搜，按类型浏览 */
  kindOnly: boolean
  /** 每个词都像编号 / 代号（含数字，且有字母或 ≥ 4 字符）：精确文本通道加倍、向量通道减半 */
  isLookup: boolean
}

type KindWord = MediaKind | 'screenshot'

/**
 * 中文类型词 → 类型。按「长词优先」排列（屏幕截图 要在 截图 前面，否则剩个「屏幕」）。
 * 只收无歧义的双字以上词：「歌」「图」这类单字在正常查询里太常见（歌剧院、图书馆），不收。
 */
const ZH_KIND_WORDS: Array<[string, KindWord]> = [
  ['屏幕截图', 'screenshot'],
  ['截图', 'screenshot'],
  ['截屏', 'screenshot'],
  ['视频', 'video'],
  ['影片', 'video'],
  ['录像', 'video'],
  ['短片', 'video'],
  ['片段', 'video'],
  ['照片', 'image'],
  ['图片', 'image'],
  ['相片', 'image'],
  ['录音', 'audio'],
  ['音频', 'audio'],
  ['语音', 'audio'],
  ['歌曲', 'audio'],
  ['播客', 'audio'],
]

/** 英文类型词（单复数）→ 类型 */
function enWordKind(word: string): KindWord | null {
  const w = word.toLowerCase().replace(/s$/, '')
  switch (w) {
    case 'video':
    case 'movie':
    case 'clip':
    case 'footage':
      return 'video'
    case 'photo':
    case 'photograph':
    case 'picture':
    case 'pic':
    case 'image':
      return 'image'
    case 'screenshot':
      return 'screenshot'
    case 'audio':
    case 'recording':
    case 'song':
    case 'podcast':
      return 'audio'
    default:
      return null
  }
}

/** 英文类型词的字面量（供短语模板用） */
const EN_KIND_ALT =
  '(videos?|movies?|clips?|footage|photos?|photographs?|pictures?|pics?|images?|screenshots?|audio|recordings?|songs?|podcasts?)'

/**
 * 英文短语模板，特指性从高到低依次剥：
 *   "a video of a waterfall" / "photo showing a cat" → 内容在 of/showing 之后
 *   "a waterfall in a video"                          → 内容在前
 *   裸类型词 "waterfall video"
 */
const EN_PATTERNS: RegExp[] = [
  new RegExp(`(?:\\b(?:in|from)\\s+)?\\b(?:a|an|the)\\s+${EN_KIND_ALT}\\s+(?:of|showing|with)\\s+`, 'gi'),
  new RegExp(`\\b${EN_KIND_ALT}\\s+(?:of|showing)\\s+`, 'gi'),
  new RegExp(`\\b(?:in|from|as)\\s+(?:a|an|the)\\s+${EN_KIND_ALT}\\b`, 'gi'),
  new RegExp(`\\b(?:a|an|the)\\s+${EN_KIND_ALT}\\b`, 'gi'),
  new RegExp(`\\b${EN_KIND_ALT}\\b`, 'gi'),
]

/** 像编号 / 代号：含数字，且（有字母 或 总长 ≥ 4）。"N49" "IMG_2682" "2024-03" 是，"450" 不是 */
function looksLikeCode(term: string): boolean {
  return /\d/.test(term) && (/[a-z]/i.test(term) || term.length >= 4)
}

export function analyzeQuery(raw: string): QueryAnalysis {
  const kindSet = new Set<KindWord>()
  let text = raw.trim()

  // 中文类型词：子串匹配（CJK 没有词边界），顺带吃掉紧邻的助词
  //   「火车的视频」→「火车」  「视频里的猫」→「猫」
  for (const [word, kind] of ZH_KIND_WORDS) {
    if (!text.includes(word)) continue
    kindSet.add(kind)
    text = text.split(`的${word}`).join('')
    text = text.replace(new RegExp(`${word}(?:里的|中的|里|中)`, 'g'), '')
    text = text.split(word).join('')
  }

  // 英文类型词：按词边界 + 短语模板剥（从特指性高的模板开始，避免剩下孤零零的 "of"）
  for (const pattern of EN_PATTERNS) {
    text = text.replace(pattern, (match) => {
      const word = match.match(new RegExp(EN_KIND_ALT, 'i'))?.[0]
      const kind = word ? enWordKind(word) : null
      if (kind) kindSet.add(kind)
      return ' '
    })
  }

  const strippedText = text.replace(/\s+/g, ' ').trim()

  const kinds: MediaKind[] = []
  for (const k of kindSet) {
    const mediaKind: MediaKind = k === 'screenshot' ? 'image' : k
    if (!kinds.includes(mediaKind)) kinds.push(mediaKind)
  }

  const terms = (strippedText || raw.trim()).split(/\s+/).filter(Boolean)
  return {
    kinds,
    screenshot: kindSet.has('screenshot'),
    strippedText,
    kindOnly: strippedText.length === 0 && kinds.length > 0,
    isLookup: terms.length > 0 && terms.every(looksLikeCode),
  }
}
