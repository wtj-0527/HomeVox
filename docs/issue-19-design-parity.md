# Issue #19 design–implementation parity

Frozen-design evidence: Issue #19 comment `5068143912`; production evidence uses a fixed 1440 × 960 viewport. The controlled fixture exists only for automated evidence and does not store a user floorplan.

| State | Layout and visual parity | Product semantics | Exact-head evidence / justified difference |
| --- | --- | --- | --- |
| 导入 / AI 识别 | Indigo left step rail, white top bar, single centered upload/recognition card, violet primary CTA and muted state card. | Step 1 accepts an image; Step 2 alone starts parsing, shows loading/error/retry, and does not reveal editor tools. | `issue-19-import-ai.png`, copied from the production browser run to the non-Git `artifact_path` emitted by the runner. Native file input is retained for keyboard and screen-reader support. |
| 校正 2D | Main 2D canvas card with a separate light inspector card; selected wall is amber, endpoints/openings retain high-contrast semantic colors. | Only the API-returned canonical document unlocks this page. The run selects stable `wall-1`, then preserves the parsed geometry through project creation. | `issue-19-2d-correction.png`, fixed at 1440 × 960. No “补画墙体” or object-confirmation claim is shown because no verified canonical contract exists. |
| 3D 确认 | Dedicated dark real R3F/WASM preview, compact confirmation header, violet confirm CTA and neutral return CTA. | This page is distinct from the linked workspace. “返回 2D 校正” changes no data; “完成并打开 3D” enters the linked workspace. | `issue-19-3d-confirm.png`, fixed at 1440 × 960. Height and unverified building attributes remain explicitly described as illustrative/unknown. |
| 2D / 3D 联动 | Equal dark/light workspace panels plus inspector; responsive layout stacks below 1024px while preserving reading and focus order. | 2D and 3D use the same persisted canonical document and stable `wallId`; the run selects the 3D `window-1` marker and verifies owner `wall-2`, then restarts and reloads the project before selecting `wall-2` in 2D. | `issue-19-linked-workspace.png`, fixed at 1440 × 960. The runner verifies all four PNGs exist and have distinct hashes before emitting their artifact directory. On smaller screens stacking is an intentional accessibility difference. |

## Diagnostic and unknown-content policy

Raw canonical JSON and engineering telemetry (WASM, grid dimensions, triangle counts, timings and fallback labels) are absent from the ordinary DOM and accessibility tree. Actual invalid-geometry and unavailable-3D states remain fail-closed, actionable user messages. Unknown door/window dimensions are described as non-persistent previews rather than invented building facts.

## Exact-head evidence command

Run `npm --prefix frontend run test:e2e` on the PR exact head. The production Playwright suite performs controlled upload → OpenAI-compatible parse → canonical 2D selection → standalone 3D confirmation → linked selection → manual project save → exact-PID restart → project reload. It captures the four named 1440 × 960 PNG artifacts, copies them outside Git into a unique run-artifact directory, emits `exact_head` and `artifact_path`, verifies all four images are present and distinct, and covers invalid and duplicate canonical identity fail-closed behavior.
