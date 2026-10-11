import { useEffect, useRef, useState } from 'react'
import type { Tag, TagsForSelection } from '../../../../shared/tags'
import { kbd } from '../../lib/platform'
import { Icon } from '../shell/icons'
import { t } from '../../../../shared/i18n'

/** 输入时最多列出这么多个已有标签 */
const SUGGEST_MAX = 8

/**
 * 检查器里的标签编辑：标签以小块列出，× 移除；输入框回车添加（已有的直接用，没有就新建），
 * 输入时按使用次数列出匹配的已有标签，↑↓ 选、回车确认。
 * 多选时：每一项都有的标签正常显示，只有部分项有的淡色显示，点一下补到全部。
 * focusKey 变化（T 键）时把焦点放进输入框。
 */
export function TagEditor({ hashes, focusKey = 0 }: { hashes: string[]; focusKey?: number }): JSX.Element {
  const [current, setCurrent] = useState<TagsForSelection>({ all: [], some: [] })
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [text, setText] = useState('')
  const [cursor, setCursor] = useState(0)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const key = hashes.join(',')

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      window.api.tags.forHashes(hashes).then((x) => { if (!cancelled) setCurrent(x) }).catch(() => {})
      window.api.tags.list().then((x) => { if (!cancelled) setAllTags(x) }).catch(() => {})
    }
    load()
    const off = window.api.tags.onChanged(load)
    return () => { cancelled = true; off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (focusKey > 0) inputRef.current?.focus()
  }, [focusKey])

  const has = new Set(current.all.map((x) => x.name.toLowerCase()))
  const q = text.trim().toLowerCase()
  const suggestions = q
    ? allTags.filter((x) => x.name.toLowerCase().includes(q) && !has.has(x.name.toLowerCase()))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || b.count - a.count)
      .slice(0, SUGGEST_MAX)
    : []
  const exact = allTags.some((x) => x.name.toLowerCase() === q)
  // 最后一项是"新建"（输入的名字还没有这个标签时）
  const options: Array<{ name: string; create: boolean }> = [
    ...suggestions.map((x) => ({ name: x.name, create: false })),
    ...(q && !exact && !has.has(q) ? [{ name: text.trim(), create: true }] : []),
  ]

  const add = async (name: string): Promise<void> => {
    const clean = name.trim()
    if (!clean || hashes.length === 0) return
    setText('')
    setCursor(0)
    await window.api.tags.add(hashes, clean)
  }
  const remove = (tag: Tag): void => { void window.api.tags.remove(hashes, tag.id) }

  return (
    <div className="flex flex-col gap-1.5" data-tag-editor>
      {(current.all.length > 0 || current.some.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {current.all.map((tag) => (
            <span key={tag.id} className="h-6 pl-2 pr-0.5 rounded-md bg-fill-hover text-ink text-caption flex items-center gap-0.5 max-w-full">
              <span className="truncate">{tag.name}</span>
              <button
                onClick={() => remove(tag)}
                title={t.tags.remove(tag.name)}
                className="w-4 h-4 flex-shrink-0 rounded flex items-center justify-center text-ink-3 hover:text-ink hover:bg-fill-active"
              >
                <Icon name="close" className="w-3 h-3" />
              </button>
            </span>
          ))}
          {current.some.map((tag) => (
            <button
              key={tag.id}
              onClick={() => void add(tag.name)}
              title={t.tags.partial}
              className="h-6 px-2 rounded-md border border-dashed border-line-strong text-ink-3 text-caption hover:text-ink hover:border-line-heavy max-w-full truncate"
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          value={text}
          data-tag-input
          onChange={(e) => { setText(e.target.value); setCursor(0) }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            // 输入框里的键不冒泡给网格（方向键 / 空格 / F / T）
            e.stopPropagation()
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(options.length - 1, c + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
            else if (e.key === 'Enter') {
              e.preventDefault()
              void add(options[cursor]?.name ?? text)
            } else if (e.key === 'Escape') {
              if (text) setText('')
              else inputRef.current?.blur()
            }
          }}
          placeholder={t.tags.addPlaceholder}
          title={t.tags.addHint(kbd('T'))}
          className="w-full h-7 px-2 text-callout rounded-md bg-fill border border-line text-ink placeholder-ink-4 focus:outline-none focus:border-accent/50 focus:bg-raised"
        />
        {focused && options.length > 0 && (
          <div className="absolute z-30 top-8 inset-x-0 py-1 rounded-lg bg-raised border border-line-strong shadow-lg animate-fade-in">
            {options.map((o, i) => (
              <button
                key={`${o.create}:${o.name}`}
                onMouseDown={(e) => { e.preventDefault(); void add(o.name) }}
                onMouseEnter={() => setCursor(i)}
                className={`w-full h-7 px-2.5 flex items-center gap-2 text-caption text-left ${i === cursor ? 'bg-fill text-ink' : 'text-ink-2'}`}
              >
                <Icon name={o.create ? 'plus' : 'tag'} className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
                <span className="truncate">{o.create ? t.tags.createTag(o.name) : o.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
