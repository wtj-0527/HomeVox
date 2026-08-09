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
- ✅ 自动判断与裁切：新文件会先请求候选区域；单一候选自动生成裁切后的 effective source 并解析，复合/不确定候选进入可调整裁切。分析的传输、schema 或内容失败会安全回到全图手动裁切；裁切后解析失败会保留原图、候选和裁切框以便重试。
- ✅ 持久化边界：只保存已确认并实际解析的 effective source；原图仅保留在当前浏览器会话中用于重新裁切，不会上传为项目 source image。
- ✅ 2D 户型校正编辑器支持墙体选择、共享端点拖拽、起点/终点 source-pixel 数值输入、Undo/Redo 与底图显隐；越出 effective source、退化或破坏门窗开口的编辑不会提交。
- ✅ Issue #13：生产前端构建会从 `wasm/` 源码执行 `wasm-pack build --target web`，由受控 17³（4,913 voxel）标量场调用 Rust Marching Cubes，并在 R3F 中显示有限 position/normal 的真实 WASM 网格。
- ✅ Issue #17：浏览器上传链路的 AI 结果现在经受控 OpenAI-compatible Vision HTTP 合同和严格 canonical schema validation；未知字段、重复键、缺失/部分字段、null、错误类型和尾随 JSON 都会失败关闭，且不会补齐 AI 输出中的 ID、kind、source 或集合。
- ✅ 门窗 opening 由 wall-local `wallId`、`position`、`width` 与 `confirmed` 驱动真实 2D/3D 开洞；未确认的门高、窗高和窗台高仅为非持久化预览，绝不表述为建筑实测参数。
- ✅ WebGL 不可用时显示明确降级提示，不再留下空黑 3D 视口
- ✅ Issue #9：为当前可用 2D/3D 视图提供一次点击一次下载的 PNG 导出，支持空白/尺寸/序列化等失败闭环；3D 导出通过 R3F 渲染器即时渲染后抓取并规避对象 URL 过早回收
- ✅ Rust/WASM 几何核心已加入 Marching Cubes 功能验证
- ✅ Issue #11：项目可持久化保存与修订保存已接入单端口 API。服务端在上传前分配 UUID，并以同一 UUID 写入 PostgreSQL 与 `projects/{uuid}/source-image` S3/MinIO 对象键；数据库写入失败会删除该对象。未建立用户身份体系前，全局项目列表关闭，避免枚举其他项目。
- ✅ AI 识别完成后可在 2D 阶段立即创建服务器端识别快照，后续显式“保存当前修改”沿用 revision conflict 保护且不会再次调用 Vision Provider。创建项目会生成 256-bit 随机 capability，数据库只存 SHA-256；detail/source/update 必须通过专用 header 携带明文 capability，并统一返回 `Cache-Control: no-store`。跨浏览器继续编辑链接只把 capability 放在 URL fragment，前端在发起项目请求前立即从地址栏清除；source-image URL 必须精确绑定当前项目同源 API。获得该链接的人可访问和修改项目，应按敏感凭据保管。
- ⚠️ 当前 capability 是单实例阶段的持有者读写授权，不等同于用户登录或租户隔离。正式多用户版本仍需 owner-bound identity，以及 capability 的轮换/吊销入口；在此之前不要把继续编辑链接发给不受信任的人。
- ⚠️ capability 上线前创建的旧项目没有可恢复的明文凭据。schema 升级会保留其数据库记录与对象，但以随机不可兑换 digest 明确退役访问，不会把旧 UUID 继续当作凭据；如需继续编辑，须从原始户型图重新创建受保护快照。
- ✅ 项目 API 仅在 PostgreSQL schema/ping 与 S3 bucket 均验证就绪时可用；`/api/config` 分别报告 `not_configured`、`incomplete_config`、`unavailable` 或 `ready` 状态。
- ✅ 已用隔离 PostgreSQL + MinIO 验证 create、capability-gated get/source-image/update、stale-revision-409、独立浏览器恢复、重启后加载及未配置持久化时 project API 的 503；无 capability 的 UUID-only 请求失败关闭，全局 list 不可枚举。
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

若 `rustup` 未找到，请先按 Rust 官方安装器安装并重新打开 shell；若 target 缺失，重新执行 `scripts/bootstrap-wasm.sh`。浏览器验收会启动隔离 PostgreSQL + MinIO，同网络内以 production Go server 保存项目，显式终止该 Go 进程并启动新的进程后再重新加载。

构建会生成忽略的 `wasm/pkg/` bindings 与 `frontend/dist/`；不要提交它们。生产浏览器验收由 Go 在 `0.0.0.0:18088` 提供 production assets，加载实际 `.wasm`（`application/wasm`），并使用受控 17³ fixture 验证 Rust 调用、有限几何、拖拽/Undo/Redo、3D PNG 下载及 reload 后重建。Playwright 首次使用前执行 `npm --prefix frontend exec playwright install chromium`。

## 本地开发与 LazyCat 生产发布

本地开发与 LazyCat 生产发布是两条独立链路。HomeVox 在开发机和生产容器内都固定监听 `0.0.0.0:18088`。

本地开发直接启动 Go 单端口服务，并通过开发机的 18088 端口前缀域名访问；不运行 `lzc-cli project deploy`，也不安装开发 LPK。若要跨浏览器保存识别快照，必须在进程环境或 ignored `backend/.env` 中提供可用的 `DATABASE_URL`、`S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`，并以 `/api/config` 的 `databaseStatus: "ready"`、`s3Status: "ready"` 为准：

```bash
npm --prefix frontend ci
npm --prefix frontend run build
HOMEVOX_FRONTEND_DIR="$PWD/frontend/dist" go -C backend run ./cmd/server
# 浏览器访问开发机的 18088 端口前缀域名
```

仓库中的 `lzc-manifest.yml`、`lzc-build.yml`、`lzc-deploy-params.yml`、`package.yml`、`lzc-icon.png` 与 `images/Dockerfile` 只定义生产 LPK。生产发布使用 `lzc-cli project release -o <仓库外绝对路径>`，LPK 将入口转发至正式的 `homevox:18088` 容器，并包含 PostgreSQL 与 MinIO。任何 `.lpk` 都不得提交到仓库；LPK 的构建、验包、安装和发布需要单独授权。

部署包含 PostgreSQL 与 MinIO 持久服务，数据分别保存在 `/lzcapp/var/postgres` 和 `/lzcapp/var/minio`。数据库和对象存储使用 LazyCat `stable_secret` 生成实例内稳定密码；AI Provider 凭据不写入仓库或安装包，未配置时识别链路保持 fail-closed。

### d53 历史项目恢复密钥

LazyCat 安装或重新配置 HomeVox 时会要求输入 `legacy_recovery_key`（`secret`
部署参数）。运行期将其仅映射为 `HOMEVOX_LEGACY_RECOVERY_KEY`；不要把值写入
仓库、镜像、普通环境文件或日志。该值用于人工核验归属后调用一次性 d53
恢复端点；未配置或不匹配时端点保持 `403` fail-closed。修改该参数需要重新配置
应用实例，不需要也不应重新打包、安装或发布 LPK。

## 许可

本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)**。

- ✅ 自由使用、修改、分发
- ✅ 个人项目、学习研究、商业使用
- ⚠️ **网络服务提供者必须公开修改后的源代码**
- 💡 如需闭源商用授权，请联系作者

## 作者

王.W ([@wtj-0527](https://github.com/wtj-0527))

维护者：产研团队（`hermes` / `codex` / `claude`，邮箱 `wangw9475@agent.qq.com`）
