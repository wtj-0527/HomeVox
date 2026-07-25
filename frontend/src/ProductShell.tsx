import type { ReactNode } from 'react'
import { PRODUCT_STEPS, canOpenStep, type ProductFlowContext, type ProductStep } from './productFlow'
import { PRODUCT_STATE_COPY } from './productDesign'

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
  const copy = PRODUCT_STATE_COPY[activeStep]
  return <div className="homevox-app min-h-screen"><div className="homevox-layout grid min-h-screen grid-cols-[232px_minmax(0,1fr)]">
    <aside data-testid="product-sidebar" className="product-sidebar flex flex-col px-4 py-5"><div className="mb-9 px-2"><div className="flex items-center gap-2.5"><span className="brand-mark" aria-hidden="true">⌂</span><h1 className="text-xl font-bold tracking-tight">HomeVox</h1></div></div><p className="mb-5 px-2 text-xs font-semibold text-slate-400">把户型变成可编辑空间</p><nav className="space-y-2" aria-label="产品步骤">{PRODUCT_STEPS.map((step) => {
      const unlocked = canOpenStep(step.id, flow)
      const completed = completedSteps.includes(step.id)
      const stateLabel = [activeStep === step.id ? '当前步骤' : '', completed ? '已完成' : '', !completed && activeStep !== step.id ? (unlocked ? '可进入' : '未解锁') : ''].filter(Boolean).join('，')
      return <button key={step.id} className="product-step flex w-full items-center gap-3 rounded-[10px] px-4 py-3 text-left text-sm font-medium disabled:cursor-not-allowed" type="button" data-active={activeStep === step.id} data-completed={completed} data-locked={!unlocked} aria-current={activeStep === step.id ? 'step' : undefined} aria-label={`${step.label}，${stateLabel}`} disabled={!unlocked} onClick={() => onOpenStep(step.id)}><span className="step-dot" aria-hidden="true">{completed ? '✓' : step.id}</span><span>{step.label}</span><span className="sr-only">{stateLabel}</span></button>
    })}</nav><div className="mt-auto px-2 text-xs leading-5 text-slate-300"><p className="font-semibold text-slate-400">同一个 HomeVox 项目</p><p className="mt-1">2D 与 3D 共用同一份空间数据</p></div></aside>
    <div className="flex min-h-screen min-w-0 flex-col"><header data-testid="product-topbar" className="product-topbar flex h-[72px] items-center justify-between border-b border-slate-200 bg-white px-6"><div><h2 className="text-xl font-bold text-slate-900">{copy.title}</h2><p className="mt-0.5 text-xs text-slate-500">{copy.subtitle}</p></div><div className="flex items-center gap-2">{hasDocument && <span className="status-chip px-3 py-1.5 text-xs font-semibold">同一份空间数据</span>}<span className="autosave-chip px-3 py-1.5 text-xs font-semibold">自动保存</span>{primaryAction}</div></header><div className="min-h-0 flex-1 p-5">{children}</div></div>
  </div></div>
}
