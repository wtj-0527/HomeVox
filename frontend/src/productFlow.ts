export const PRODUCT_STEPS = [
  { id: 1, label: '导入户型图', requiresDocument: false },
  { id: 2, label: 'AI 识别', requiresDocument: false },
  { id: 3, label: '校正 2D', requiresDocument: true },
  { id: 4, label: '生成 3D', requiresDocument: true },
  { id: 5, label: '2D/3D 联动', requiresDocument: true },
  { id: 6, label: '保存项目', requiresDocument: true },
] as const

export type ProductStep = (typeof PRODUCT_STEPS)[number]['id']

export function canOpenStep(step: ProductStep, hasDocument: boolean): boolean {
  const definition = PRODUCT_STEPS.find((item) => item.id === step)
  return Boolean(definition && (!definition.requiresDocument || hasDocument))
}

export function nextProductStep(step: ProductStep, hasDocument: boolean): ProductStep {
  const next = PRODUCT_STEPS.find((item) => item.id === step + 1)
  return next && canOpenStep(next.id, hasDocument) ? next.id : step
}

/** Completion is only set by a user-visible success transition, never merely
 * because a later document-gated view happens to be reachable. */
export function completeProductStep(completed: readonly ProductStep[], step: ProductStep): ProductStep[] {
  return Array.from(new Set([...completed, step])).sort((a, b) => a - b) as ProductStep[]
}

/** A reloaded persisted canonical document proves import and parsing occurred;
 * persistence itself also proves a previous explicit save. It does not invent
 * completion for the intermediate 2D/3D review transitions. */
export function initialCompletedSteps({
  hasCanonicalDocument,
  isSavedProject,
}: {
  hasCanonicalDocument: boolean
  isSavedProject: boolean
}): ProductStep[] {
  if (!hasCanonicalDocument) return []
  return isSavedProject ? [1, 2, 6] : [1, 2]
}
