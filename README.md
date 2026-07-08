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

🚧 产品方案设计中 → 即将启动 Phase 0 技术验证

## 许可

本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)**。

- ✅ 自由使用、修改、分发
- ✅ 个人项目、学习研究、商业使用
- ⚠️ **网络服务提供者必须公开修改后的源代码**
- 💡 如需闭源商用授权，请联系作者

## 作者

王.W ([@KingBoyAndGirl](https://github.com/KingBoyAndGirl))

维护者：产研团队（`hermes` / `codex` / `claude`，邮箱 `wangw9475@agent.qq.com`）
