/** 标签：侧栏、检查器、筛选栏、右键菜单、结果角标 */
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
  deleteDetail: '标签会从所有内容上移除，照片和视频本身不受影响。',
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
  // 标签视图
  emptyTitle: '这个标签下没有内容',
  emptyHint: '在检查器里给照片和视频打标签，按 T 快速添加。',
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
  deleteDetail: 'The tag is removed from every item; the photos and videos themselves are not affected.',
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
  emptyTitle: 'Nothing has this tag',
  emptyHint: 'Tag photos and videos in the inspector. Press T to add one quickly.',
}

export default { zh, en }
