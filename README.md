# 筑居（HomeVox）

> AI 驱动的体素级 3D 家居设计平台 —— 从买房到入住，用体素自由设计你的家。

## 核心理念

户型图 → AI 解析 2D 结构 → AI 生成 3D 白模 → 体素编辑器自定义 → 人工精调 → 导出效果图 + 施工资料

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | React + TypeScript + React Three Fiber |
| 体素/几何核心 | Rust + WASM |
| 后端 API | Go |
| 数据库 | PostgreSQL |
| 存储 | S3 / MinIO |
| AI | Go 直接请求 OpenAI-compatible API |

## 技术决策

HomeVox 采用混合技术路线：**Go 管业务 API，Rust 管体素/几何核心**。

- Go 后端负责用户、项目、PostgreSQL、S3/MinIO、AI 多轮对话、导出任务与 WebSocket
- Rust + WASM 负责体素编辑、Marching Cubes、网格生成、碰撞/吸附等几何计算
- 前端使用 React + R3F，调用 WASM 几何模块并完成高质量 3D 渲染

## 开发状态

🚧 Phase 1 MVP 核心管线开发中

- ✅ Go 单进程固定监听 `0.0.0.0:18088`，同源提供 `/api/*` 与 `frontend/dist`，并支持 SPA fallback
- ✅ 户型图上传与 OpenAI-compatible AI 解析接口已落地；正向解析运行需要配置 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`
- ✅ 2D 户型校正编辑器支持墙体选择、共享端点拖拽、Undo/Redo 与底图显隐
- ✅ Issue #13：生产前端构建会从 `wasm/` 源码执行 `wasm-pack build --target web`，由受控 17³（4,913 voxel）标量场调用 Rust Marching Cubes，并在 R3F 中显示有限 position/normal 的真实 WASM 网格。
- ✅ 门窗以真实坐标生成橙色/蓝色定位 marker；当前尚未进行布尔开洞，墙高与墙厚为 v1 展示常量而非建筑实测尺寸
- ✅ WebGL 不可用时显示明确降级提示，不再留下空黑 3D 视口
- ✅ Issue #9：为当前可用 2D/3D 视图提供一次点击一次下载的 PNG 导出，支持空白/尺寸/序列化等失败闭环；3D 导出通过 R3F 渲染器即时渲染后抓取并规避对象 URL 过早回收
- ✅ Rust/WASM 几何核心已加入 Marching Cubes 功能验证
- ✅ Issue #11：项目可持久化保存、列表加载与修订保存已接入单端口 API。服务端在上传前分配 UUID，并以同一 UUID 写入 PostgreSQL 与 `projects/{uuid}/source-image` S3/MinIO 对象键；数据库写入失败会删除该对象。
- ✅ 项目 API 仅在 PostgreSQL schema/ping 与 S3 bucket 均验证就绪时可用；`/api/config` 分别报告 `not_configured`、`incomplete_config`、`unavailable` 或 `ready` 状态。
- ✅ 已用隔离 PostgreSQL + MinIO 验证 create/get/list/source-image/update/stale-revision-409、重启后加载及未配置持久化时 project API 的 503；该验收使用 fixture 文档，不包含真实 AI 正向解析。
- 3D 视口公开引擎状态、grid、三角形/顶点、调用耗时与输入/输出字节；单次主线程 WASM 调用预算为 50ms。加载、输入、输出或预算失败时明确回退到既有 wall-shell，2D 编辑、项目加载和 PNG 导出仍可用。

## 可复现 WASM 与浏览器验收

`rust-toolchain.toml` 固定 Rust `1.96.1` 和 `wasm32-unknown-unknown`，`scripts/bootstrap-wasm.sh` 固定 `wasm-pack 0.13.1`。`rustup` 是 clean checkout 的明确前置条件（bootstrap 会调用它来安装固定 toolchain/target）；先安装 Rustup 后验证 `rustup --version`，再运行：

```bash
rustup --version
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend test
npm --prefix frontend run test:e2e
```

若 `rustup` 未找到，请先按 Rust 官方安装器安装并重新打开 shell；若 target 缺失，重新执行 `scripts/bootstrap-wasm.sh`。浏览器验收会启动隔离 PostgreSQL + MinIO，同网络内以 production Go server 保存并重新加载 fixture 项目。

构建会生成忽略的 `wasm/pkg/` bindings 与 `frontend/dist/`；不要提交它们。生产浏览器验收由 Go 在 `0.0.0.0:18088` 提供 production assets，加载实际 `.wasm`（`application/wasm`），并使用受控 17³ fixture 验证 Rust 调用、有限几何、拖拽/Undo/Redo、3D PNG 下载及 reload 后重建。Playwright 首次使用前执行 `npm --prefix frontend exec playwright install chromium`。

## 许可

本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)**。

- ✅ 自由使用、修改、分发
- ✅ 个人项目、学习研究、商业使用
- ⚠️ **网络服务提供者必须公开修改后的源代码**
- 💡 如需闭源商用授权，请联系作者

## 作者

王.W ([@wtj-0527](https://github.com/wtj-0527))

维护者：产研团队（`hermes` / `codex` / `claude`，邮箱 `wangw9475@agent.qq.com`）
