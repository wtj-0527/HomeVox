import { describe, expect, it } from 'vitest'
import { parseFailureMessage } from './parseFeedback'

describe('parse feedback contract', () => {
  it('separates unavailable transport from invalid AI output and unreliable image content', () => {
    expect(parseFailureMessage(503, { code: 'ai_transport_unavailable' })).toContain('稍后重试')
    expect(parseFailureMessage(422, { code: 'ai_schema_invalid' })).toContain('格式不完整')
    expect(parseFailureMessage(422, { code: 'ai_content_unreliable' })).toContain('裁切')
    expect(parseFailureMessage(502, {})).not.toContain('检查网络')
  })
})
