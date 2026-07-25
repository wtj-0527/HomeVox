import type { ProjectDetail, ProjectSummary } from './projects'

export type ProjectSaveViewProps = {
  projectName: string
  currentProject: ProjectDetail | null
  projects: readonly ProjectSummary[]
  projectMessage: string
  projectBusy: 'list' | 'save' | 'load' | null
  canSave: boolean
  onProjectNameChange: (name: string) => void
  onSave: () => void
  onRefresh: () => void
  onLoad: (id: string) => void
}

export function ProjectSaveView({
  projectName,
  currentProject,
  projects,
  projectMessage,
  projectBusy,
  canSave,
  onProjectNameChange,
  onSave,
  onRefresh,
  onLoad,
}: ProjectSaveViewProps) {
  return (
    <section className="workspace-card mx-auto w-full max-w-[990px] rounded-[20px] p-9 text-slate-800">
      <div className="mx-auto grid h-[104px] w-[104px] place-items-center rounded-full bg-emerald-50 text-4xl font-bold text-emerald-600">✓</div>
      <h3 className="mt-5 text-center text-[28px] font-bold">保存为 HomeVox 项目</h3>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm leading-6 text-slate-500">真实户型图、可编辑 2D 与可编辑 3D 会归入同一个 HomeVox 项目，可以随时继续编辑。</p>
      <div className="mx-auto mt-7 grid max-w-[640px] gap-3">
        <input aria-label="项目名称" className="w-full rounded-[10px] border border-slate-300 bg-white px-3 py-3 text-slate-900" value={projectName} maxLength={120} placeholder="我的家 · 户型空间" onChange={(event) => onProjectNameChange(event.target.value)} />
        <button className="w-full rounded-[10px] bg-violet-600 px-3 py-3 font-semibold text-white disabled:opacity-50" type="button" disabled={!canSave || projectBusy !== null} onClick={onSave}>{projectBusy === 'save' ? '保存中…' : currentProject ? '保存项目' : '创建项目'}</button>
        {projectMessage && <p role="status" className="text-sm text-slate-700">{projectMessage}</p>}
        <div className="mt-3 border-t border-slate-200 pt-4">
          <div className="mb-2 flex items-center justify-between"><h4 className="font-semibold">已保存项目</h4><button className="rounded-[10px] border border-slate-300 px-3 py-2 text-xs font-semibold" type="button" disabled={projectBusy !== null} onClick={onRefresh}>{projectBusy === 'list' ? '刷新中…' : '刷新'}</button></div>
          <ul className="space-y-2" aria-label="已保存项目">{projects.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 rounded-[10px] bg-slate-50 p-3"><span className="font-medium">{item.name}</span><button className="rounded-[10px] bg-violet-600 px-3 py-2 text-xs font-semibold text-white" type="button" disabled={projectBusy !== null} onClick={() => onLoad(item.id)}>继续编辑</button></li>)}{projects.length === 0 && <li className="text-sm text-slate-500">保存后会在这里显示你的项目。</li>}</ul>
        </div>
      </div>
    </section>
  )
}
