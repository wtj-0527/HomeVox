import { useRef, type PointerEvent } from 'react'
import { cropDisplayMetrics, cropKeyboardNudge, cropPointerToImage, moveCrop, resizeCrop } from './cropFlow'

export type ParseViewStatus = 'idle' | 'uploading' | 'ready' | 'error'

type SourceFileProps = {
  selectedFile: File | null
  previewURL: string
  onFileChange: (file: File | null) => void
}

function SourcePreview({ selectedFile, previewURL }: SourceFileProps) {
  if (!selectedFile || !previewURL) return null
  return (
    <section className="source-preview flex h-full flex-col" aria-label="已选择的户型图">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-lg font-bold text-slate-800">已选择的户型图</p></div>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">真实输入</span>
      </div>
      <img className="source-plan-image mt-6 rounded-[10px] bg-slate-50 object-contain" src={previewURL} alt="上传户型图预览" />
      <p className="mt-2 text-[13px] font-medium text-slate-500">{selectedFile.name}</p>
      <p className="mt-2 text-[13px] leading-5 text-slate-500">图纸中的房间、门窗和尺寸标注会保留，识别后可逐项调整。</p>
    </section>
  )
}

export type SourceImportViewProps = SourceFileProps & {
  status: ParseViewStatus
  error: string
  projectMessage: string
  projectMessageTone: 'success' | 'error'
  projectBusy: 'save' | 'load' | null
  onRetryProjectLoad: () => void
}

function ImportFacts() {
  return <div className="mt-7 space-y-3 border-t border-slate-200 pt-5">
    <h4 className="text-sm font-semibold text-slate-800">本次识别内容</h4>
    <dl className="space-y-2 text-sm">
      <div className="import-fact"><dt>房间与边界</dt><dd className="text-emerald-700">将在图纸中查找</dd></div>
      <div className="import-fact"><dt>门窗位置</dt><dd className="text-emerald-700">待你校正</dd></div>
      <div className="import-fact"><dt>图中尺寸</dt><dd className="text-sky-700">保留图中标注</dd></div>
      <div className="import-fact"><dt>朝向</dt><dd className="text-amber-700">尚未识别</dd></div>
      <div className="import-fact"><dt>层高 / 墙高</dt><dd className="text-amber-700">尚未测量</dd></div>
    </dl>
  </div>
}

export function SourceImportView({ selectedFile, previewURL, onFileChange, status, error, projectMessage, projectMessageTone, projectBusy, onRetryProjectLoad }: SourceImportViewProps) {
  if (!selectedFile || !previewURL) {
    return (
      <section className="workspace-card mx-auto w-full max-w-[760px] p-7 text-slate-800">
        <h3 className="text-xl font-bold">导入真实户型图</h3>
        <p className="mt-2 text-sm text-slate-500">从你的图纸开始，不套用示意户型。</p>
        {projectMessageTone === 'error' && projectMessage && <div className="mt-5 rounded-[10px] bg-red-50 p-3 text-sm text-red-700"><p role="alert">{projectMessage}</p><button type="button" className="mt-3 rounded border border-red-300 px-3 py-2 font-semibold" disabled={projectBusy === 'load'} onClick={onRetryProjectLoad}>{projectBusy === 'load' ? '正在重试…' : '重试加载项目'}</button></div>}
        <label className="mt-7 block cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center hover:border-violet-500">
          <span className="block text-base font-semibold">选择户型图</span>
          <span className="mt-2 block text-sm text-slate-500">支持 PNG、JPEG、GIF、WebP；文件不超过 10 MiB</span>
          <input className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} />
        </label>
      </section>
    )
  }
  return (
    <section className="import-workspace mx-auto grid w-full max-w-[1124px] grid-cols-[minmax(0,700px)_396px] gap-7 text-slate-800">
      <div className="workspace-card h-[780px] p-7"><SourcePreview selectedFile={selectedFile} previewURL={previewURL} onFileChange={onFileChange} /></div>
      <aside className="workspace-card h-[780px] p-7">
        <h3 className="text-xl font-bold">把这张图变成可编辑空间</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">HomeVox 会先识别平面结构，再由你确认后生成可继续查看的 3D。</p>
        <ImportFacts />
        <p className="mt-7 rounded-[12px] bg-indigo-50 p-4 text-sm font-medium leading-6 text-violet-600">只围绕你的户型建立项目，后续修改会同时反映在平面图与空间预览中。</p>
        {error && <p role="alert" className="mt-4 rounded-[10px] bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {projectMessageTone === 'error' && projectMessage && <div className="mt-4 rounded-[10px] bg-red-50 p-3 text-sm text-red-700"><p role="alert">{projectMessage}</p><button type="button" className="mt-3 rounded border border-red-300 px-3 py-2 font-semibold" disabled={projectBusy === 'load'} onClick={onRetryProjectLoad}>{projectBusy === 'load' ? '正在重试…' : '重试加载项目'}</button></div>}
        <p className="mt-8 rounded-[10px] bg-violet-50 px-4 py-3 text-center text-sm font-semibold text-violet-700">{status === 'uploading' ? '正在判断…' : status === 'ready' ? '判断完成' : '图片尺寸就绪后自动判断'}</p>
        <label className="mt-3 block cursor-pointer rounded-[10px] border border-violet-300 px-4 py-3 text-center text-sm font-semibold text-violet-700">重新选择图纸<input className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} /></label>
      </aside>
    </section>
  )
}

export type AIParseViewProps = SourceFileProps & {
  status: ParseViewStatus
  error: string
}

export function AIParseView({ selectedFile, previewURL, onFileChange, status, error }: AIParseViewProps) {
  return (
    <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800">
      <h3 className="text-xl font-semibold">正在判断</h3>
      <p className="mt-2 text-sm text-slate-500">正在根据原图判断可识别的户型区域。</p>
      <SourcePreview selectedFile={selectedFile} previewURL={previewURL} onFileChange={onFileChange} />
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><span className="text-slate-500">判断状态：</span>{status === 'ready' ? '判断完成' : status === 'uploading' ? '正在判断' : status === 'error' ? '失败' : '等待图片尺寸'}{error && <p role="alert" className="mt-2 text-red-700">{error}</p>}</div>
    </section>
  )
}

import type { CandidateDetection, CropHandle, CropRect } from './cropFlow'

export type CropConfirmViewProps = SourceFileProps & {
  imageSize: { width: number; height: number } | null
  detection: CandidateDetection | null
  crop: CropRect | null
  status: ParseViewStatus
  error: string
  onCropChange: (crop: CropRect) => void
  onSelectCandidate: (index: number) => void
  onRestoreRecommended: () => void
  onResetFullImage: () => void
  onConfirm: () => void
}

export function CropConfirmView({ selectedFile, previewURL, imageSize, detection, crop, status, error, onCropChange, onSelectCandidate, onRestoreRecommended, onResetFullImage, onConfirm }: CropConfirmViewProps) {
  const gesture = useRef<{ x: number; y: number; crop: CropRect; handle: CropHandle | 'move' } | null>(null)
  const display = imageSize ? cropDisplayMetrics(imageSize) : { handleSize: 14, hitDistance: 18, strokeWidth: 3 }
  const handleAt = (x: number, y: number): CropHandle | 'move' => {
    const distance = display.hitDistance
    const positions: Array<[CropHandle, number, number]> = [['nw', crop!.x, crop!.y], ['n', crop!.x + crop!.width / 2, crop!.y], ['ne', crop!.x + crop!.width, crop!.y], ['e', crop!.x + crop!.width, crop!.y + crop!.height / 2], ['se', crop!.x + crop!.width, crop!.y + crop!.height], ['s', crop!.x + crop!.width / 2, crop!.y + crop!.height], ['sw', crop!.x, crop!.y + crop!.height], ['w', crop!.x, crop!.y + crop!.height / 2]]
    return positions.find(([, px, py]) => Math.abs(px - x) <= distance && Math.abs(py - y) <= distance)?.[0] ?? 'move'
  }
  const pointer = (event: PointerEvent<SVGSVGElement>) => {
    if (status === 'uploading' || !crop || !imageSize) return
    const { x, y } = cropPointerToImage(event, event.currentTarget.getBoundingClientRect(), imageSize)
    if (event.type === 'pointerdown') { gesture.current = { x, y, crop, handle: handleAt(x, y) }; event.currentTarget.setPointerCapture(event.pointerId); return }
    const active = gesture.current
    if (event.type === 'pointermove' && active && event.currentTarget.hasPointerCapture(event.pointerId)) {
      const dx = x - active.x; const dy = y - active.y
      onCropChange(active.handle === 'move'
        ? moveCrop(active.crop, dx, dy, imageSize)
        : resizeCrop(active.crop, active.handle, dx, dy, imageSize))
    }
    if (event.type === 'pointerup' || event.type === 'pointercancel') gesture.current = null
  }
  if (!selectedFile || !previewURL || !imageSize || !crop) return null
  return <section className="import-workspace mx-auto grid w-full max-w-[1124px] grid-cols-[minmax(0,700px)_396px] gap-7 text-slate-800">
    <div className="workspace-card h-[780px] p-7">
      <div className="flex items-center justify-between"><div><h3 className="text-xl font-bold">确认户型区域</h3><p className="mt-1 text-sm text-slate-500">{status === 'uploading' ? '当前裁切区域已锁定，判断完成后可继续调整。' : '拖动裁切框或拖动四角和边缘，按方向键可微调。'}</p></div><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">原始像素</span></div>
      <svg tabIndex={status === 'uploading' ? -1 : 0} aria-label="户型裁切区域" aria-disabled={status === 'uploading'} className="crop-canvas mt-5" viewBox={`0 0 ${imageSize.width} ${imageSize.height}`} onPointerDown={pointer} onPointerMove={pointer} onKeyDown={(event) => { if (status === 'uploading') return; const next = cropKeyboardNudge(crop, event.key, imageSize, event.shiftKey ? 10 : 1); if (next) { event.preventDefault(); onCropChange(next) } }}>
        <image href={previewURL} width={imageSize.width} height={imageSize.height} />
        <path d={`M0 0H${imageSize.width}V${imageSize.height}H0ZM${crop.x} ${crop.y}H${crop.x + crop.width}V${crop.y + crop.height}H${crop.x}Z`} fill="rgba(15,23,42,.52)" fillRule="evenodd" />
        <rect data-testid="crop-selection" className="crop-selection-outline" x={crop.x} y={crop.y} width={crop.width} height={crop.height} fill="transparent" stroke="#5b5ce2" strokeWidth={display.strokeWidth} />
        {status !== 'uploading' && (['nw','n','ne','e','se','s','sw','w'] as CropHandle[]).map((handle) => { const x = handle.includes('w') ? crop.x : handle.includes('e') ? crop.x + crop.width : crop.x + crop.width / 2; const y = handle.includes('n') ? crop.y : handle.includes('s') ? crop.y + crop.height : crop.y + crop.height / 2; return <rect className="crop-selection-handle" data-crop-handle={handle} key={handle} x={x - display.handleSize / 2} y={y - display.handleSize / 2} width={display.handleSize} height={display.handleSize} fill="#fff" stroke="#5b5ce2" strokeWidth={display.strokeWidth / 2} /> })}
      </svg>
    </div>
    <aside className="workspace-card h-[780px] p-7"><h3 className="text-xl font-bold">选择后再继续</h3><p className="mt-2 text-sm leading-6 text-slate-500">只会把当前框选区域发送给 AI 识别。</p>
      {status !== 'uploading' && (detection?.candidates.length ? <div className="mt-6 space-y-2"><p className="text-sm font-semibold">推荐区域</p>{detection.candidates.map((candidate, index) => <button key={`${candidate.x}-${candidate.y}`} className="crop-candidate" type="button" onClick={() => onSelectCandidate(index)}>候选 {index + 1} · {candidate.width} × {candidate.height}</button>)}</div> : <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">无法可靠判断户型区域，请手动框选；默认已保留整张原图。</p>)}
      <div className="mt-6 grid grid-cols-2 gap-3"><button className="rounded-[10px] border border-violet-300 px-3 py-2 text-sm font-semibold text-violet-700 disabled:opacity-50" type="button" disabled={status === 'uploading'} onClick={onRestoreRecommended}>恢复推荐</button><button className="rounded-[10px] border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50" type="button" disabled={status === 'uploading'} onClick={onResetFullImage}>全图裁切</button></div>
      {status === 'uploading' && <div role="status" aria-live="polite" className="mt-4 rounded-[12px] border border-violet-200 bg-violet-50 p-4 text-violet-800">
        <div className="flex items-center gap-3"><span className="crop-judging-spinner" aria-hidden="true" /><span className="text-sm font-bold">正在判断当前裁切区域…</span></div>
        <p className="mt-2 pl-7 text-xs leading-5 text-violet-600">正在查找完整墙体、房间与门窗，请不要关闭页面。</p>
      </div>}
      {status !== 'uploading' && error && <p role="alert" className="mt-4 rounded-[10px] bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button className="crop-confirm-button mt-7 w-full rounded-[10px] bg-violet-600 px-4 py-3 text-sm font-semibold text-white" type="button" disabled={status === 'uploading'} onClick={onConfirm}>{status === 'uploading' ? '正在判断…' : '确认裁切并判断'}</button></aside>
  </section>
}
