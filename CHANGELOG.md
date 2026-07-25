# Changelog

## Unreleased

### Added

- 修复 Issue #19 独立视觉验收发现的产品问题：移除普通用户界面的内部标识和工程术语，统一以「待确认 / 尚未测量 / 尚未识别」表达未确认信息；真实底层状态、选择、历史、导出与失败关闭链路不变。
- 恢复 Tailwind spacing utilities 的正常层叠，并将 01、03、04、05 的 1440 × 960 live Penpot 卡片、网格、画布和边距写入 production DOM geometry gate；2D SVG 现在自适应居中，消除右侧黑色裁切和联动页下方无意义空白。
- 3D 完成页现在只在可见空间预览真正准备好后显示完成态；生产测试同时约束客户可见文案、选择、真实像素、开洞、异步更新和过期导出拒绝。

- 完成 Issue #19 的 Penpot 产品化闭环：直接通过已配置的 Streamable HTTP Penpot MCP 回读当前 live file/page 与 6 个 1440 × 960 Board，并将 232px 侧栏、72px 顶栏、Inter 字体层级、颜色、圆角、工作区与 unknown 语义固化为前端产品设计合同和 production layout gate。
- 导入页现在在真实浏览器上传后保持在用户可理解的「导入真实户型图」两栏确认界面；主 CTA 才会调用 `/api/floorplans/parse` 并进入 AI 识别状态，避免选择文件即跳到工程流程页。
- 校正、生成 3D、联动和保存页面改为对应 Penpot 的产品工作区；保留真实 canonical、R3F/Rust-WASM、双向选择、Undo/Redo、保存/reload 和 stale-export fail-closed 链路，同时不在普通界面暴露原始 ID、WASM/端口/时序或 JSON 诊断信息。
- 为 Vite 8 开发模式补齐 React Refresh 浏览器 preamble；独立 5173 HMR 服务器可在不替换 18088 production preview 的情况下真实热更新 CSS 产品变更。

### Verification

- 新增 `productDesign` Vitest 合同和 production Playwright shell geometry gate（232px/72px）；固定 1440 × 960 screenshot、像素与交互门禁继续覆盖 01/03/04/05。

- 完成 Issue #17 的受控 Vision 合同闭环：生产 Go multipart parse API 以 OpenAI-compatible `/chat/completions` 多模态请求处理浏览器图片，并对空/非 JSON envelope、schema-invalid opening geometry、timeout、429 与 5xx fail-closed；上游错误正文不会回显给浏览器。
- AI 解析不再把缺少 `wallId`、局部 `position` 或 `width` 的 opening 推断为已确认结构；这些候选直接拒绝，避免最近墙体或预览默认值污染 durable document。
- AI canonical 输出现在要求完整且唯一的 JSON object：拒绝未知字段、重复键、缺失或部分嵌套字段、`null`、错误 JSON 类型、legacy opening 字段及尾随第二个 JSON 值；parse 路径不再生成 ID、kind、source 或空集合。
- 生产浏览器验收通过仅存在于隔离 runner 的 restart control 显式 SIGTERM 并回收 Go server 子进程，再以相同 PostgreSQL/MinIO 状态启动新的 server process；重载断言 source-image 字节、canonical 墙体/门窗（含 wall-local 字段）和 WASM geometry fingerprint 保持一致。

### Verification

- Go fake-server contract tests 覆盖请求路径、Bearer header、model、multimodal data URL、非 JSON/empty/fenced response、429、5xx 和 timeout。真实 Provider smoke 仅允许在运行时凭据存在时本地 opt-in；未执行、不会写入 CI、日志或公开构件。
- 未创建 Release、未部署。

- 完成 Issue #13：将 Rust/wasm-bindgen Marching Cubes 通过可复现 `wasm-pack --target web` 构建、受限 TypeScript adapter 和 R3F `BufferGeometry` 生命周期接入真实浏览器墙体渲染链路。
- 增加 17³ 标量场、有限数值/资源/50ms 主线程预算验证、过期异步结果保护，以及 WASM 失败时互斥的 wall-shell fallback 和可观察运行指标。
- 固定 Rust `1.96.1`、`wasm32-unknown-unknown` 与 `wasm-pack 0.13.1` bootstrap；新增 production Playwright 验收和 Go `.wasm` GET/HEAD MIME 回归，覆盖真实 `.wasm`、有限几何、拖拽/Undo/Redo、PNG 下载与 reload 重建。

## Unreleased

### Added

- 完成 Issue #11 项目持久化：前端支持创建、保存、列表和加载项目；后端提供项目 create/get/list/source-image/update API、稳定嵌套错误 envelope 与 revision conflict 409。
- 项目 UUID 在 API 上传源图前由服务端生成；同一 UUID 显式写入 PostgreSQL，并用于不可变 S3/MinIO `projects/{uuid}/source-image` 对象键。数据库写入失败时会补偿删除已上传对象。
- PostgreSQL 和 S3/MinIO readiness 独立验证并在 `/api/config` 报告真实状态；项目 API 仅在两者均为 `ready` 时开放。

### Verification

- 使用隔离 PostgreSQL + MinIO 完成真实 lifecycle 与 Go 单端口 API E2E：create/get/list/source image/update/stale revision 409、重启加载、无持久化 503，同时确认 health/static 不退化。
- E2E 使用受控 fixture 项目文档；未执行真实 AI 正向解析验收。

### Changed

- 完成 Issue #7 的 3D 墙体白模 v1：由当前可编辑墙段实时生成归一化墙体与基础地面，移除误导性的 room-bounds 实心体块。
- 2D 共享端点拖拽、Undo/Redo 与 3D 白模消费同一个纯几何模型，并公开墙体数、门窗 Marker 数和归一化总长作为可审计联动指标。
- 门窗使用解析结果中的真实坐标和字段生成橙色/蓝色定位 Marker；本版本明确不执行 CSG/布尔开洞，墙高与墙厚仅为 v1 展示常量。
- 墙体白模对非有限坐标、零长度、极小跨度归一化溢出和最终非有限几何保持失败关闭；单个无效 Marker 不拖垮有效墙体。
- 浏览器不提供 WebGL 时显示明确降级提示，同时保留 2D 编辑和几何指标，不再呈现空黑视口。
- 验收证据分层保存：真实懒猫浏览器证明同源路由、fixture 几何指标和 WebGL 降级；本地 WebGL 2.0 Chromium 证明四面墙体、地面及两个 Marker 的实际渲染。fixture 不等同真实 AI 正向解析。
- 完成 Issue #5 的 2D 墙体校正交互：2D SVG 与 3D room-bounds 预览改为独立分区，避免覆盖和事件争抢。
- 高分辨率图纸下，墙体、端点及透明命中层按 CSS 像素自适应，支持墙体选择、高亮、底图显隐、端点拖拽和 Undo/Redo。
- 加强解析响应运行时校验与请求竞态保护，旧文件请求不会覆盖新文件状态；门窗标签仅显示真实字段。
- 升级 Vitest 至 4.1.10，与 Vite 8 共用单一工具链。
- Go 服务改为在唯一的 `0.0.0.0:18088` 入口同时提供 `/api/*` 和 `frontend/dist`，支持前端 SPA fallback，并对未知 API 与缺失静态资源保持 404。
- 服务启动时校验 `frontend/dist/index.html`，避免后端存活但前端构建缺失的半可用状态。
- 在真实懒猫浏览器中验证同源 `/api/health`、AI 缺配置的 503 失败关闭，以及 fixture 下的墙体选择、共享端点拖拽、Undo/Redo、底图显隐和 2D/3D 分区；真实 AI 正向解析仍待提供运行时 AI 配置后验收。
- 完成 Issue #9：增加 2D SVG 与当前 R3F WebGL 画布的 PNG 导出入口，包含导出尺寸/序列化/空白检测/Canvas WebGL 不可用等失败闭环，支持一键单次下载；3D 导出采用 R3F 渲染器即时渲染后抓帧并避免重复申请 WebGL 上下文。
