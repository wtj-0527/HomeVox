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
