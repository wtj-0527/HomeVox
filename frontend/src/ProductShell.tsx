import type { ReactNode } from 'react'
import { PRODUCT_STEPS, canOpenStep, type ProductFlowContext, type ProductStep } from './productFlow'

type Props = {
  activeStep: ProductStep
  completedSteps: readonly ProductStep[]
  flow: ProductFlowContext
  hasDocument: boolean
  onOpenStep: (step: ProductStep) => void
  primaryAction?: ReactNode
  children: ReactNode
}

export function ProductShell({ activeStep, completedSteps, flow, hasDocument, onOpenStep, primaryAction, children }: Props) {
  return <div className="homevox-app min-h-screen"><div className="homevox-layout grid min-h-screen grid-cols-[248px_minmax(0,1fr)]">
    <aside className="product-sidebar flex flex-col px-4 py-6"><div className="mb-8 px-2"><p className="text-xs font-semibold tracking-[0.22em] text-indigo-200">HOMEVOX</p><h1 className="mt-2 text-xl font-bold">筑居</h1><p className="mt-2 text-xs leading-5 text-indigo-100/75">从真实户型图到可编辑空间</p></div><nav className="space-y-2" aria-label="产品步骤">{PRODUCT_STEPS.map((step) => {
      const unlocked = canOpenStep(step.id, flow)
      const completed = completedSteps.includes(step.id)
      const stateLabel = [activeStep === step.id ? '当前步骤' : '', completed ? '已完成' : '', !completed && activeStep !== step.id ? (unlocked ? '可进入' : '未解锁') : ''].filter(Boolean).join('，')
      return <button key={step.id} className="product-step flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium disabled:cursor-not-allowed" type="button" data-active={activeStep === step.id} data-completed={completed} data-locked={!unlocked} aria-current={activeStep === step.id ? 'step' : undefined} aria-label={`${step.label}，${stateLabel}`} disabled={!unlocked} onClick={() => onOpenStep(step.id)}><span className="step-dot" aria-hidden="true">{completed ? '✓' : step.id}</span><span>{step.label}</span><span className="sr-only">{stateLabel}</span></button>
    })}</nav><div className="mt-auto rounded-xl border border-white/10 bg-white/8 p-3 text-xs leading-5 text-indigo-100/80">空间设计沟通工具，不是施工 CAD。未知建筑属性会保持未知，需现场实测。</div></aside>
    <div className="flex min-h-screen min-w-0 flex-col"><header className="product-topbar flex min-h-[72px] items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-8"><div><p className="text-xs font-medium text-violet-600">步骤 {activeStep} / 6</p><h2 className="mt-1 text-lg font-bold text-slate-900">{PRODUCT_STEPS[activeStep - 1].label}</h2></div><div className="flex items-center gap-2">{hasDocument && <span className="status-chip px-3 py-1.5 text-xs font-medium">同一份空间数据</span>}{primaryAction}</div></header><div className="min-h-0 flex-1 p-4">{children}</div></div>
  </div></div>
}
