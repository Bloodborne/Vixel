import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { t } from '../../../../shared/i18n'
import type { MediaFilters, Person } from '../../../../shared/types'

/** 来源（类型 / 文件夹）和日期之外的筛选条件；没设的键不出现（计数、判空都靠它） */
export type ExtraFilters = Pick<MediaFilters, 'orientation' | 'minPixels' | 'maxPixels' | 'durationMin' | 'durationMax' | 'personId' | 'favorite'>

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

/** 生效的条件组数（分辨率 / 时长的上下限算一组），给工具栏按钮的角标 */
export function countExtraFilters(f: ExtraFilters): number {
  return GROUPS.filter((g) => g.keys.some((k) => f[k] != null)).length + (f.personId != null ? 1 : 0) + (f.favorite ? 1 : 0)
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
  if (value.favorite) chips.push({ label: t.organize.favoritesOnly, remove: () => onChange(without(value, ['favorite'])) })

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
