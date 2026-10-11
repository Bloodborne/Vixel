const zh = {
  // 窗口标签
  tabGeneral: '通用',
  tabFolders: '文件夹',
  tabModel: 'AI 模型',
  // 通用 › 外观
  appearance: '外观',
  themeSystem: '跟随系统',
  themeLight: '浅色',
  themeDark: '深色',
  appearanceNote: '大图详情和快速查看始终使用深色背景，便于看片。',
  // 通用 › 语言
  language: '语言',
  languageSystem: '跟随系统',
  languageNote: '切换后窗口会重新载入。搜索不受界面语言影响，中文、英文等都能搜。',
  // 文件夹
  noFolders: '还没有添加文件夹',
  noFoldersHint: '添加文件夹后自动扫描并索引，原文件不会被移动或修改',
  addFolder: '添加文件夹',
  removeFolderTitle: '确认移除文件夹',
  /** 名称两侧要加引号，由组件加粗显示，所以拆成前后两段 */
  removeFolderAskBefore: '确定要移除 ',
  removeFolderAskAfter: ' 吗？',
  removeFolderCountBefore: '该文件夹包含 ',
  removeFolderCountAfter: ' 项已索引的内容，将从搜索库中移除。',
  removeFolderNote: '此操作只会从 Vixel 中移除索引，不会删除原始文件。',
  removing: '移除中...',
  confirmRemove: '确认移除',
}

const en: typeof zh = {
  tabGeneral: 'General',
  tabFolders: 'Folders',
  tabModel: 'AI Model',
  appearance: 'Appearance',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  appearanceNote: 'Photo detail and Quick Look always use a dark background.',
  language: 'Language',
  languageSystem: 'System',
  languageNote: 'Vixel reloads after switching. Search works in any language regardless of this setting.',
  noFolders: 'No folders yet',
  noFoldersHint: 'Added folders are scanned and indexed automatically. Original files are never moved or changed.',
  addFolder: 'Add Folder',
  removeFolderTitle: 'Remove Folder?',
  removeFolderAskBefore: 'Remove ',
  removeFolderAskAfter: '?',
  removeFolderCountBefore: 'Its ',
  removeFolderCountAfter: ' indexed items will be removed from search.',
  removeFolderNote: 'Only the index is removed from Vixel. Original files are not deleted.',
  removing: 'Removing…',
  confirmRemove: 'Remove',
}

export default { zh, en }
