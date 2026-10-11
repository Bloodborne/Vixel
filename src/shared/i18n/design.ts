/** 设计格式 + 颜色筛选 */
const zh = {
  // 设计格式（检查器）
  format: '格式',
  pages: '页数',
  pageCount: (n: number): string => `${n} 页`,
  // 颜色筛选 / 色板
  color: '颜色',
  palette: '色板',
  colorFilterTitle: (name: string): string => `按颜色筛选：${name}`,
  paletteSwatchTitle: (name: string, pct: number): string => `${name} · ${pct}%（点击筛选）`,
  colorNames: {
    red: '红',
    orange: '橙',
    yellow: '黄',
    green: '绿',
    cyan: '青',
    blue: '蓝',
    purple: '紫',
    pink: '粉',
    brown: '棕',
    black: '黑灰',
    white: '白',
    mono: '单色',
  } as Record<string, string>,
}

const en: typeof zh = {
  format: 'Format',
  pages: 'Pages',
  pageCount: (n) => (n === 1 ? '1 page' : `${n} pages`),
  color: 'Color',
  palette: 'Palette',
  colorFilterTitle: (name) => `Filter by color: ${name}`,
  paletteSwatchTitle: (name, pct) => `${name} · ${pct}% (click to filter)`,
  colorNames: {
    red: 'Red',
    orange: 'Orange',
    yellow: 'Yellow',
    green: 'Green',
    cyan: 'Cyan',
    blue: 'Blue',
    purple: 'Purple',
    pink: 'Pink',
    brown: 'Brown',
    black: 'Black / Gray',
    white: 'White',
    mono: 'Monochrome',
  },
}

export default { zh, en }
