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
    <section className="workspace-card mx-auto w-full max-w-2xl p-6 text-slate-800">
      <h3 className="text-xl font-semibold">保存项目</h3>
      <p className="mt-2 text-sm text-slate-500">手动保存当前同源 2D 与 3D 数据。保存不可用时会保留当前编辑，不会假装成功。</p>
      <div className="mt-6 space-y-3">
        <input aria-label="项目名称" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" value={projectName} maxLength={120} placeholder="项目名称" onChange={(event) => onProjectNameChange(event.target.value)} />
        <button className="w-full rounded-lg bg-violet-600 px-3 py-2 font-medium text-white disabled:opacity-50" type="button" disabled={!canSave || projectBusy !== null} onClick={onSave}>{projectBusy === 'save' ? '保存中…' : currentProject ? `保存项目（r${currentProject.revision}）` : '创建项目'}</button>
        {projectMessage && <p role="status" className="text-sm text-slate-700">{projectMessage}</p>}
        <div className="border-t border-slate-200 pt-4">
          <div className="mb-2 flex items-center justify-between"><h4 className="font-semibold">已保存项目</h4><button className="rounded-md border border-slate-300 px-2 py-1 text-xs" type="button" disabled={projectBusy !== null} onClick={onRefresh}>{projectBusy === 'list' ? '刷新中…' : '刷新'}</button></div>
          <ul className="space-y-2" aria-label="已保存项目">{projects.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2"><span>{item.name} <span className="text-slate-500">r{item.revision}</span></span><button className="rounded-md bg-sky-700 px-2 py-1 text-xs text-white" type="button" disabled={projectBusy !== null} onClick={() => onLoad(item.id)}>加载</button></li>)}{projects.length === 0 && <li className="text-sm text-slate-500">暂无已保存项目</li>}</ul>
        </div>
      </div>
    </section>
  )
}
