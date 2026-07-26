import { useEffect, useState } from 'react'
import type { WallSegment } from './floorplanEditor'
import { MIN_OPENING_WIDTH, type ParsedOpening } from './floorplanUi'
import { PRODUCT_LANGUAGE } from './productPresentation'

export type InspectorPanelProps = {
  selectedWallID: string | null
  selectedWall?: WallSegment | null
  selectedOpening: ParsedOpening | null
  openingError: string
  canExport2D: boolean
  canExport3D: boolean
  exportingScope: '2d' | '3d' | null
  exportError: string
  canUndo: boolean
  canRedo: boolean
  onAddOpening: (kind: 'door' | 'window') => void
  onWallCoordinatesChange?: (coordinates: Pick<WallSegment, 'x1' | 'y1' | 'x2' | 'y2'>) => void
  onOpeningWidthChange: (width: number) => void
  onDeleteOpening: () => void
  onExport2D: () => void
  onExport3D: () => void
  onUndo: () => void
  onRedo: () => void
}

function WallCoordinateEditor({ wall, onApply }: {
  wall: WallSegment
  onApply: (coordinates: Pick<WallSegment, 'x1' | 'y1' | 'x2' | 'y2'>) => void
}) {
  const [draft, setDraft] = useState(() => ({ x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 }))
  useEffect(() => setDraft({ x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 }), [wall.id, wall.x1, wall.x2, wall.y1, wall.y2])
  const fields = [
    ['x1', '起点 X'],
    ['y1', '起点 Y'],
    ['x2', '终点 X'],
    ['y2', '终点 Y'],
  ] as const

  return (
    <div className="mt-3 border-t border-slate-200 pt-3" aria-label="墙体坐标编辑器">
      <p className="mb-2 text-slate-500">图纸像素坐标</p>
      <div className="grid grid-cols-2 gap-2">
        {fields.map(([key, label]) => (
          <label key={key} className="text-slate-600">{label}
            <input
              aria-label={label}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-slate-900"
              type="number"
              step="1"
              value={draft[key]}
              onChange={(event) => setDraft((current) => ({ ...current, [key]: Number(event.target.value) }))}
            />
          </label>
        ))}
      </div>
      <button type="button" className="mt-2 w-full rounded-[10px] bg-violet-600 px-3 py-2 font-semibold text-white" onClick={() => onApply(draft)}>应用坐标</button>
    </div>
  )
}

/** Customer-facing inspector; stable IDs remain internal and test-addressable only. */
export function InspectorPanel({
  selectedWallID,
  selectedWall,
  selectedOpening,
  openingError,
  canExport2D,
  canExport3D,
  exportingScope,
  exportError,
  onAddOpening,
  onWallCoordinatesChange,
  onOpeningWidthChange,
  onDeleteOpening,
  onExport2D,
  onExport3D,
}: InspectorPanelProps) {
  const currentObject = selectedOpening
    ? selectedOpening.kind === 'door' ? PRODUCT_LANGUAGE.object.door : PRODUCT_LANGUAGE.object.window
    : selectedWallID ? PRODUCT_LANGUAGE.object.wall : PRODUCT_LANGUAGE.object.none
  return (
    <aside className="workspace-card inspector-card min-w-0 p-4 text-slate-800">
      <section className="space-y-3 text-xs">
        <div><h3 className="text-base font-semibold">选中对象</h3><p className="mt-1 text-slate-500">在平面图或空间预览中选择同一个位置。</p></div>
        <div className="rounded-[10px] bg-slate-50 p-3" aria-label="墙体对象上下文">
          <p className="text-slate-500">当前对象</p>
          <p className="mt-1 font-semibold text-slate-900">{currentObject}</p>
          <p className="mt-2 text-amber-700">结构属性：待确认</p>
          {selectedWall && onWallCoordinatesChange && <WallCoordinateEditor wall={selectedWall} onApply={onWallCoordinatesChange} />}
        </div>
        <div className="rounded-[10px] bg-slate-50 p-3" aria-label="开口编辑器">
          <p className="mb-2 text-slate-500">门窗位置</p>
          <div className="grid grid-cols-2 gap-2"><button type="button" className="rounded-[10px] bg-orange-600 px-3 py-2 text-white disabled:opacity-50" disabled={!selectedWallID} onClick={() => onAddOpening('door')}>添加门洞</button><button type="button" className="rounded-[10px] bg-sky-600 px-3 py-2 text-white disabled:opacity-50" disabled={!selectedWallID} onClick={() => onAddOpening('window')}>添加窗洞</button></div>
          {selectedOpening && <div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><label className="text-slate-600">开口宽度<input aria-label="开口宽度" data-testid="opening-width" className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-slate-900" type="number" min={MIN_OPENING_WIDTH} step="1" value={selectedOpening.width ?? ''} onChange={(event) => { const width = Number(event.target.value); if (Number.isFinite(width)) onOpeningWidthChange(width) }} /></label><button type="button" className="self-end rounded-[10px] bg-red-700 px-3 py-2 text-white" onClick={onDeleteOpening}>删除</button>{selectedOpening.kind === 'window' && <p className="unknown-note col-span-2 p-2" data-testid="window-preview-disclosure" role="status">窗台高度尚未测量。当前预览只用于查看空间。</p>}{selectedOpening.kind === 'door' && selectedOpening.confirmed !== true && <p className="unknown-note col-span-2 p-2" data-testid="door-preview-disclosure" role="status">门洞高度尚未测量。当前预览只用于查看空间。</p>}</div>}
          {openingError && <p role="alert" className="mt-2 text-amber-700">这个位置暂时无法这样调整，请检查墙体坐标、开口宽度和图纸边界。</p>}
        </div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="mb-2 text-slate-500">导出当前视图</p><div className="grid grid-cols-2 gap-2"><button aria-label="导出2D平面图PNG" className="rounded-lg bg-emerald-600 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canExport2D} onClick={onExport2D}>{exportingScope === '2d' ? '导出中…' : '导出平面图'}</button><button aria-label="导出3D白模PNG" className="rounded-lg bg-sky-600 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canExport3D} onClick={onExport3D}>{exportingScope === '3d' ? '导出中…' : '导出空间图'}</button></div>{exportError && <p role="alert" className="mt-2 text-amber-700">导出未完成，请稍后再试。</p>}</div>
      </section>
    </aside>
  )
}
