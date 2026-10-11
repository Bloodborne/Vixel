import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { t } from '../../../../shared/i18n'
import { COLOR_BUCKETS, BUCKET_SWATCHES } from '../../../../shared/colors'
import type { MediaFilters, Person } from '../../../../shared/types'
import type { Tag } from '../../../../shared/tags'

/** 来源（类型 / 文件夹）和日期之外的筛选条件；没设的键不出现（计数、判空都靠它） */
export type ExtraFilters = Pick<MediaFilters, 'orientation' | 'minPixels' | 'maxPixels' | 'durationMin' | 'durationMax' | 'personId' | 'favorite' | 'tagIds' | 'color'>

interface Preset { key: string; label: string; value: ExtraFilters }

// 每组是互斥的预设；选中某个预设 = 用它的键覆盖本组的键
const ORIENTATION: Preset[] = [
  { key: 'landscape', label: t.organize.landscape, value: { orientation: 'landscape' } },
  { key: 'portrait', label: t.organize.portrait, value: { orientation: 'portrait' } },
  { key: 'square', label: t.organize.square, value: { orientation: 'square' } },
  { key: 'panorama', label: t.organize.panorama, value: { orientation: 'panorama' } },
]
const RESOLUTION: Preset[] = [
  { key: '12mp', label: t.organize.res12mp, value: { minPixels: 12_000_000 } },
  { key: '4k', label: t.organize.res4k, value: { minPixels: 8_000_000 } },
  { key: '1080', label: t.organize.res1080, value: { minPixels: 2_000_000 } },
  { key: 'small', label: t.organize.resSmall, value: { maxPixels: 1_000_000 } },
]
const DURATION: Preset[] = [
  { key: 'short', label: t.organize.durShort, value: { durationMax: 30_000 } },
  { key: 'medium', label: t.organize.durMedium, value: { durationMin: 30_000, durationMax: 300_000 } },
  { key: 'long', label: t.organize.durLong, value: { durationMin: 300_000 } },
]
const GROUPS: Array<{ title: string; keys: Array<keyof ExtraFilters>; presets: Preset[] }> = [
  { title: t.organize.orientation, keys: ['orientation'], presets: ORIENTATION },
  { title: t.organize.resolution, keys: ['minPixels', 'maxPixels'], presets: RESOLUTION },
  { title: t.organize.duration, keys: ['durationMin', 'durationMax'], presets: DURATION },
]

export function hasExtraFilters(f: ExtraFilters): boolean {
  return Object.keys(f).length > 0
}

/** 生效的条件组数（分辨率 / 时长的上下限算一组，每个标签算一个），给工具栏按钮的角标 */
export function countExtraFilters(f: ExtraFilters): number {
  return GROUPS.filter((g) => g.keys.some((k) => f[k] != null)).length + (f.personId != null ? 1 : 0) + (f.favorite ? 1 : 0) +
    (f.tagIds?.length ?? 0) + (f.color ? 1 : 0)
}

/** 生效条件的文字标签（智能相册默认名用）；人物名、标签名由调用方查好传入 */
export function describeExtraFilters(f: ExtraFilters, personName?: string, tagNames: string[] = []): string[] {
  const labels: string[] = []
  for (const g of GROUPS) {
    const p = g.presets.find((x) => isPreset(f, g.keys, x))
    if (p) labels.push(p.label)
  }
  if (f.color) labels.push(t.design.colorNames[f.color] ?? f.color)
  if (f.personId != null) labels.push(personName || t.organize.person)
  if (f.favorite) labels.push(t.organize.favorites)
  labels.push(...tagNames.map((n) => `#${n}`))
  return labels
}

/** 筛选栏和侧栏共用的标签列表（任意窗口改了标签主进程会广播） */
export function useTags(): Tag[] {
  const [tags, setTags] = useState<Tag[]>([])
  useEffect(() => {
    let cancelled = false
    const load = (): void => { window.api.tags.list().then((x) => { if (!cancelled) setTags(x) }).catch(() => {}) }
    load()
    const off = window.api.tags.onChanged(load)
    return () => { cancelled = true; off() }
  }, [])
  return tags
}

function without(f: ExtraFilters, keys: Array<keyof ExtraFilters>): ExtraFilters {
  const next = { ...f }
  for (const k of keys) delete next[k]
  return next
}

function isPreset(f: ExtraFilters, keys: Array<keyof ExtraFilters>, p: Preset): boolean {
  return keys.every((k) => f[k] === p.value[k])
}

function personLabel(p: Person): string {
  return p.name || t.organize.unnamedPerson(p.photoCount ?? p.faceCount)
}

/**
 * 网格上方的筛选栏。展开时列出全部选项；收起后若还有生效条件，只显示可单独移除的条件标签，
 * 点空白处重新展开。和日期栏同样贴在工具栏下面。
 */
export function FilterBar({ value, expanded, onChange, onExpand, onClose }: {
  value: ExtraFilters
  expanded: boolean
  onChange: (next: ExtraFilters) => void
  onExpand: () => void
  onClose: () => void
}): JSX.Element {
  const [people, setPeople] = useState<Person[]>([])
  const tags = useTags()
  useEffect(() => {
    let cancelled = false
    window.api.getPeople().then((all) => {
      if (cancelled) return
      // 已命名的按名字排在前面，未命名的只取照片最多的几位
      const visible = all.filter((p) => !p.hidden)
      const named = visible.filter((p) => p.name).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      const unnamed = visible.filter((p) => !p.name).sort((a, b) => (b.photoCount ?? b.faceCount) - (a.photoCount ?? a.faceCount)).slice(0, 8)
      setPeople([...named, ...unnamed])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const active = hasExtraFilters(value)
  const person = value.personId != null ? people.find((p) => p.id === value.personId) : undefined

  // 收起状态：生效条件的标签
  const chips: Array<{ label: string; remove: () => void }> = []
  for (const g of GROUPS) {
    const p = g.presets.find((x) => isPreset(value, g.keys, x))
    if (p) chips.push({ label: p.label, remove: () => onChange(without(value, g.keys)) })
  }
  if (value.personId != null) {
    chips.push({ label: person ? personLabel(person) : t.organize.person, remove: () => onChange(without(value, ['personId'])) })
  }
  if (value.color) {
    chips.push({ label: t.design.colorNames[value.color] ?? value.color, remove: () => onChange(without(value, ['color'])) })
  }
  if (value.favorite) chips.push({ label: t.organize.favoritesOnly, remove: () => onChange(without(value, ['favorite'])) })
  const setTagIds = (ids: number[]): void => onChange(ids.length ? { ...value, tagIds: ids } : without(value, ['tagIds']))
  for (const id of value.tagIds ?? []) {
    const name = tags.find((x) => x.id === id)?.name
    if (name) chips.push({ label: `#${name}`, remove: () => setTagIds((value.tagIds ?? []).filter((x) => x !== id)) })
  }

  if (!expanded) {
    return (
      <div
        className="h-9 flex-shrink-0 px-4 bg-bar border-b border-line flex items-center gap-1.5 animate-fade-in cursor-default"
        onClick={(e) => { if (e.target === e.currentTarget) onExpand() }}
      >
        <button onClick={onExpand} className="flex items-center gap-1 text-caption text-ink-3 hover:text-ink mr-1">
          <Icon name="filter" className="w-3.5 h-3.5" />
          {t.organize.filter}
        </button>
        {chips.map((c) => (
          <span key={c.label} className="h-6 pl-2 pr-1 rounded-md bg-accent-fill text-accent text-caption flex items-center gap-0.5">
            {c.label}
            <button
              onClick={c.remove}
              title={t.organize.removeFilter(c.label)}
              className="w-4 h-4 rounded flex items-center justify-center hover:bg-accent/20"
            >
              <Icon name="close" className="w-3 h-3" />
            </button>
          </span>
        ))}
        <button onClick={() => onChange({})} className="ml-1 text-caption text-ink-3 hover:text-ink px-1.5 py-0.5 rounded hover:bg-fill">
          {t.organize.clear}
        </button>
      </div>
    )
  }

  return (
    <div className="flex-shrink-0 px-4 py-1.5 bg-bar border-b border-line flex items-start gap-3 animate-fade-in">
      {/* 选项可以折行；清除 / 关闭固定在右上，不会被挤到单独一行 */}
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-5 gap-y-1.5 min-h-6">
        {GROUPS.map((g) => (
          <Segmented
            key={g.title}
            title={g.title}
            options={g.presets.map((p) => ({ key: p.key, label: p.label, active: isPreset(value, g.keys, p) }))}
            onPick={(key) => {
              const p = g.presets.find((x) => x.key === key)!
              const cleared = without(value, g.keys)
              onChange(isPreset(value, g.keys, p) ? cleared : { ...cleared, ...p.value })
            }}
          />
        ))}

        <ColorPicker
          selected={value.color}
          onChange={(c) => onChange(c == null ? without(value, ['color']) : { ...value, color: c })}
        />

        <label className="flex items-center gap-2">
          <span className="text-caption text-ink-3">{t.organize.person}</span>
          <select
            value={value.personId ?? ''}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null
              onChange(id == null ? without(value, ['personId']) : { ...value, personId: id })
            }}
            className={`h-6 max-w-[160px] px-1.5 text-caption rounded border focus:outline-none focus:border-accent/50 ${
              value.personId != null ? 'bg-accent-fill border-accent/40 text-accent' : 'bg-fill border-line text-ink'
            }`}
          >
            <option value="">{t.organize.anyone}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
          </select>
        </label>

        <button
          onClick={() => onChange(value.favorite ? without(value, ['favorite']) : { ...value, favorite: true })}
          aria-pressed={!!value.favorite}
          className={`h-6 px-2 rounded-md text-caption flex items-center gap-1 transition-colors duration-fast ${
            value.favorite ? 'bg-accent-fill text-accent' : 'text-ink-2 hover:text-ink hover:bg-fill-hover'
          }`}
        >
          <Icon name="heart" filled={!!value.favorite} className="w-3.5 h-3.5" />
          {t.organize.favoritesOnly}
        </button>

        <TagPicker tags={tags} selected={value.tagIds ?? []} onChange={setTagIds} />
      </div>

      {active && (
        <button onClick={() => onChange({})} className="h-6 text-caption text-ink-3 hover:text-ink px-1.5 rounded hover:bg-fill flex-shrink-0">
          {t.organize.clear}
        </button>
      )}
      <button
        onClick={onClose}
        title={t.common.close}
        className="w-6 h-6 flex-shrink-0 rounded-md text-ink-3 hover:text-ink hover:bg-fill-hover flex items-center justify-center"
      >
        <Icon name="close" className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/** 标签筛选：按钮 + 弹出列表（按使用次数排，可输入过滤），多选 = 同时带有这些标签 */
function TagPicker({ tags, selected, onChange }: {
  tags: Tag[]
  selected: number[]
  onChange: (ids: number[]) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const live = tags.filter((x) => x.count > 0 || selected.includes(x.id))
  const q = filter.trim().toLowerCase()
  const shown = q ? live.filter((x) => x.name.toLowerCase().includes(q)) : live
  const toggle = (id: number): void => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setFilter('') }}
        aria-expanded={open}
        data-tag-filter
        className={`h-6 px-2 rounded-md text-caption flex items-center gap-1 transition-colors duration-fast ${
          selected.length ? 'bg-accent-fill text-accent' : 'text-ink-2 hover:text-ink hover:bg-fill-hover'
        }`}
      >
        <Icon name="tag" className="w-3.5 h-3.5" />
        {t.tags.filterLabel}{selected.length ? ` · ${selected.length}` : ''}
      </button>
      {open && (
        <div className="absolute z-30 top-7 left-0 w-56 max-h-72 flex flex-col rounded-lg bg-raised border border-line-strong shadow-lg overflow-hidden animate-fade-in">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}
            placeholder={t.tags.filterPlaceholder}
            className="h-8 px-2.5 text-caption bg-transparent border-b border-line text-ink placeholder-ink-4 focus:outline-none"
          />
          <div className="flex-1 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <p className="px-2.5 py-1.5 text-caption text-ink-4">{t.tags.filterNone}</p>
            ) : shown.map((tag) => {
              const on = selected.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  onClick={() => toggle(tag.id)}
                  aria-pressed={on}
                  className="w-full h-7 px-2.5 flex items-center gap-2 text-caption text-left text-ink-2 hover:bg-fill hover:text-ink"
                >
                  <span className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center flex-shrink-0 ${on ? 'bg-accent border-accent text-white' : 'border-line-heavy'}`}>
                    {on && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.5 2.5 4.5-5" /></svg>}
                  </span>
                  <span className="flex-1 truncate">{tag.name}</span>
                  <span className="text-ink-4 tabular-nums">{tag.count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** 色板里能画出来的颜色（mono 用黑白渐变）；与 shared/colors.ts 的桶一一对应 */
export function colorSwatchStyle(bucket: string): React.CSSProperties {
  if (bucket === 'mono') return { background: 'linear-gradient(135deg, #1a1a1a 0%, #fafafa 100%)' }
  return { background: BUCKET_SWATCHES[bucket as keyof typeof BUCKET_SWATCHES] ?? '#888' }
}

/** 颜色筛选：12 个命名色块，单选（再点一次取消） */
function ColorPicker({ selected, onChange }: {
  selected?: string
  onChange: (bucket: string | null) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-caption text-ink-3">{t.design.color}</span>
      <div className="flex items-center gap-1">
        {COLOR_BUCKETS.map((b) => {
          const on = selected === b
          const name = t.design.colorNames[b] ?? b
          return (
            <button
              key={b}
              onClick={() => onChange(on ? null : b)}
              aria-pressed={on}
              title={t.design.colorFilterTitle(name)}
              data-color-swatch={b}
              className={`w-[18px] h-[18px] rounded-full border transition-shadow duration-fast ${
                on ? 'ring-2 ring-accent ring-offset-1 ring-offset-bar border-transparent' : 'border-line-heavy hover:ring-1 hover:ring-ink-4'
              }`}
              style={colorSwatchStyle(b)}
            />
          )
        })}
      </div>
    </div>
  )
}

function Segmented({ title, options, onPick }: {
  title: string
  options: Array<{ key: string; label: string; active: boolean }>
  onPick: (key: string) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-caption text-ink-3">{title}</span>
      <div className="flex gap-0.5 p-0.5 rounded-md bg-fill">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => onPick(o.key)}
            aria-pressed={o.active}
            className={`h-5 px-2 rounded-[4px] text-caption whitespace-nowrap transition-colors duration-fast ${
              o.active ? 'bg-raised text-ink shadow-sm' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
