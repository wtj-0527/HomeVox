import type { FloorplanEditorPanelProps } from './FloorplanEditorPanel'
import { FloorplanEditorPanel } from './FloorplanEditorPanel'
import type { InspectorPanelProps } from './InspectorPanel'
import { InspectorPanel } from './InspectorPanel'
import type { ThreeDPreviewPanelProps } from './ThreeDPreviewPanel'
import { ThreeDPreviewPanel } from './ThreeDPreviewPanel'

export type TwoDWorkspaceProps = {
  editor: FloorplanEditorPanelProps
  inspector: InspectorPanelProps
}

export function TwoDWorkspace({ editor, inspector }: TwoDWorkspaceProps) {
  return <div className="workspace-grid product-workspace"><FloorplanEditorPanel {...editor} /><InspectorPanel {...inspector} /></div>
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
    <section className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
        <div><h3 className="font-semibold text-slate-900">确认 3D 空间</h3><p className="mt-1 text-sm text-slate-500">这是同一份已校正 2D 数据生成的真实 3D 预览。</p></div>
        <div className="flex gap-2"><button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={onBack}>返回 2D 校正</button>{canOpenLinkedWorkspace && <button type="button" className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white" onClick={onComplete}>完成并打开 3D</button>}</div>
      </div>
      {previewAvailable ? <ThreeDPreviewPanel {...preview} /> : <ThreeDUnavailablePanel geometryValidationError={preview.geometryValidationError} wasmState={wasmState} onBack={onBack} />}
    </section>
  )
}

export type LinkedWorkspaceProps = TwoDWorkspaceProps & {
  preview: ThreeDPreviewPanelProps
  previewAvailable: boolean
  onBack: () => void
}

export function LinkedWorkspace({ editor, preview, inspector, previewAvailable, onBack }: LinkedWorkspaceProps) {
  if (!previewAvailable) {
    return <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800" role="alert"><h3 className="text-lg font-semibold">当前 3D 预览不可用</h3><p className="mt-2 text-sm text-slate-600">联动工作台已关闭，请先返回 2D 校正。</p><button type="button" className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={onBack}>返回 2D 校正</button></section>
  }
  return <div className="workspace-grid product-workspace product-workspace-linked"><FloorplanEditorPanel {...editor} /><ThreeDPreviewPanel {...preview} /><InspectorPanel {...inspector} /></div>
}
