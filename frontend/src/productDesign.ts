/** Values transcribed from the active authoritative Penpot page
 * “户型数字化主流程”, not invented by the implementation. */
export const PRODUCT_DESIGN = {
  viewport: { width: 1440, height: 960 },
  sidebarWidth: 232,
  topbarHeight: 72,
  workspaceGap: 16,
  radius: { control: 10, card: 16, successCard: 20, chip: 14 },
  color: {
    appBackground: '#f4f6fa',
    sidebar: '#182033',
    sidebarActive: '#2a3454',
    ink: '#182033',
    muted: '#667085',
    border: '#dde2ea',
    violet: '#5b5ce2',
    violetSoft: '#eef0ff',
    success: '#1f9d70',
    successSoft: '#eaf8f2',
    information: '#2f7de1',
    informationSoft: '#eaf3ff',
    unknown: '#d98b21',
    unknownSoft: '#fff5e5',
  },
} as const

export const PRODUCT_STATE_COPY = {
  1: {
    title: '导入真实户型图',
    subtitle: '从你家的真实图纸开始，不套用示意户型',
    knowledge: '朝向尚未识别；层高 / 墙高尚未测量',
  },
  2: {
    title: 'AI 正在识别户型',
    subtitle: '先识别，再由你确认；未确认数据不会自动写成真实值',
    knowledge: '尚未确认的信息会保持待确认状态',
  },
  3: {
    title: '校正可编辑 2D',
    subtitle: '原图底稿与识别层在同一视口；拖动、补画、确认都直接作用于你的项目',
    knowledge: '朝向、墙厚和承重属性仍待确认，不会自动确认。',
  },
  4: {
    title: '生成可编辑 3D',
    subtitle: '从已校正的 2D 结构立起同一空间；不是另画一套模型',
    knowledge: '层高 / 墙高尚未测量，当前仅用于空间查看。',
  },
  5: {
    title: '2D / 3D 联动编辑',
    subtitle: '两个视图编辑同一个 HomeVox 项目，不是两套设计',
    knowledge: '当前修改不会自动确认属性，相关信息仍待确认。',
  },
  6: {
    title: '保存为 HomeVox 项目',
    subtitle: '你的 2D 与 3D 已保存在同一个项目中，可以随时继续编辑',
    knowledge: '未确认的信息仍会保持待确认状态',
  },
} as const
