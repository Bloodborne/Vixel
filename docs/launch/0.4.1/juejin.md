# 掘金（v0.4.1 · 技术长文）

- **时间**：工作日上午发（D2 或 D3）
- **物料**：架构图（README 里的 ASCII 图重画）、`shots-zh/` 截图、代码片段
- **分类**：人工智能 / Electron

## 标题（选一）

1. 在 Electron 里跑 Google 的 EmbeddingGemma 2：一个完全离线的多模态搜索是怎么搭起来的
2. sqlite-vec + LiteRT + koffi：桌面端离线多模态检索实战（附公开评测集）
3. 四路召回、RRF 融合、自适应门槛：本地素材搜索的排序实践

## 文章大纲 + 关键素材

> 全文基调：工程复盘，不是产品软文。每个数字都可复现（`npm run eval`）。

### 1. 需求与约束

完全离线（模型随包）、原文件只读、一台普通笔记本跑得动。由此推出所有技术选择。

### 2. 推理：EmbeddingGemma 2 on LiteRT-LM，经 koffi 进 Electron

- 为什么放弃 transformers.js / ONNX CPU：同一批图的检索质量 mAP 0.844 → 0.974（见仓库
  docs/review/06-litert-vs-onnx.md），GPU（Metal / D3D12-WebGPU）让全量索引变得可接受
- koffi 直接绑 LiteRT-LM 的 C API，不用写 native addon；推理放在 `utilityProcess`（nice 10），
  主进程零阻塞；看门狗处理推理卡死
- 踩坑：窗口被遮挡时 Chromium 停止绘制、GPU 进程与推理进程抢上下文……

### 3. 存储与向量检索：sqlite-vec

- 一个 library.db 装下一切：照片、`vec0` 向量表（图片 768d / 媒体段 768d / 人脸 512d）、
  FTS5 全文、任务队列；WAL + 部分索引（首页查询 25 ms → 0.3 ms / 5 万行）
- 视频按 32 秒分段，每段 = 每 4 秒一帧 + 音轨，一段一向量；搜到即跳段

### 4. 排序：四路 RRF + 自适应相关性门槛

- 召回：图片向量、媒体段向量、OCR BM25、文件名（+ 标签）
- RRF 加权融合；**自适应 z-score 门槛**：对每次查询估计库内基线，过不了门槛就如实说
  「没有特别突出的匹配」——宁可空手，不硬凑
- 0.4.1 的排序迭代（都有评测集背书）：整词精确命中优先（"STARBUCKS" 赢过"长得像"）；
  同视频多段相近时取更早的段；kind-word 查询（"火车的视频"）先剥词再做软加权；
  lookup 型查询（"IMG_2682"）让文本通道加倍
- 弱匹配折叠线 0.45×top：用评测集验证没有任何标注正确答案被折进去（DigUp 用 0.5，
  在我们的集合上会折掉一个真答案——这就是为什么要有自己的评测）

### 5. 评测驱动：evals/ 与 `npm run eval`

- 两个标注集（demo 43 条 / footage 39 条：image / video / ocr / filename / multilingual /
  kind / lookup / negative）
- 基线对比：demo top-1 0.88 → 1.00、MRR 0.94 → 1.00、mAP 0.93 → 1.00；
  footage top-1 0.84 → 0.94、MRR 0.88 → 0.95、mAP 0.85 → 0.92；负例 5/5 与 4/5
- 已知 bad case 也写在输出里（"狗跨栏"的 1899 年黑白片、"马拉着篷车"排第 4）——
  公开失败案例比吹准确率有用
- 刻意不测耗时：速度数字不对外发布

### 6. 中文检索：jieba 与一个羞耻的 bug

@node-rs/jieba 2.x 升级后旧 `cut` 导出没了，分词**静默退化**成原文匹配——"列车"在
"等一列车不抢一扇门"中间就搜不到了。修复 + 首启自动重建 FTS 索引（无需重新 OCR）。
教训：silent fallback 是检索系统最危险的失败模式，必须让评测集覆盖到分词路径。

### 7. 杂项工程

- OCR：PaddleOCR v5（det/cls/rec），v1 字典配 v5 模型 + 双重 softmax 的教训
- 人脸：SCRFD + MobileFaceNet + 质量门控聚类（LFW 校准）
- 离线承诺的实现：渲染进程请求整体拦截、离线底图打包、扩展服务只听 127.0.0.1 + 配对令牌
- 跨平台的脏活：CF_HDROP 剪贴板、NSPanel 不抢焦点、IME 组合键放行（0.4.1 三个 bug 修复
  都值得单独一段）

### 8. 收尾

仓库地址 + evals 复现方式 + 欢迎 bad case。
https://github.com/RGB-loop/Vixel （v0.4.1：https://github.com/RGB-loop/Vixel/releases/tag/v0.4.1）

## 标签

Electron · AI · SQLite · 全文检索 · 开源

## 评论回复预案

- 「为什么不用 CLIP / SigLIP」——用过 SigLIP 2（0.1.x），EmbeddingGemma 2 一个模型覆盖
  文字/图/视频/音频同空间，检索质量在我们的集上更好，也省掉双模型。
- 「为什么不用 faiss / 向量数据库」——单机单库，sqlite-vec 够用且零运维，和 FTS5 同一个文件。
- 「koffi 稳吗」——比写 addon 省心；配合 utilityProcess 隔离崩溃 + 看门狗，生产可用。
- 「能不能出技术细节 X」——docs/review/ 里有六篇复盘，缺的开 issue 我补。
