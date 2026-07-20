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
- ✅ 3D 墙体白模 v1 由当前可编辑墙段实时生成墙体与基础地面，2D 拖拽、Undo/Redo 会同步更新白模几何指标
- ✅ 门窗以真实坐标生成橙色/蓝色定位 marker；当前尚未进行布尔开洞，墙高与墙厚为 v1 展示常量而非建筑实测尺寸
- ✅ WebGL 不可用时显示明确降级提示，不再留下空黑 3D 视口
- ✅ Issue #9：为当前可用 2D/3D 视图提供一次点击一次下载的 PNG 导出，支持空白/尺寸/序列化等失败闭环；3D 导出通过 R3F 渲染器即时渲染后抓取并规避对象 URL 过早回收
- ✅ Rust/WASM 几何核心已加入 Marching Cubes 功能验证
- ⏳ 下一步：项目保存/加载、Rust/WASM 浏览器业务接入；真实 AI 样本验收暂缓

## 许可

本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)**。

- ✅ 自由使用、修改、分发
- ✅ 个人项目、学习研究、商业使用
- ⚠️ **网络服务提供者必须公开修改后的源代码**
- 💡 如需闭源商用授权，请联系作者

## 作者

王.W ([@wtj-0527](https://github.com/wtj-0527))

维护者：产研团队（`hermes` / `codex` / `claude`，邮箱 `wangw9475@agent.qq.com`）
