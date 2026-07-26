type ParseFailure = { code?: unknown }

function errorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const code = (body as ParseFailure).code
  return typeof code === 'string' ? code : null
}

/** Maps public parse failure codes to action-oriented customer feedback.
 * API diagnostics stay out of the ordinary product UI. */
export function parseFailureMessage(status: number, body: unknown): string {
  switch (errorCode(body)) {
    case 'ai_schema_invalid':
      return '识别结果格式不完整，未生成可编辑户型。请裁切后上传更清晰的纯户型图。'
    case 'ai_content_unreliable':
      return '这张图片中的户型边界无法可靠识别。请裁切到单个户型或上传更清晰的平面图。'
    case 'ai_transport_unavailable':
      return '识别服务暂时不可用，请稍后重试。'
    default:
      return status >= 500
        ? '识别服务暂时不可用，请稍后重试。'
        : '这张图片暂时无法识别，请裁切后上传更清晰的纯户型图。'
  }
}

/** Feedback after the user has already confirmed a crop. Avoid telling them to
 * repeat the same action; explain the actual reliability boundary instead. */
export function parseRetryFailureMessage(status: number, body: unknown): string {
  if (errorCode(body) === 'ai_content_unreliable') {
    return '当前裁切区域仍缺少完整、无遮挡的墙体边界，无法可靠生成可编辑户型。请继续调整裁切区域，或上传原始、清晰且无遮挡的平面图。'
  }
  return parseFailureMessage(status, body)
}

export function parseNetworkFailureMessage(): string {
  return '网络连接暂时不可用，请检查连接后重试。'
}
