export type ParseViewStatus = 'idle' | 'uploading' | 'ready' | 'error'

type SourceFileProps = {
  selectedFile: File | null
  previewURL: string
  onFileChange: (file: File | null) => void
}

function SourcePreview({ selectedFile, previewURL, onFileChange }: SourceFileProps) {
  if (!selectedFile || !previewURL) return null
  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label="已选择的户型图">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-800">原图预览</p>
          <p className="mt-1 text-xs text-slate-500">{selectedFile.name} · {selectedFile.type || '未知类型'} · {selectedFile.size.toLocaleString()} bytes</p>
        </div>
        <label className="cursor-pointer rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-700">
          重新选择
          <input className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} />
        </label>
      </div>
      <img className="mt-3 max-h-72 w-full rounded-lg bg-white object-contain" src={previewURL} alt="上传户型图预览" />
    </section>
  )
}

export function SourceImportView({ selectedFile, previewURL, onFileChange }: SourceFileProps) {
  return (
    <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800">
      <h3 className="text-xl font-semibold">导入真实户型图</h3>
      <p className="mt-2 text-sm text-slate-500">从你的图纸开始，不套用示意户型。</p>
      <label className="mt-6 block cursor-pointer rounded-xl border border-dashed border-slate-400 bg-slate-50 p-5 text-sm hover:border-violet-500">
        <span className="block font-medium">选择户型图</span>
        <span className="mt-1 block text-xs text-slate-500">支持 PNG、JPEG、GIF、WebP；后端限制 10 MiB</span>
        <input className="mt-3 block w-full text-xs" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} />
      </label>
      <SourcePreview selectedFile={selectedFile} previewURL={previewURL} onFileChange={onFileChange} />
    </section>
  )
}

export type AIParseViewProps = SourceFileProps & {
  status: ParseViewStatus
  error: string
  onParse: () => void
}

export function AIParseView({ selectedFile, previewURL, onFileChange, status, error, onParse }: AIParseViewProps) {
  return (
    <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800">
      <h3 className="text-xl font-semibold">AI 识别</h3>
      <p className="mt-2 text-sm text-slate-500">识别前请核对这张原图；识别完成后才会打开可校正的同源 2D 数据。</p>
      <SourcePreview selectedFile={selectedFile} previewURL={previewURL} onFileChange={onFileChange} />
      <button className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" type="button" disabled={status === 'uploading' || !selectedFile} onClick={onParse}>{status === 'uploading' ? 'AI 识别中…' : '开始 AI 识别'}</button>
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><span className="text-slate-500">识别状态：</span>{status === 'ready' ? '解析完成' : status === 'uploading' ? '解析中' : status === 'error' ? '失败' : '等待开始'}{error && <p role="alert" className="mt-2 text-red-700">{error}</p>}</div>
      {status === 'error' && selectedFile && <button type="button" className="mt-3 rounded-lg border border-violet-300 px-3 py-2 text-sm text-violet-700" onClick={onParse}>重试 AI 识别</button>}
    </section>
  )
}
