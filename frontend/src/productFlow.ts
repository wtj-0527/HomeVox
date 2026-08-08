export const PRODUCT_STEPS = [
  { id: 1, label: '导入户型图' },
  { id: 2, label: 'AI 识别' },
  { id: 3, label: '校正 2D' },
  { id: 4, label: '生成 3D' },
  { id: 5, label: '2D/3D 联动' },
  { id: 6, label: '保存项目' },
] as const

export type ProductStep = (typeof PRODUCT_STEPS)[number]['id']

export type ProductFlowContext = {
  completed: readonly ProductStep[]
  hasDocument: boolean
  hasCanonicalGeometry: boolean
  hasThreeDGeometry: boolean
}

/** The sole navigation guard. A document can unlock 2D data, but never stands
 * in for the user's explicit 2D review, 3D confirmation, or linked review. */
export function canOpenStep(step: ProductStep, context: ProductFlowContext): boolean {
  const completed = new Set(context.completed)
  switch (step) {
    case 1: return true
    case 2: return completed.has(1)
    case 3: return completed.has(2) && context.hasDocument
    case 4: return completed.has(3) && context.hasCanonicalGeometry
    case 5: return completed.has(4) && context.hasCanonicalGeometry && context.hasThreeDGeometry
    case 6: return completed.has(5) && context.hasDocument
  }
}

export function nextProductStep(step: ProductStep, context: ProductFlowContext): ProductStep {
  const next = PRODUCT_STEPS.find((item) => item.id === step + 1)
  return next && canOpenStep(next.id, context) ? next.id : step
}

/** Completion is only set by a user-visible success transition, never merely
 * because a later document-gated view happens to be reachable. */
export function completeProductStep(completed: readonly ProductStep[], step: ProductStep): ProductStep[] {
  return Array.from(new Set([...completed, step])).sort((a, b) => a - b) as ProductStep[]
}

/** A reloaded saved canonical document proves import/parsing and explicit save.
 * It deliberately does not manufacture 2D, 3D, or linked-review completion. */
export function initialCompletedSteps({
  hasCanonicalDocument,
  isSavedProject,
}: {
  hasCanonicalDocument: boolean
  isSavedProject: boolean
}): ProductStep[] {
  void isSavedProject
  if (!hasCanonicalDocument) return []
  return [1, 2]
}

export type ProductFlowEvent =
  | { type: 'open'; step: ProductStep }
  | { type: 'complete'; step: ProductStep; next?: ProductStep }
  | { type: 'reload'; completed: readonly ProductStep[] }
export type ProductFlowState = { activeStep: ProductStep; completed: readonly ProductStep[] }

/** Admission predicate shared by clickable navigation, completion controls, and
 * the reducer-like transition.  In particular, Step 5 can only complete while
 * its currently mounted renderer is admitted through hasThreeDGeometry. */
export function canApplyProductFlowEvent(
  state: ProductFlowState,
  event: Exclude<ProductFlowEvent, { type: 'reload' }>,
  context: Omit<ProductFlowContext, 'completed'>,
): boolean {
  const flow = { ...context, completed: state.completed }
  if (event.type === 'open') return canOpenStep(event.step, flow)
  if (state.activeStep !== event.step || !canOpenStep(event.step, flow)) return false
  if (!event.next) return true
  const completed = completeProductStep(state.completed, event.step)
  return canOpenStep(event.next, { ...context, completed })
}

/** The only transition entrance for sidebar, completion buttons, and reload. */
export function transitionProductFlow(state: ProductFlowState, event: ProductFlowEvent, context: Omit<ProductFlowContext, 'completed'>): ProductFlowState {
  if (event.type === 'reload') return { activeStep: event.completed.includes(3) ? 3 : 1, completed: [...event.completed] }
  if (!canApplyProductFlowEvent(state, event, context)) return state
  if (event.type === 'open') return { ...state, activeStep: event.step }
  const completed = completeProductStep(state.completed, event.step)
  const next = event.next ?? nextProductStep(event.step, { ...context, completed })
  return next !== event.step && canOpenStep(next, { ...context, completed }) ? { activeStep: next, completed } : { activeStep: event.step, completed }
}
