export type KnowledgeState = 'pending' | 'notMeasured' | 'notRecognized'

export const PRODUCT_LANGUAGE = {
  knowledge: {
    pending: '待确认',
    notMeasured: '尚未测量',
    notRecognized: '未识别',
  } satisfies Record<KnowledgeState, string>,
  object: {
    wall: '墙体',
    door: '门洞',
    window: '窗洞',
    none: '未选择对象',
  },
  selection: {
    wall: '已选择墙体',
    door: '已选择门洞',
    window: '已选择窗洞',
  },
  render: {
    ready: '空间预览已就绪',
    preparing: '正在准备空间预览',
  },
} as const

const ENGINEERING_LEAK = /\b(?:unknown|canonical|wasm|renderer|revision|fallback|review|gate|json|raw|door|window|undo|redo|calls|timing)\b|未持久化|工程诊断|内部 ID/i

/** Product copy is deliberately separate from durable internal terms. */
export function isCustomerFacingCopy(value: string): boolean {
  return !ENGINEERING_LEAK.test(value)
}
