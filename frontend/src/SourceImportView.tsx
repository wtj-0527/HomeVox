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
  onParse: () => void
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

export function SourceImportView({ selectedFile, previewURL, onFileChange, status, error, onParse }: SourceImportViewProps) {
  if (!selectedFile || !previewURL) {
    return (
      <section className="workspace-card mx-auto w-full max-w-[760px] p-7 text-slate-800">
        <h3 className="text-xl font-bold">导入真实户型图</h3>
        <p className="mt-2 text-sm text-slate-500">从你的图纸开始，不套用示意户型。</p>
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
        <button className="mt-8 w-full rounded-[10px] bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" type="button" disabled={status === 'uploading'} onClick={onParse}>{status === 'uploading' ? 'AI 识别中…' : '开始 AI 识别'}</button>
        <label className="mt-3 block cursor-pointer rounded-[10px] border border-violet-300 px-4 py-3 text-center text-sm font-semibold text-violet-700">重新选择图纸<input className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} /></label>
      </aside>
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
      <p className="mt-2 text-sm text-slate-500">识别前请核对这张原图；完成后可在平面图上继续调整。</p>
      <SourcePreview selectedFile={selectedFile} previewURL={previewURL} onFileChange={onFileChange} />
      <button className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" type="button" disabled={status === 'uploading' || !selectedFile} onClick={onParse}>{status === 'uploading' ? 'AI 识别中…' : '开始 AI 识别'}</button>
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><span className="text-slate-500">识别状态：</span>{status === 'ready' ? '解析完成' : status === 'uploading' ? '解析中' : status === 'error' ? '失败' : '等待开始'}{error && <p role="alert" className="mt-2 text-red-700">{error}</p>}</div>
      {status === 'error' && selectedFile && <button type="button" className="mt-3 rounded-lg border border-violet-300 px-3 py-2 text-sm text-violet-700" onClick={onParse}>重试 AI 识别</button>}
    </section>
  )
}
