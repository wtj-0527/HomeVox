import type { PointerEvent, RefObject } from 'react'
import type { EndpointRef, WallSegment } from './floorplanEditor'
import { openingPoint, type ParsedOpening, type Viewport } from './floorplanUi'

export type FloorplanEditorPanelProps = {
  editorRef: RefObject<SVGSVGElement | null>
  viewport: Viewport
  walls: readonly WallSegment[]
  openings: readonly ParsedOpening[]
  showSourceImage: boolean
  previewURL: string
  geometryValidationError: string | null
  selectedWallID: string | null
  selectedWallLabel: string | null
  selectedOpeningID: string | null
  hoveredEndpoint: EndpointRef | null
  draggedEndpoint: EndpointRef | null
  hitRadius: number
  handleRadius: number
  activeHandleRadius: number
  wallHitStroke: number
  wallStroke: number
  activeWallStroke: number
  openingRadius: number
  openingStroke: number
  labelOffset: number
  labelSize: number
  embedded?: boolean
  editingDisabled?: boolean
  onShowSourceImageChange: (show: boolean) => void
  onCanvasPointerMove: (event: PointerEvent<SVGSVGElement>) => void
  onCanvasPointerUp: (event: PointerEvent<SVGSVGElement>) => void
  onCanvasPointerCancel: (event: PointerEvent<SVGSVGElement>) => void
  onEndpointPointerDown: (event: PointerEvent<SVGElement>, endpoint: EndpointRef) => void
  onWallPointerDown: (event: PointerEvent<SVGLineElement>, wallID: string) => void
  onOpeningPointerDown: (event: PointerEvent<SVGCircleElement>, openingID: string) => void
}

/** Canonical 2D editor surface with an adaptive, centered SVG viewport. */
export function FloorplanEditorPanel({
  editorRef, viewport, walls, openings, showSourceImage, previewURL, geometryValidationError,
  selectedWallID, selectedWallLabel, selectedOpeningID, hoveredEndpoint, draggedEndpoint,
  hitRadius, handleRadius, activeHandleRadius, wallHitStroke, wallStroke, activeWallStroke,
  openingRadius, openingStroke, labelOffset, labelSize, embedded = false, editingDisabled = false,
  onShowSourceImageChange, onCanvasPointerMove, onCanvasPointerUp, onCanvasPointerCancel,
  onEndpointPointerDown, onWallPointerDown, onOpeningPointerDown,
}: FloorplanEditorPanelProps) {
  return (
    <section className={`${embedded ? '' : 'workspace-card'} canvas-card min-w-0`} aria-label="2D 墙体编辑器" aria-disabled={editingDisabled}>
      {geometryValidationError && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">这个户型有一处需要调整，请先在平面图中修正后再继续。</p>}
      <div className="floorplan-surface min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-[#fafbfd]">
        <svg ref={editorRef} className={`h-full w-full touch-none ${editingDisabled ? 'pointer-events-none opacity-75' : ''}`} viewBox={`${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`} role="img" aria-label="户型图墙体端点编辑区" onPointerMove={editingDisabled ? undefined : onCanvasPointerMove} onPointerUp={editingDisabled ? undefined : onCanvasPointerUp} onPointerCancel={editingDisabled ? undefined : onCanvasPointerCancel} onPointerLeave={editingDisabled ? undefined : onCanvasPointerCancel} preserveAspectRatio="xMidYMid meet">
          <rect x={viewport.minX} y={viewport.minY} width={viewport.width} height={viewport.height} fill="#fafbfd" />
          {showSourceImage && previewURL && <image href={previewURL} x={viewport.minX} y={viewport.minY} width={viewport.width} height={viewport.height} preserveAspectRatio="xMidYMid meet" opacity="0.42" pointerEvents="none" />}
          <g aria-label="墙体可视层" pointerEvents="none">
            {walls.map((wall, wallIndex) => {
              const endpointActive = hoveredEndpoint?.wallIndex === wallIndex || draggedEndpoint?.wallIndex === wallIndex
              const selected = selectedWallID === wall.id
              const active = endpointActive || selected
              const color = draggedEndpoint?.wallIndex === wallIndex ? '#22d3ee' : selected ? '#7c3aed' : endpointActive ? '#38bdf8' : '#475467'
              return <line key={wall.id ?? `wall-${wallIndex}`} x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2} stroke={color} strokeWidth={active ? activeWallStroke : wallStroke} />
            })}
          </g>
          <g aria-label="墙体透明命中层" fill="none" stroke="transparent" strokeLinecap="round">
            {walls.map((wall, wallIndex) => <line key={`hit-${wall.id ?? wallIndex}`} data-testid={`wall-hit-${wall.id ?? wallIndex}`} data-selected={selectedWallID === wall.id ? 'true' : 'false'} x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2} strokeWidth={wallHitStroke} onPointerDown={(event) => wall.id && onWallPointerDown(event, wall.id)} style={{ cursor: 'pointer' }} />)}
          </g>
          <g aria-label="端点可视层" pointerEvents="none">
            {walls.flatMap((wall, wallIndex) => ([{ endpoint: 'start' as const, x: wall.x1, y: wall.y1 }, { endpoint: 'end' as const, x: wall.x2, y: wall.y2 }].map((handle) => {
              const highlighted = hoveredEndpoint?.wallIndex === wallIndex && hoveredEndpoint.endpoint === handle.endpoint || draggedEndpoint?.wallIndex === wallIndex && draggedEndpoint.endpoint === handle.endpoint
              return <circle key={`visible-${wallIndex}-${handle.endpoint}`} cx={handle.x} cy={handle.y} r={highlighted ? activeHandleRadius : handleRadius} fill={highlighted ? '#f8fafc' : selectedWallID === wall.id ? '#7c3aed' : '#38bdf8'} stroke={highlighted ? '#0f172a' : selectedWallID === wall.id ? '#ddd6fe' : '#7dd3fc'} strokeWidth={openingStroke} />
            })))}
          </g>
          <g aria-label="端点透明命中层" fill="transparent" stroke="transparent">
            {walls.flatMap((wall, wallIndex) => ([{ endpoint: 'start' as const, x: wall.x1, y: wall.y1 }, { endpoint: 'end' as const, x: wall.x2, y: wall.y2 }].map((handle) => <circle key={`hit-${wallIndex}-${handle.endpoint}`} data-testid={`endpoint-handle-${wallIndex}-${handle.endpoint}`} cx={handle.x} cy={handle.y} r={hitRadius} onPointerDown={(event) => onEndpointPointerDown(event, { wallIndex, endpoint: handle.endpoint })} style={{ cursor: 'grab' }} />)))}
          </g>
          {openings.map((opening) => {
            const wall = opening.wallId ? walls.find((item) => item.id === opening.wallId) : undefined
            const point = wall ? openingPoint(wall, opening) : null
            if (!point || !opening.id) return null
            const selected = selectedOpeningID === opening.id
            const color = selected ? '#7c3aed' : opening.kind === 'door' ? '#f97316' : '#38bdf8'
            const label = opening.kind === 'door' ? '门洞' : opening.kind === 'window' ? '窗洞' : null
            return <g key={opening.id} data-testid={`opening-${opening.id}`}><circle data-testid={`opening-handle-${opening.id}`} cx={point.x} cy={point.y} r={selected ? openingRadius * 1.3 : openingRadius} fill={color} fillOpacity={selected ? 0.95 : 0.75} stroke="#f8fafc" strokeWidth={openingStroke} onPointerDown={(event) => onOpeningPointerDown(event, opening.id!)} style={{ cursor: 'grab' }} />{label && <text x={point.x + labelOffset} y={point.y - labelOffset} fill={color} fontSize={labelSize} pointerEvents="none">{label}</text>}</g>
          })}
        </svg>
      </div>
      <div className="floorplan-source-controls">
        <label className="flex cursor-pointer items-center gap-2 text-slate-700"><input type="checkbox" checked={showSourceImage} disabled={editingDisabled} onChange={(event) => onShowSourceImageChange(event.target.checked)} />显示原始图纸</label>
        <span>{editingDisabled ? '请先完成版本冲突处理' : draggedEndpoint ? '正在调整' : selectedWallLabel ? '已选择墙体' : hoveredEndpoint ? '可调整端点' : '选择要调整的位置'}</span>
      </div>
    </section>
  )
}
