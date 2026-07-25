import { MIN_OPENING_WIDTH, type ParsedOpening } from './floorplanUi'

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

/** Typed editing and export controls for the same canonical document used by
 * both 2D and 3D. Keeping these callbacks explicit prevents a view from
 * reaching into orchestration state or bypassing revision admission. */
export function InspectorPanel({
  selectedWallID,
  selectedOpening,
  openingError,
  canExport2D,
  canExport3D,
  exportingScope,
  exportError,
  canUndo,
  canRedo,
  onAddOpening,
  onOpeningWidthChange,
  onDeleteOpening,
  onExport2D,
  onExport3D,
  onUndo,
  onRedo,
}: InspectorPanelProps) {
  return (
    <aside className="workspace-card inspector-card min-w-0 p-4 text-slate-800">
      <section className="space-y-3 text-xs">
        <div><h3 className="text-base font-semibold">选中对象</h3><p className="mt-1 text-slate-500">在 2D 或 3D 中选择同一个空间对象。</p></div>
        <div className="rounded-[10px] bg-slate-50 p-3" aria-label="墙体对象上下文"><p className="text-slate-500">当前对象</p><p className="mt-1 font-semibold text-slate-900">{selectedOpening ? (selectedOpening.kind === 'door' ? '门洞' : '窗洞') : selectedWallID ? '墙体' : '未选择'}</p><span data-testid="selected-wall-id" className="sr-only">{selectedWallID ?? '未选择'}</span>{selectedOpening && <span data-testid="selected-opening-id" className="sr-only">{selectedOpening.id} · {selectedOpening.wallId ?? '未知'}</span>}<p className="mt-2 text-amber-700">结构属性 unknown</p></div>
        <div className="rounded-[10px] bg-slate-50 p-3" aria-label="开口编辑器"><p className="mb-2 text-slate-500">门窗开口</p><div className="grid grid-cols-2 gap-2"><button type="button" className="rounded-[10px] bg-orange-600 px-3 py-2 text-white disabled:opacity-50" disabled={!selectedWallID} onClick={() => onAddOpening('door')}>添加门</button><button type="button" className="rounded-[10px] bg-sky-600 px-3 py-2 text-white disabled:opacity-50" disabled={!selectedWallID} onClick={() => onAddOpening('window')}>添加窗</button></div>{selectedOpening && <div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><label className="text-slate-600">开口宽度<input aria-label="开口宽度" data-testid="opening-width" className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-slate-900" type="number" min={MIN_OPENING_WIDTH} step="1" value={selectedOpening.width ?? ''} onChange={(event) => { const width = Number(event.target.value); if (Number.isFinite(width)) onOpeningWidthChange(width) }} /></label><button type="button" className="self-end rounded-[10px] bg-red-700 px-3 py-2 text-white" onClick={onDeleteOpening}>删除</button>{selectedOpening.kind === 'window' && <p className="unknown-note col-span-2 p-2" data-testid="window-preview-disclosure" role="status">窗台高和窗高 unknown。3D 预览使用未持久化的示意值，不会保存为建筑参数。</p>}{selectedOpening.kind === 'door' && selectedOpening.confirmed !== true && <p className="unknown-note col-span-2 p-2" data-testid="door-preview-disclosure" role="status">门高 unknown。3D 全高门洞仅为预览示意，不会保存为建筑参数。</p>}</div>}{openingError && <p role="alert" className="mt-2 text-amber-700">{openingError}</p>}</div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="mb-2 text-slate-500">导出当前视图</p><div className="grid grid-cols-2 gap-2"><button aria-label="导出2D平面图PNG" className="rounded-lg bg-emerald-600 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canExport2D} onClick={onExport2D}>{exportingScope === '2d' ? '导出中…' : '导出2D PNG'}</button><button aria-label="导出3D白模PNG" className="rounded-lg bg-sky-600 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canExport3D} onClick={onExport3D}>{exportingScope === '3d' ? '导出中…' : '导出3D PNG'}</button></div>{exportError && <p role="alert" className="mt-2 text-amber-700">{exportError}</p>}</div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="mb-2 text-slate-500">编辑历史</p><div className="grid grid-cols-2 gap-2"><button aria-label="撤销（Ctrl/Cmd + Z）" className="rounded-lg bg-slate-800 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canUndo} onClick={onUndo}>Undo</button><button aria-label="重做（Ctrl/Cmd + Shift+Z 或 Ctrl/Cmd + Y）" className="rounded-lg bg-slate-800 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canRedo} onClick={onRedo}>Redo</button></div></div>
      </section>
    </aside>
  )
}
