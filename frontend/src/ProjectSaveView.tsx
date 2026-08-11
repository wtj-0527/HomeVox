import type { ProjectDetail } from './projects'

export type ProjectSaveViewProps = {
  projectName: string
  currentProject: ProjectDetail | null
  projectMessage: string
  projectMessageTone: 'success' | 'error'
  projectBusy: 'save' | 'load' | null
  canSave: boolean
  onProjectNameChange: (name: string) => void
  onSave: () => void
  onCopyResumeLink: () => void
}

export function ProjectSaveView({
  projectName,
  currentProject,
  projectMessage,
  projectMessageTone,
  projectBusy,
  canSave,
  onProjectNameChange,
  onSave,
  onCopyResumeLink,
}: ProjectSaveViewProps) {
  return (
    <section className="workspace-card mx-auto w-full max-w-[990px] rounded-[20px] p-9 text-slate-800">
      <div className="mx-auto grid h-[104px] w-[104px] place-items-center rounded-full bg-emerald-50 text-4xl font-bold text-emerald-600">✓</div>
      <h3 className="mt-5 text-center text-[28px] font-bold">保存为 HomeVox 项目</h3>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm leading-6 text-slate-500">真实户型图、可编辑 2D 与可编辑 3D 会归入同一个 HomeVox 项目。请复制继续编辑链接并妥善保管，获得链接的人可以访问和修改此项目。</p>
      <div className="mx-auto mt-7 grid max-w-[640px] gap-3">
        <input aria-label="项目名称" className="w-full rounded-[10px] border border-slate-300 bg-white px-3 py-3 text-slate-900" value={projectName} maxLength={120} placeholder="我的家 · 户型空间" onChange={(event) => onProjectNameChange(event.target.value)} />
        <button className="w-full rounded-[10px] bg-violet-600 px-3 py-3 font-semibold text-white disabled:opacity-50" type="button" disabled={!canSave || projectBusy !== null} onClick={onSave}>{projectBusy === 'save' ? '保存中…' : currentProject ? '保存项目' : '创建项目'}</button>
        {currentProject && <button className="w-full rounded-[10px] border border-violet-300 bg-white px-3 py-3 font-semibold text-violet-700 disabled:opacity-50" type="button" disabled={projectBusy !== null} onClick={onCopyResumeLink}>复制继续编辑链接</button>}
        {projectMessage && <p role={projectMessageTone === 'error' ? 'alert' : 'status'} className={`text-sm ${projectMessageTone === 'error' ? 'text-red-700' : 'text-slate-700'}`}>{projectMessage}</p>}
      </div>
    </section>
  )
}
