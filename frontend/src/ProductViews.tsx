import type { ReactNode } from 'react'

export function TwoDWorkspace({ editor, inspector }: { editor: ReactNode; inspector: ReactNode }) {
  return <div className="workspace-grid product-workspace">{editor}{inspector}</div>
}

export function ThreeDConfirmation({ preview, unavailable, canOpenLinkedWorkspace, onBack, onComplete }: { preview: ReactNode; unavailable: ReactNode; canOpenLinkedWorkspace: boolean; onBack: () => void; onComplete: () => void }) {
  return <section className="mx-auto max-w-5xl"><div className="mb-4 flex items-center justify-between rounded-xl bg-white p-4 shadow-sm"><div><h3 className="font-semibold text-slate-900">确认 3D 空间</h3><p className="mt-1 text-sm text-slate-500">这是同一份已校正 2D 数据生成的真实 3D 预览。</p></div><div className="flex gap-2"><button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={onBack}>返回 2D 校正</button>{canOpenLinkedWorkspace && <button type="button" className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white" onClick={onComplete}>完成并打开 3D</button>}</div></div>{canOpenLinkedWorkspace ? preview : unavailable}</section>
}

export function LinkedWorkspace({ editor, preview, inspector, available, onBack }: { editor: ReactNode; preview: ReactNode; inspector: ReactNode; available: boolean; onBack: () => void }) {
  if (!available) return <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800" role="alert"><h3 className="text-lg font-semibold">当前 3D 预览不可用</h3><p className="mt-2 text-sm text-slate-600">联动工作台已关闭，请先返回 2D 校正。</p><button type="button" className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={onBack}>返回 2D 校正</button></section>
  return <div className="workspace-grid product-workspace product-workspace-linked">{editor}{preview}{inspector}</div>
}
