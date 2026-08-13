import type { ProjectDetail } from './projects'
import type { ProjectSaveState } from './projectSession'
import type { ProjectConflictSelection, ProjectConflictState } from './projectSession'
import { ConflictControls } from './ProductViews'

export type ProjectSaveViewProps = {
  projectName: string
  currentProject: ProjectDetail | null
  projectMessage: string
  projectMessageTone: 'success' | 'error'
  projectBusy: 'save' | 'load' | null
  projectSaveState: ProjectSaveState
  projectConflict: ProjectConflictState | null
  canSave: boolean
  onProjectNameChange: (name: string) => void
  onSave: () => void
  onRetry: () => void
  onChooseConflict: (id: string, choice: ProjectConflictSelection) => void
  onResolveConflict: () => void
  onCopyResumeLink: () => void
}

export function ProjectSaveView({
  projectName,
  currentProject,
  projectMessage,
  projectBusy,
  projectSaveState,
  projectConflict,
  canSave,
  onProjectNameChange,
  onSave,
  onRetry,
  onChooseConflict,
  onResolveConflict,
  onCopyResumeLink,
}: ProjectSaveViewProps) {
  const visual = projectSaveState === 'saving'
    ? { label: projectMessage || '保存中…', panel: 'bg-blue-50 text-blue-600', button: 'bg-blue-600' }
    : projectSaveState === 'failed'
      ? { label: projectMessage || '保存失败', panel: 'bg-red-50 text-red-600', button: 'bg-red-600' }
      : projectSaveState === 'conflict'
        ? { label: projectMessage || '版本冲突', panel: 'bg-amber-50 text-amber-700', button: 'bg-amber-600' }
        : projectSaveState === 'saved'
          ? { label: projectMessage || '已保存', panel: 'bg-emerald-50 text-emerald-600', button: 'bg-emerald-600' }
          : { label: '准备保存', panel: 'bg-slate-100 text-slate-600', button: 'bg-violet-600' }
  return (
    <section className="workspace-card mx-auto w-full max-w-[990px] rounded-[20px] p-9 text-slate-800">
      <div data-testid="project-save-state" role={projectSaveState === 'failed' || projectSaveState === 'conflict' ? 'alert' : 'status'} className={`mx-auto grid h-[104px] w-[104px] place-items-center rounded-full px-3 text-center text-sm font-bold ${visual.panel}`}>{visual.label}</div>
      <h3 className="mt-5 text-center text-[28px] font-bold">保存为 HomeVox 项目</h3>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm leading-6 text-slate-500">真实户型图、可编辑 2D 与可编辑 3D 会归入同一个 HomeVox 项目。请复制继续编辑链接并妥善保管，获得链接的人可以访问和修改此项目。</p>
      <div className="mx-auto mt-7 grid max-w-[640px] gap-3">
        <input aria-label="项目名称" className="w-full rounded-[10px] border border-slate-300 bg-white px-3 py-3 text-slate-900" value={projectName} maxLength={120} placeholder="我的家 · 户型空间" onChange={(event) => onProjectNameChange(event.target.value)} />
        <button className={`w-full rounded-[10px] px-3 py-3 font-semibold text-white disabled:opacity-50 ${visual.button}`} type="button" disabled={!canSave || projectBusy !== null} onClick={onSave}>{projectBusy === 'save' ? '正在提交' : currentProject ? '保存项目' : '创建项目'}</button>
        {currentProject && projectSaveState === 'failed' && <button type="button" className="w-full rounded-[10px] border border-red-300 bg-white px-3 py-3 font-semibold text-red-700" disabled={projectBusy !== null} onClick={onRetry}>重试</button>}
        {currentProject && projectSaveState === 'conflict' && <ConflictControls conflict={projectConflict} busy={projectBusy !== null} onChoose={onChooseConflict} onResolve={onResolveConflict} />}
        {currentProject && <button className="w-full rounded-[10px] border border-violet-300 bg-white px-3 py-3 font-semibold text-violet-700 disabled:opacity-50" type="button" disabled={projectBusy !== null} onClick={onCopyResumeLink}>复制继续编辑链接</button>}
      </div>
    </section>
  )
}
