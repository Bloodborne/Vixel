# Eagle 资源库格式与 Vixel 的只读接入

2026-10-11。格式**不是猜的**：读 Eagle 4.0.0 安装包解出的源码（`app.asar` → `app/js/background.js`、`app/js/api-server.js`），
再按这个格式造了一个测试库（演示库里的 8 个素材），用 Eagle 4.0 打开，Eagle 的本地 API（`http://localhost:41595`）
返回的条目字段和我们写进去的一致，证明 Eagle 认这个格式。

## 目录结构

```
<名字>.library/                    普通文件夹（不是 macOS 包，访达里能直接打开；Eagle 没注册 LSTypeIsPackage）
  metadata.json                    资源库级：文件夹树、智能文件夹、快速访问、标签群组
  mtime.json                       { <条目 id>: lastModified } —— Eagle 自己的增量缓存
  tags.json                        { historyTags: [], starredTags: [] } —— 最近 / 星标标签（UI 用）
  saved-filters.json, Icon, backup/   Eagle 打开库时自己写的
  images/
    <ID>.info/                     ID：13 位（新版 guid = Date.now().toString(36) + 5 位随机，大写）或 36 位（旧版 uuid）；
                                   其他长度的目录 Eagle 也会跳过（background.js: folderId.length === 36 || 13）
      metadata.json                条目元数据（见下）
      <name>.<ext>                 原文件，文件名 = 条目 name + ext（Eagle 导入时按 name 改名）
      <name>_thumbnail.png         Eagle 的缩略图；小图（宽高和体积都很小）不生成
```

## 资源库 `metadata.json`

```json
{
  "applicationVersion": "4.0.0",
  "folders": [
    { "id": "MV3JM9KHM1S5U", "name": "自然素材", "description": "", "children": [
        { "id": "MV3JMAC9HRJ4U", "name": "花卉", "children": [], "modificationTime": 0, "tags": [], "iconColor": "green" }
      ], "modificationTime": 0, "tags": [], "password": "", "passwordTips": "" }
  ],
  "smartFolders": [], "quickAccess": [],
  "tagsGroups": [{ "id": "…", "name": "颜色", "tags": ["pink", "blue"], "color": "red" }],
  "modificationTime": 0
}
```

文件夹是树（`children` 递归），条目通过文件夹 **id** 归属；文件夹本身不是磁盘上的目录。

## 条目 `images/<ID>.info/metadata.json`

导入时写（`background.js` 的 processImage）：

| 字段 | 说明 |
|---|---|
| `id` | 同目录名去掉 `.info` |
| `name`, `ext` | 原文件是 `<name>.<ext>` |
| `size`, `btime`, `mtime` | 原文件大小、创建 / 修改时间（ms） |
| `tags` | 字符串数组 |
| `folders` | 所属文件夹 id 数组（可多个） |
| `annotation` | 注释（用户写的说明） |
| `url` | 来源网址（浏览器扩展收藏的图） |
| `star` | 1–5，未评星时没有这个字段 |
| `isDeleted` | 在 Eagle 回收站里（文件还在磁盘上） |
| `modificationTime`, `lastModified` | 元数据修改时间 |
| `width`, `height`, `duration` | 由缩略图生成器补上；duration 单位秒 |
| `palettes` | 颜色分析结果 |

## Vixel 怎么接

**只读，绝不往 `.library` 里写任何文件。**（`npm run test:db` 里有断言：同步后库目录里的文件不变。）

- **识别**：目录里有 `metadata.json`（含 `folders` 数组）和 `images/` 就是 Eagle 资源库（`core/eagle.ts` 的 `isEagleLibrary`）。
  设置 › 文件夹的“添加 Eagle 资源库…”、文件菜单都会校验；普通“添加文件夹”选中 `.library` 也一样能认出来。
- **索引**：watcher 只监视 `images/` 和顶层 `metadata.json`，跳过 `_thumbnail.png`；
  每个媒体文件先看所在条目的 `metadata.json`：只索引原文件（文件名 = `name.ext`），在 Eagle 回收站里的不索引。
  侧栏显示为“名字（Eagle）”；结果里的文件名就是 Eagle 里的名字（原文件本来就叫这个）。
- **同步**（`EagleSync`，按库防抖 1.5 s；资源库或任一条目的 `metadata.json` 变化、启动时都会触发）：
  条目镜像进 `eagle_items` 表（名字、注释、链接、星级、标签、文件夹路径、回收站状态）。
  - **标签** → Vixel 标签（`source = 'eagle'`）。
  - **文件夹** → 也作为标签，名字用**完整路径**（“自然素材/花卉”）。考虑过建智能相册（每个文件夹一个），放弃了：
    Eagle 用户常有几十上百个文件夹，侧栏会被淹没；而标签能搜、能筛、能组合，侧栏也只列最常用的 15 个。
    用路径而不是只用名字，是为了不同父文件夹下的同名子文件夹（“2024/旅行”“2025/旅行”）不被合并。
  - **注释** → 检查器的 Eagle 区块显示，并作为搜索的“注释”通道（子串匹配，结果卡片角标“注释”）。
    没有写进 Vixel 自己的“描述”：描述是用户在 Vixel 里写的，混进去就分不清来源、也没法在移除资源库时干净撤回。
  - **来源链接、星级、所在文件夹** → 检查器 Eagle 区块（链接只在用户点击时用系统浏览器打开；界面本身仍然不联网）。
    星级暂时只展示，不映射成收藏（收藏是"喜欢"，星级常被设计师当"质量等级"用，语义不同）。
  - **回收站**：条目移进 / 移出 Eagle 回收站时，从 Vixel 的索引里移除 / 加回。
- **可撤销**：同步来的标签关联记着来源库（`item_tags.origin = 资源库的文件夹 id`），
  移除资源库时整批撤掉，用户自己在 Vixel 里打的标签不受影响。
  在 Vixel 里删掉一个 Eagle 同步来的标签，下次同步会按 Eagle 里的状态恢复 —— 要永久去掉得在 Eagle 里改。
- **格式支持**：只镜像 Vixel 能索引的格式（图片 / RAW / 视频 / 音频）；PSD、AI、字体、3D 等 Eagle 条目跳过。

## 已知限制

- 星级、颜色分析（`palettes`）、智能文件夹、标签群组都没有接。
- 文件夹改名后，旧路径的标签在下一次同步时被新路径替换（没有就地改名）。
- 视频条目的标签要等 Vixel 抽完首帧（代表帧有了内容 hash）才挂上，期间视频能搜到但标签暂时缺。
