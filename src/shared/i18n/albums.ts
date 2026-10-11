/** 智能相册：侧栏分组、保存 / 更新、右键菜单、删除确认 */
const zh = {
  group: '智能相册',
  empty: '保存搜索或筛选条件，内容会自动更新',
  saveCurrent: '把当前搜索和筛选存为智能相册',
  nothingToSave: '先输入搜索词或设置筛选条件',
  saveAsAlbum: '存为智能相册',
  savedAs: (name: string) => `已存为智能相册「${name}」，点击打开`,
  rename: '重命名',
  update: '用当前条件更新',
  delete: '删除智能相册…',
  updateAlbum: '更新相册',
  updateAlbumTitle: '把当前的搜索词和筛选条件保存到这个相册',
  deleteConfirm: (name: string) => `删除智能相册「${name}」？`,
  deleteDetail: '只删除这个相册的条件，照片和视频不受影响。',
  deleteButton: '删除',
  untitled: '未命名相册',
  dateRange: (from: string, to: string) => (from && to ? `${from} – ${to}` : from ? `${from} 起` : `${to} 前`),
}

const en: typeof zh = {
  group: 'Smart Albums',
  empty: 'Save a search or filters; the album stays up to date',
  saveCurrent: 'Save the current search and filters as a smart album',
  nothingToSave: 'Enter a search or set a filter first',
  saveAsAlbum: 'Save as Smart Album',
  savedAs: (name) => `Saved as smart album “${name}”. Click to open.`,
  rename: 'Rename',
  update: 'Update with Current Filters',
  delete: 'Delete Smart Album…',
  updateAlbum: 'Update Album',
  updateAlbumTitle: 'Save the current search and filters to this album',
  deleteConfirm: (name) => `Delete the smart album “${name}”?`,
  deleteDetail: 'Only the album is removed. Your photos and videos are not affected.',
  deleteButton: 'Delete',
  untitled: 'Untitled Album',
  dateRange: (from, to) => (from && to ? `${from} – ${to}` : from ? `from ${from}` : `until ${to}`),
}

export default { zh, en }
