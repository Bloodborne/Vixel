/** 标签 + Eagle 资源库：侧栏、检查器、筛选栏、右键菜单、结果角标 */
const n = (v: number): string => v.toLocaleString('zh-CN')

const zh = {
  // 侧栏
  section: '标签',
  showAll: (count: number) => `显示全部（${n(count)}）`,
  showLess: '收起',
  // 右键菜单
  rename: '重命名',
  mergeInto: '合并到',
  noOtherTags: '没有其他标签',
  deleteTag: '删除标签…',
  deleteConfirm: (name: string) => `删除标签“${name}”？`,
  deleteDetail: '标签会从所有内容上移除，照片和视频本身不受影响。从 Eagle 同步来的标签，下次同步时会按 Eagle 里的状态恢复。',
  deleteButton: '删除',
  // 检查器
  tags: '标签',
  addPlaceholder: '添加标签…',
  addHint: (key: string) => `添加标签（${key}）`,
  remove: (name: string) => `移除标签“${name}”`,
  partial: '只有部分选中项有这个标签，点击应用到全部',
  createTag: (name: string) => `新建标签“${name}”`,
  // 筛选栏
  filterLabel: '标签',
  filterPlaceholder: '搜索标签…',
  filterNone: '还没有标签',
  // 结果角标
  matchTag: '标签',
  matchNote: '注释',
  // 标签视图
  emptyTitle: '这个标签下没有内容',
  emptyHint: '在检查器里给照片和视频打标签，按 T 快速添加。',
  // Eagle
  eagle: 'Eagle',
  eagleNote: '注释',
  eagleUrl: '来源',
  eagleStar: '星级',
  eagleFolders: '文件夹',
  addEagleLibrary: '添加 Eagle 资源库…',
  eagleDialogTitle: '选择 Eagle 资源库（.library 文件夹）',
  notEagleTitle: '这不是 Eagle 资源库',
  notEagleDetail: '请选择以 .library 结尾、里面有 metadata.json 和 images 文件夹的目录。',
  eagleLibraryHint: '只读接入：Vixel 会读取 Eagle 的标签、文件夹和注释，不会改动资源库里的任何文件。',
  eagleSuffix: '（Eagle）',
}

const en: typeof zh = {
  section: 'Tags',
  showAll: (count) => `Show All (${count.toLocaleString('en-US')})`,
  showLess: 'Show Less',
  rename: 'Rename',
  mergeInto: 'Merge Into',
  noOtherTags: 'No Other Tags',
  deleteTag: 'Delete Tag…',
  deleteConfirm: (name) => `Delete the tag “${name}”?`,
  deleteDetail: 'The tag is removed from every item; the photos and videos themselves are not affected. Tags synced from Eagle come back on the next sync unless you change them in Eagle.',
  deleteButton: 'Delete',
  tags: 'Tags',
  addPlaceholder: 'Add a tag…',
  addHint: (key) => `Add a tag (${key})`,
  remove: (name) => `Remove tag “${name}”`,
  partial: 'Only some selected items have this tag. Click to apply it to all.',
  createTag: (name) => `Create tag “${name}”`,
  filterLabel: 'Tags',
  filterPlaceholder: 'Find a tag…',
  filterNone: 'No tags yet',
  matchTag: 'Tag',
  matchNote: 'Note',
  emptyTitle: 'Nothing has this tag',
  emptyHint: 'Tag photos and videos in the inspector. Press T to add one quickly.',
  eagle: 'Eagle',
  eagleNote: 'Note',
  eagleUrl: 'Source',
  eagleStar: 'Rating',
  eagleFolders: 'Folders',
  addEagleLibrary: 'Add Eagle Library…',
  eagleDialogTitle: 'Choose an Eagle library (.library folder)',
  notEagleTitle: 'This is not an Eagle library',
  notEagleDetail: 'Choose a folder ending in .library that contains metadata.json and an images folder.',
  eagleLibraryHint: 'Read-only: Vixel reads Eagle’s tags, folders and notes and never changes anything in the library.',
  eagleSuffix: ' (Eagle)',
}

export default { zh, en }
