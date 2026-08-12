import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceToolbar } from './ProductViews'
import { InspectorPanel, type InspectorPanelProps } from './InspectorPanel'
import { ProductShell } from './ProductShell'
import { ProjectSaveView } from './ProjectSaveView'

const inspector: InspectorPanelProps = {
  selectedWallID: null,
  selectedOpening: null,
  openingError: '',
  canExport2D: false,
  canExport3D: false,
  exportingScope: null,
  exportError: '',
  canUndo: false,
  canRedo: false,
  onAddOpening: vi.fn(),
  onOpeningWidthChange: vi.fn(),
  onDeleteOpening: vi.fn(),
  onExport2D: vi.fn(),
  onExport3D: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
}

describe('2D recognition snapshot controls', () => {
  it('offers creation before 3D and explicit updates after the snapshot exists', () => {
    const create = renderToStaticMarkup(createElement(WorkspaceToolbar, { inspector, canAdvance: true, onAdvance: vi.fn(), snapshot: { exists: false, busy: false, message: '', messageTone: 'success', saveState: 'idle', onSave: vi.fn(), onRetry: vi.fn(), onReload: vi.fn(), onCopyResumeLink: vi.fn() } }))
    expect(create).toContain('创建识别快照')
    expect(create).not.toContain('复制编辑链接')

    const update = renderToStaticMarkup(createElement(WorkspaceToolbar, { inspector, canAdvance: true, onAdvance: vi.fn(), snapshot: { exists: true, busy: false, message: '已保存', messageTone: 'success', saveState: 'saved', onSave: vi.fn(), onRetry: vi.fn(), onReload: vi.fn(), onCopyResumeLink: vi.fn() } }))
    expect(update).not.toContain('保存当前修改')
    expect(update).toContain('已保存')
    expect(update).toContain('复制编辑链接')
  })

  it('renders revision conflict as an error with an explicit latest-version recovery', () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceToolbar, { inspector, canAdvance: true, onAdvance: vi.fn(), snapshot: { exists: true, busy: false, message: '项目已在其他页面更新，请加载最新版本后再保存', messageTone: 'error', saveState: 'conflict', onSave: vi.fn(), onRetry: vi.fn(), onReload: vi.fn(), onCopyResumeLink: vi.fn() } }))
    expect(markup).toContain('text-red-700')
    expect(markup).toContain('加载最新版本')
    expect(markup).not.toContain('00000000-')
  })
})

describe('selected wall coordinate editor', () => {
  it('shows four exact source-pixel coordinates and an explicit apply action', () => {
    const markup = renderToStaticMarkup(createElement(InspectorPanel, {
      ...inspector,
      selectedWallID: 'wall-a',
      selectedWall: { id: 'wall-a', x1: 10, y1: 20, x2: 30, y2: 40 },
      onWallCoordinatesChange: vi.fn(),
    }))

    expect(markup).toContain('起点 X')
    expect(markup).toContain('起点 Y')
    expect(markup).toContain('终点 X')
    expect(markup).toContain('终点 Y')
    expect(markup).toContain('应用坐标')
  })
})

describe('product save disclosure', () => {
  it('does not claim automatic persistence for a browser-only document', () => {
    const markup = renderToStaticMarkup(createElement(ProductShell, {
      activeStep: 3,
      completedSteps: [1, 2],
      flow: { completed: [1, 2], hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: false },
      hasDocument: true,
      onOpenStep: vi.fn(),
    }, 'editor'))
    expect(markup).not.toContain('修改需手动保存')
  })

  it('offers explicit secure resume-link copying without a global project list', () => {
    const markup = renderToStaticMarkup(createElement(ProjectSaveView, {
      projectName: 'Home',
      currentProject: {
        id: '00000000-0000-0000-0000-000000000001', name: 'Home', revision: 1,
        createdAt: '2026-07-20T00:00:00Z', updatedAt: '2026-07-20T00:00:00Z',
        sourceImageURL: '/api/projects/00000000-0000-0000-0000-000000000001/source-image',
        sourceImageContentType: 'image/png', sourceImageSize: 3,
        document: { filename: 'plan.png', contentType: 'image/png', size: 3, result: { rooms: [], walls: [], doors: [], windows: [], scale: { unit: 'px', pixel_to_unit: null }, metadata: { source: 'fixture', confidence: 0.5, image_width: 100, image_height: 80 } } },
      },
      projectMessage: '', projectMessageTone: 'success', projectBusy: null, canSave: true,
      onProjectNameChange: vi.fn(), onSave: vi.fn(), onCopyResumeLink: vi.fn(),
    }))
    expect(markup).toContain('复制继续编辑链接')
    expect(markup).not.toContain('已保存项目')
    expect(markup).not.toContain('刷新')
    expect(markup).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  })
})
