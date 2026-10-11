/**
 * 中文分词 helper —— 用于在写入/查询 FTS5 之前预切词。
 *
 * 为什么需要这个：
 *   FTS5 的 unicode61 tokenizer 把一串连续汉字当成一个 token（"海边的日落"整体一个词），
 *   中文里搜其中任何一个词都匹配不上。jieba 先切出有语义的词，再用空格连接交给 FTS5。
 *
 * 策略：
 *   - ASCII / 拉丁字符：保持原样（按空格/标点切由 unicode61 处理）
 *   - 含 CJK / 非 ASCII：整段交给 jieba（search 模式，长词再切出短词，召回更广）
 *   - 写入侧（jiebatok UDF）和查询侧都走这个函数，保证 token 一致
 *
 * 依赖：@node-rs/jieba 2.x（Rust 实现，prebuilt 二进制）。2.x 不再导出 cut 函数，
 * 要用内置词典构造 Jieba 实例；实例懒加载，第一次遇到中文时才付构造代价（~100 ms）。
 * 改动分词结果后要提升 db.ts 的 FTS_TOKENIZER_VERSION，已有的 OCR 全文索引会自动重建。
 */
import type { Jieba } from '@node-rs/jieba'

let jieba: Jieba | null = null

function getJieba(): Jieba {
  if (!jieba) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Jieba: JiebaClass } = require('@node-rs/jieba') as typeof import('@node-rs/jieba')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dict } = require('@node-rs/jieba/dict') as { dict: Uint8Array }
    jieba = JiebaClass.withDict(dict)
  }
  return jieba
}

/** 是否包含 CJK / 全角符号等非 ASCII 字符 —— 决定是否走 jieba。 */
function hasCjk(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return true
  }
  return false
}

/**
 * 把一段文本切成空格分隔的 token 序列，供 FTS5 insert 或 query 使用。
 * 出错时退化为原文：FTS5 至少还能整段匹配，不会丢数据。
 */
export function tokenizeForFtsSync(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (!hasCjk(trimmed)) return trimmed.replace(/\s+/g, ' ')
  try {
    return getJieba()
      .cutForSearch(trimmed, true)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join(' ')
  } catch (err) {
    console.warn('jieba tokenize failed, falling back to raw text:', err)
    return trimmed
  }
}

/** 预热词典（启动后空闲时调用一次），避免第一次切词卡住 SQLite 触发器 */
export function preloadJieba(): void {
  try {
    getJieba()
  } catch (err) {
    console.warn('Failed to load jieba (Chinese tokenization disabled):', err)
  }
}
