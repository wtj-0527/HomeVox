import { describe, expect, it } from 'vitest'
import { projectSaveIssue } from './projectSession'
import type { ProjectDetail } from './projects'

const document = {
  filename: 'plan.png',
  contentType: 'image/png',
  size: 12,
  result: { rooms: [], walls: [], doors: [], windows: [], scale: { unit: 'px' }, metadata: { source: 'fixture' } },
}

const project: ProjectDetail = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Home',
  revision: 2,
  createdAt: '2026-07-20T00:00:00Z',
  updatedAt: '2026-07-20T00:00:00Z',
  sourceImageURL: '/api/projects/00000000-0000-0000-0000-000000000001/source-image',
  sourceImageContentType: 'image/png',
  sourceImageSize: 12,
  document,
}

describe('project session save admission', () => {
  it('fails closed before persistence if the canonical document is absent or invalid', () => {
    expect(projectSaveIssue({ document: null, geometryValidationError: null, projectName: 'Home', currentProject: null, sourceFile: null })).toContain('完成户型解析')
    expect(projectSaveIssue({ document, geometryValidationError: 'wall-1 长度为零', projectName: 'Home', currentProject: null, sourceFile: new File(['png'], 'plan.png') })).toContain('几何无效')
  })

  it('requires a source image only for a newly created project, never for updating a loaded project', () => {
    expect(projectSaveIssue({ document, geometryValidationError: null, projectName: ' ', currentProject: project, sourceFile: null })).toContain('项目名称')
    expect(projectSaveIssue({ document, geometryValidationError: null, projectName: 'Home', currentProject: null, sourceFile: null })).toContain('原始户型图')
    expect(projectSaveIssue({ document, geometryValidationError: null, projectName: 'Home', currentProject: project, sourceFile: null })).toBeNull()
  })
})
