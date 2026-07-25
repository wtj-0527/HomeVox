import { MIN_OPENING_WIDTH, type ParsedOpening } from './floorplanUi'
import { PRODUCT_LANGUAGE } from './productPresentation'

export type InspectorPanelProps = {
  selectedWallID: string | null
  selectedOpening: ParsedOpening | null
  openingError: string
  canExport2D: boolean
  canExport3D: boolean
  exportingScope: '2d' | '3d' | null
  exportError: string
  canUndo: boolean
  canRedo: boolean
  onAddOpening: (kind: 'door' | 'window') => void
  onOpeningWidthChange: (width: number) => void
  onDeleteOpening: () => void
  onExport2D: () => void
  onExport3D: () => void
  onUndo: () => void
  onRedo: () => void
}

/** Customer-facing inspector; stable IDs remain internal and test-addressable only. */
export function InspectorPanel({
  selectedWallID, selectedOpening, openingError, canExport2D, canExport3D, exportingScope,
  exportError, onAddOpening, onOpeningWidthChange, onDeleteOpening, onExport2D, onExport3D,
}: InspectorPanelProps) {
  const currentObject = selectedOpening
    ? selectedOpening.kind === 'door' ? PRODUCT_LANGUAGE.object.door : PRODUCT_LANGUAGE.object.window
    : selectedWallID ? PRODUCT_LANGUAGE.object.wall : PRODUCT_LANGUAGE.object.none
  return (
    <aside className="workspace-card inspector-card min-w-0 p-4 text-slate-800">
      <section className="space-y-3 text-xs">
        <div><h3 className="text-base font-semibold">选中对象</h3><p className="mt-1 text-slate-500">在平面图或空间预览中选择同一个位置。</p></div>
        <div className="rounded-[10px] bg-slate-50 p-3" aria-label="墙体对象上下文"><p className="text-slate-500">当前对象</p><p className="mt-1 font-semibold text-slate-900">{currentObject}</p><p className="mt-2 text-amber-700">结构属性：待确认</p></div>
        <div className="rounded-[10px] bg-slate-50 p-3" aria-label="开口编辑器"><p className="mb-2 text-slate-500">门窗位置</p><div className="grid grid-cols-2 gap-2"><button type="button" className="rounded-[10px] bg-orange-600 px-3 py-2 text-white disabled:opacity-50" disabled={!selectedWallID} onClick={() => onAddOpening('door')}>添加门洞</button><button type="button" className="rounded-[10px] bg-sky-600 px-3 py-2 text-white disabled:opacity-50" disabled={!selectedWallID} onClick={() => onAddOpening('window')}>添加窗洞</button></div>{selectedOpening && <div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><label className="text-slate-600">开口宽度<input aria-label="开口宽度" data-testid="opening-width" className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-slate-900" type="number" min={MIN_OPENING_WIDTH} step="1" value={selectedOpening.width ?? ''} onChange={(event) => { const width = Number(event.target.value); if (Number.isFinite(width)) onOpeningWidthChange(width) }} /></label><button type="button" className="self-end rounded-[10px] bg-red-700 px-3 py-2 text-white" onClick={onDeleteOpening}>删除</button>{selectedOpening.kind === 'window' && <p className="unknown-note col-span-2 p-2" data-testid="window-preview-disclosure" role="status">窗台高度尚未测量。当前预览只用于查看空间。</p>}{selectedOpening.kind === 'door' && selectedOpening.confirmed !== true && <p className="unknown-note col-span-2 p-2" data-testid="door-preview-disclosure" role="status">门洞高度尚未测量。当前预览只用于查看空间。</p>}</div>}{openingError && <p role="alert" className="mt-2 text-amber-700">这个开口暂时无法这样调整，请缩短宽度或选择另一面墙。</p>}</div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="mb-2 text-slate-500">导出当前视图</p><div className="grid grid-cols-2 gap-2"><button aria-label="导出2D平面图PNG" className="rounded-lg bg-emerald-600 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canExport2D} onClick={onExport2D}>{exportingScope === '2d' ? '导出中…' : '导出平面图'}</button><button aria-label="导出3D白模PNG" className="rounded-lg bg-sky-600 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canExport3D} onClick={onExport3D}>{exportingScope === '3d' ? '导出中…' : '导出空间图'}</button></div>{exportError && <p role="alert" className="mt-2 text-amber-700">导出未完成，请稍后再试。</p>}</div>
      </section>
    </aside>
  )
}
