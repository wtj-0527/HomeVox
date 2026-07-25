import type { FloorplanEditorPanelProps } from './FloorplanEditorPanel'
import { FloorplanEditorPanel } from './FloorplanEditorPanel'
import type { InspectorPanelProps } from './InspectorPanel'
import { InspectorPanel } from './InspectorPanel'
import type { ThreeDPreviewPanelProps } from './ThreeDPreviewPanel'
import { ThreeDPreviewPanel } from './ThreeDPreviewPanel'

export type TwoDWorkspaceProps = {
  editor: FloorplanEditorPanelProps
  inspector: InspectorPanelProps
  canAdvance: boolean
  onAdvance: () => void
}

function WorkspaceToolbar({ inspector, linked = false, onAdvance, canAdvance }: Pick<TwoDWorkspaceProps, 'inspector' | 'onAdvance' | 'canAdvance'> & { linked?: boolean }) {
  return <div className="workspace-toolbar">
    <div className="flex min-w-0 items-center gap-2">
      <span className="toolbar-chip">{linked ? '并排视图' : '2D 编辑'}</span>
      {linked ? <span className="truncate text-xs font-semibold text-slate-700">几何已同步 · 语义待确认</span> : <span className="text-xs font-semibold text-slate-500">3D 预览</span>}
    </div>
    <div className="flex items-center gap-2">
      <button type="button" className="toolbar-button" disabled={!inspector.canUndo} onClick={inspector.onUndo}>撤销</button>
      <button type="button" className="toolbar-button" disabled={!inspector.canRedo} onClick={inspector.onRedo}>重做</button>
      {linked
        ? <button data-testid="complete-product-step" type="button" className="toolbar-primary" disabled={!canAdvance} onClick={onAdvance}>保存项目</button>
        : <button data-testid="complete-product-step" type="button" className="toolbar-primary" disabled={!canAdvance} onClick={onAdvance}>完成校正后生成 3D</button>}
    </div>
  </div>
}

export function TwoDWorkspace({ editor, inspector, canAdvance, onAdvance }: TwoDWorkspaceProps) {
  return <section className="workspace-card product-workspace-shell"><WorkspaceToolbar inspector={inspector} canAdvance={canAdvance} onAdvance={onAdvance} /><div className="workspace-grid product-workspace"><FloorplanEditorPanel {...editor} /><InspectorPanel {...inspector} /></div></section>
}

type ThreeDUnavailableProps = {
  geometryValidationError: string | null
  wasmState: 'idle' | 'loading' | 'active' | 'fallback'
  onBack: () => void
}

function ThreeDUnavailablePanel({ geometryValidationError, wasmState, onBack }: ThreeDUnavailableProps) {
  return (
    <div className="workspace-card p-6 text-slate-800" role={wasmState === 'loading' ? 'status' : 'alert'}>
      {geometryValidationError ? (
        <><h4 className="text-lg font-semibold">当前开口数据无法生成 3D</h4><p className="mt-2 text-sm text-slate-600">请返回 2D 校正后修复数据，再重新生成 3D。</p></>
      ) : wasmState === 'loading' ? (
        <><h4 className="text-lg font-semibold">正在准备 3D 预览</h4><p className="mt-2 text-sm text-slate-600">3D 几何准备完成后，才能打开联动工作台。</p></>
      ) : (
        <><h4 className="text-lg font-semibold">当前 3D 预览不可用</h4><p className="mt-2 text-sm text-slate-600">无法生成可靠的 3D 几何。请返回 2D 校正后重试，或在支持 WebGL 的浏览器中打开。</p></>
      )}
      <button type="button" className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={onBack}>返回 2D 校正</button>
    </div>
  )
}

export type ThreeDConfirmationProps = {
  preview: ThreeDPreviewPanelProps
  previewAvailable: boolean
  canOpenLinkedWorkspace: boolean
  wasmState: ThreeDUnavailableProps['wasmState']
  onBack: () => void
  onComplete: () => void
}

export function ThreeDConfirmation({ preview, previewAvailable, canOpenLinkedWorkspace, wasmState, onBack, onComplete }: ThreeDConfirmationProps) {
  return (
    <section className="three-generation mx-auto grid w-full max-w-[1124px] grid-cols-[minmax(0,812px)_284px] gap-7">
      <div className="workspace-card h-[780px] p-7">
        <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-slate-900">正在从 2D 结构生成 3D</h3><span className="toolbar-chip">同一空间数据</span></div>
        <div className="mt-5 h-[570px] overflow-hidden rounded-[14px] bg-slate-50">{previewAvailable ? <ThreeDPreviewPanel {...preview} /> : <ThreeDUnavailablePanel geometryValidationError={preview.geometryValidationError} wasmState={wasmState} onBack={onBack} />}</div>
        <p className="mt-5 text-sm leading-6 text-slate-500">空间轮廓、房间邻接和开口来自当前 2D。层高 / 墙高仍为 unknown，现阶段只用于空间编辑预览。</p>
      </div>
      <aside className="workspace-card h-[780px] p-6 text-slate-800">
        <h3 className="text-lg font-bold">生成设置</h3>
        <dl className="mt-6 space-y-4 text-sm"><div><dt className="text-xs text-slate-500">来源</dt><dd className="mt-1 font-semibold">当前 2D 结构</dd></div><div><dt className="text-xs text-slate-500">门洞 / 开口</dt><dd className="mt-1 font-semibold">沿用 2D</dd></div><div><dt className="text-xs text-slate-500">层高</dt><dd className="mt-1 font-semibold text-amber-700">unknown</dd></div><div><dt className="text-xs text-slate-500">墙高</dt><dd className="mt-1 font-semibold text-amber-700">预览示意</dd></div><div><dt className="text-xs text-slate-500">结构墙属性</dt><dd className="mt-1 font-semibold text-amber-700">unknown</dd></div></dl>
        <p className="mt-9 rounded-[10px] bg-amber-50 p-3 text-xs leading-5 text-amber-800">这不是施工 CAD。精确高度、承重属性、墙厚与窗台高度需要后续实测。</p>
        <div className="mt-9 space-y-3">{canOpenLinkedWorkspace && <button type="button" className="w-full rounded-[10px] bg-violet-600 px-3 py-3 text-sm font-semibold text-white" onClick={onComplete}>完成并打开 3D</button>}<button type="button" className="w-full rounded-[10px] border border-violet-300 px-3 py-3 text-sm font-semibold text-violet-700" onClick={onBack}>返回 2D 校正</button></div>
      </aside>
    </section>
  )
}

export type LinkedWorkspaceProps = TwoDWorkspaceProps & {
  preview: ThreeDPreviewPanelProps
  previewAvailable: boolean
  onBack: () => void
}

export function LinkedWorkspace({ editor, preview, inspector, previewAvailable, canAdvance, onAdvance, onBack }: LinkedWorkspaceProps) {
  if (!previewAvailable) {
    return <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800" role="alert"><h3 className="text-lg font-semibold">当前 3D 预览不可用</h3><p className="mt-2 text-sm text-slate-600">联动工作台已关闭，请先返回 2D 校正。</p><button type="button" className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={onBack}>返回 2D 校正</button></section>
  }
  return <section className="workspace-card product-workspace-shell"><WorkspaceToolbar inspector={inspector} linked canAdvance={canAdvance} onAdvance={onAdvance} /><div className="workspace-grid product-workspace product-workspace-linked"><FloorplanEditorPanel {...editor} /><ThreeDPreviewPanel {...preview} /><InspectorPanel {...inspector} /></div></section>
}
