# Issue #19 Penpot design–implementation parity

Authoritative source: File `7622c4ac-2f6b-802b-8008-5f15321d47e8`, Page `7622c4ac-2f6b-802b-8008-5f15321d47e9`, version **HomeVox · 主流程 · 自动判断与裁切 · 草稿 04 · 视觉验收** (July 25, 2026). Its eight live 1440 × 960 boards are the source of truth; the deprecated file `7622c4ac-2f6b-802b-8008-5dd03ffef589` was not used.

Shared live facts: a 232px `#182033` rail; a 72px white top bar; Inter typography (20/700 title, 12/400 subtitle, 14/600 actions); `#f4f6fa` app background; 16px cards; 10px controls; violet `#5b5ce2`; success `#1f9d70`; and amber `#d98b21` for values that still need confirmation. `productDesign.ts`, `productPresentation.ts`, and the production browser geometry assertions are regression contracts.

| Live Penpot board | Penpot fact | Current implementation / deliberate difference | Acceptance |
| --- | --- | --- | --- |
| 01 导入真实户型图 | Board `d862747a-c9b2-80e7-8008-5f1b098c88cd`: x=268/996 cards (700/396), y=112, h=780; source image x=318 y=188 600×560; one primary and one reselect control. | Exact card/image geometry is browser-gated. Selecting a file starts candidate analysis after original dimensions are available. | Fixed 1440×960 DOM boxes, no overflow, one reselect entry, real browser upload. |
| 02 自动判断图纸 | Board `2c96291e-0756-80ac-8008-61bf3d242ff8`: real source-pixel candidates and an explicit recommended selection. | `single` has exactly one candidate and auto-continues; `composite` has at least two non-duplicate candidates; `uncertain` has none. Transport/schema/content failure falls back to full-image manual crop. | Production verifies single auto-crop, full-image failure fallback, replacement-file request cancellation, and stale-result rejection. |
| 03 选择并裁切户型 | Board `2c96291e-0756-80ac-8008-61bf3d32d436`: original image, mask, crop frame, eight handles, candidates, reset controls and recovery copy. | Crop geometry remains in original pixels; the browser sends only the confirmed effective crop to parse. | Production verifies composite candidate 2 selection, keyboard adjustment, parse failure retention, and retry. |
| 04 AI 识别中 | Recognition is a distinct, honest in-progress state. | Parse only receives the effective source; its returned metadata dimensions must exactly match the effective image pixels. | Failure cannot unlock editing; re-crop invalidates older canonical 2D/3D state before retry. |
| 05 校正可编辑 2D | Board `d862747a-c9b2-80e7-8008-5f1b09a9f669`: x=256 y=92 870×800 editor, x=1146 246×800 inspector. | The exact effective crop is the source image beneath canonical coordinates. | Selection, drag, opening edit, undo/redo, invalid-geometry close and export remain production-tested. |
| 06 生成可编辑 3D | Board `d862747a-c9b2-80e7-8008-5f1b09ae9891`: x=268/1108 cards (812/284), y=112, h=780. | Completion is shown only after the real visible canvas is current. | Production verifies visible wall/floor/opening pixels and renderer admission. |
| 07 2D / 3D 联动编辑 | Board `d862747a-c9b2-80e7-8008-5f1b09b35e19`: x=256 y=92 1136×800 shell. | A third inspector column keeps real edit/export controls reachable. | Production checks linked selection/edit/undo/redo and stale-export rejection. |
| 08 保存为 HomeVox 项目 | Board `d862747a-c9b2-80e7-8008-5f1b09b852b0`: completion hierarchy and save/continue state. | Create/update/list/reload persist the canonical document and matching effective source only. | Production saves, restarts the Go process and reloads the same canonical geometry. |

## Diagnostic and unknown-content policy

Internal identities and rendering telemetry are absent from the ordinary DOM and accessibility tree. Actual invalid-geometry and unavailable-3D states remain fail-closed with actionable customer messages. Values that have not been measured or recognized are presented as **待确认**, **尚未测量**, or **尚未识别**; no value is invented.

## Exact-head evidence command

Run `npm --prefix frontend run test:e2e` on the PR exact head. The production Playwright suite performs controlled upload → candidate analysis → browser crop → OpenAI-compatible parse → canonical 2D → visible 3D → linked edit/Undo/Redo → effective-source project save → exact-PID restart → reload. It also covers composite/manual crop, analysis failure fallback, replacement request cancellation, parse failure retention, metadata/image dimension equality, invalid canonical identity, unavailable WASM, and stale-export rejection.
# Source-image persistence boundary

The original selected image is transient UI state used only to re-crop or retry
candidate selection. Once a crop is confirmed (including automatic single
candidate selection), the cropped **effective source** is the only image sent
to parse, shown beneath canonical 2D coordinates, and uploaded when creating a
project. Its filename, content type, and byte size must match the durable parse
document. The original image is never substituted into this persistence
contract.
