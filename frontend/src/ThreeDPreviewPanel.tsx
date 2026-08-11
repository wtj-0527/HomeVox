import { ThreeDPreview, type ThreeDPreviewProps } from './ThreeDPreview'

export type ThreeDPreviewPanelProps = ThreeDPreviewProps & {
  geometryValidationError: string | null
}

/** Product-facing 3D panel. It retains the typed R3F/WASM revision interface,
 * so workspaces cannot replace the real renderer with arbitrary markup. */
export function ThreeDPreviewPanel({ geometryValidationError, ...previewProps }: ThreeDPreviewPanelProps) {
  return (
    <main className="three-card relative min-h-[520px] min-w-0 overflow-hidden" aria-label="3D 户型预览">
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-xl bg-black/60 px-3 py-2 text-xs text-white/75">
        <div className="font-medium text-white/90">空间预览</div><p className="mt-1 inline-flex rounded-full bg-violet-500/25 px-2 py-0.5 text-[11px] font-medium text-violet-100">可继续查看与编辑</p>
        <p className="mt-1 text-[11px] text-white/65">在平面图或空间预览中选择同一个位置。</p>
        {geometryValidationError && <p className="mt-1 max-w-xs text-[11px] text-amber-200" role="alert">部分位置需要回到平面图调整后再试。</p>}
      </div>
      <div className="h-full w-full"><ThreeDPreview {...previewProps} /></div>
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-xl bg-black/55 px-3 py-2 text-center text-xs text-white/50">层高、墙高和结构属性尚未测量，当前仅作空间查看参考。</div>
    </main>
  )
}
