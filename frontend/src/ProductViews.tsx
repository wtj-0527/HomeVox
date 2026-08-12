import type { FloorplanEditorPanelProps } from './FloorplanEditorPanel'
import { FloorplanEditorPanel } from './FloorplanEditorPanel'
import type { InspectorPanelProps } from './InspectorPanel'
import { InspectorPanel } from './InspectorPanel'
import type { ThreeDPreviewPanelProps } from './ThreeDPreviewPanel'
import { ThreeDPreviewPanel } from './ThreeDPreviewPanel'

export type TwoDWorkspaceProps = {
  editor: FloorplanEditorPanelProps
  inspector: InspectorPanelProps
  snapshot: {
    exists: boolean
    busy: boolean
    canSave?: boolean
    message: string
    messageTone: 'success' | 'error'
    saveState: 'idle' | 'saving' | 'saved' | 'failed' | 'conflict'
    onSave: () => void
    onRetry: () => void
    onReload: () => void
    onCopyResumeLink: () => void
  }
  canAdvance: boolean
  onAdvance: () => void
}

export function WorkspaceToolbar({ inspector, snapshot, linked = false, onAdvance, canAdvance }: Pick<TwoDWorkspaceProps, 'inspector' | 'snapshot' | 'onAdvance' | 'canAdvance'> & { linked?: boolean }) {
  const saveStateLabel = snapshot.saveState === 'saving' ? '保存中…'
    : snapshot.saveState === 'saved' ? '已保存'
      : snapshot.saveState === 'failed' ? '保存失败'
        : snapshot.saveState === 'conflict' ? '版本冲突'
          : ''
  const saveStateClass = snapshot.saveState === 'saving' ? 'bg-blue-50 text-blue-700'
    : snapshot.saveState === 'saved' ? 'bg-emerald-50 text-emerald-700'
      : snapshot.saveState === 'failed' ? 'bg-red-50 text-red-700'
        : snapshot.saveState === 'conflict' ? 'bg-amber-50 text-amber-800'
          : ''
  return <div className="workspace-toolbar">
    <div className="flex min-w-0 items-center gap-2">
      <span className="toolbar-chip">{linked ? '并排视图' : '2D 编辑'}</span>
      {linked ? <span className="truncate text-xs font-semibold text-emerald-700">平面图与空间预览已同步</span> : <span className="text-xs font-semibold text-slate-500">调整完成后可查看 3D</span>}
    </div>
    <div className="flex items-center gap-2">
      {snapshot.exists && saveStateLabel && <span data-testid="autosave-state" role="status" className={`rounded-lg px-2 py-1 text-xs font-semibold ${saveStateClass}`}>{saveStateLabel}</span>}
      {snapshot.message && (snapshot.saveState === 'failed' || snapshot.saveState === 'conflict') && <span role="alert" className="max-w-44 truncate text-xs font-semibold text-red-700">{snapshot.message}</span>}
      {snapshot.exists && snapshot.saveState === 'failed' && <button type="button" className="toolbar-button whitespace-nowrap" disabled={snapshot.busy} onClick={snapshot.onRetry}>重试</button>}
      {snapshot.exists && snapshot.saveState === 'conflict' && <button type="button" className="toolbar-button whitespace-nowrap" disabled={snapshot.busy} onClick={snapshot.onReload}>加载最新版本</button>}
      {snapshot.exists && <button type="button" className="toolbar-button whitespace-nowrap" disabled={snapshot.busy} onClick={snapshot.onCopyResumeLink}>复制编辑链接</button>}
      {!snapshot.exists && <button data-testid="save-recognition-snapshot" type="button" className="toolbar-button whitespace-nowrap" disabled={snapshot.busy || snapshot.canSave === false} onClick={snapshot.onSave}>{snapshot.busy ? '保存中…' : '创建识别快照'}</button>}
      <button type="button" className="toolbar-button whitespace-nowrap" disabled={!inspector.canUndo} onClick={inspector.onUndo}>撤销</button>
      <button type="button" className="toolbar-button whitespace-nowrap" disabled={!inspector.canRedo} onClick={inspector.onRedo}>重做</button>
      {linked
        ? <button data-testid="complete-product-step" type="button" className="toolbar-primary" disabled={!canAdvance} onClick={onAdvance}>保存项目</button>
        : <button data-testid="complete-product-step" type="button" className="toolbar-primary" disabled={!canAdvance} onClick={onAdvance}>完成校正后生成 3D</button>}
    </div>
  </div>
}

export function TwoDWorkspace({ editor, inspector, snapshot, canAdvance, onAdvance }: TwoDWorkspaceProps) {
  return <section className="two-d-product-workspace"><div className="workspace-card two-d-editor-frame"><WorkspaceToolbar inspector={inspector} snapshot={snapshot} canAdvance={canAdvance} onAdvance={onAdvance} /><FloorplanEditorPanel {...editor} embedded /></div><InspectorPanel {...inspector} /></section>
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
        <><h4 className="text-lg font-semibold">这张图暂时无法生成空间预览</h4><p className="mt-2 text-sm text-slate-600">请返回平面图校正后调整相关位置，再重新生成。</p></>
      ) : wasmState === 'loading' ? (
        <><h4 className="text-lg font-semibold">正在准备空间预览</h4><p className="mt-2 text-sm text-slate-600">准备完成后，你可以继续查看并调整。</p></>
      ) : (
        <><h4 className="text-lg font-semibold">当前无法显示空间预览</h4><p className="mt-2 text-sm text-slate-600">请返回平面图校正后重试，或换用支持 3D 显示的浏览器。</p></>
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
  const ready = previewAvailable && canOpenLinkedWorkspace
  return (
    <section className="three-generation mx-auto grid w-full max-w-[1124px] grid-cols-[minmax(0,812px)_284px] gap-7">
      <div className="workspace-card h-[780px] p-7">
        <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-slate-900">{ready ? '空间预览已准备好' : '正在准备空间预览'}</h3><span className="toolbar-chip">{ready ? '可继续编辑' : '正在处理'}</span></div>
        <div className="mt-5 h-[570px] overflow-hidden rounded-[14px] bg-slate-50">{previewAvailable ? <ThreeDPreviewPanel {...preview} /> : <ThreeDUnavailablePanel geometryValidationError={preview.geometryValidationError} wasmState={wasmState} onBack={onBack} />}</div>
        <p className="mt-5 text-sm leading-6 text-slate-500">空间轮廓、房间关系和门窗位置来自当前平面图。层高、墙高和结构属性尚未测量，当前用于帮助你查看空间。</p>
      </div>
      <aside className="workspace-card h-[780px] p-6 text-slate-800">
        <h3 className="text-lg font-bold">生成设置</h3>
        <dl className="mt-6 space-y-4 text-sm"><div><dt className="text-xs text-slate-500">来源</dt><dd className="mt-1 font-semibold">当前平面图</dd></div><div><dt className="text-xs text-slate-500">房间</dt><dd className="mt-1 font-semibold">按图纸识别</dd></div><div><dt className="text-xs text-slate-500">门窗位置</dt><dd className="mt-1 font-semibold">沿用平面图</dd></div><div><dt className="text-xs text-slate-500">层高</dt><dd className="mt-1 font-semibold text-amber-700">尚未测量</dd></div><div><dt className="text-xs text-slate-500">墙高</dt><dd className="mt-1 font-semibold text-amber-700">预览示意</dd></div><div><dt className="text-xs text-slate-500">结构属性</dt><dd className="mt-1 font-semibold text-amber-700">待确认</dd></div></dl>
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

export function LinkedWorkspace({ editor, preview, inspector, snapshot, previewAvailable, canAdvance, onAdvance }: LinkedWorkspaceProps) {
  return <section className="workspace-card linked-product-workspace"><WorkspaceToolbar inspector={inspector} snapshot={snapshot} linked canAdvance={canAdvance} onAdvance={onAdvance} /><div className="workspace-grid product-workspace product-workspace-linked"><FloorplanEditorPanel {...editor} embedded />{previewAvailable ? <ThreeDPreviewPanel {...preview} /> : <div className="p-6 text-sm text-slate-600" role="status">正在更新空间预览；你可以继续校正 2D。</div>}<InspectorPanel {...inspector} /></div></section>
}
