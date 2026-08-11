import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config'

describe('development API proxy security contract', () => {
  it('preserves the browser-facing host for same-host CORS validation', () => {
    const proxy = viteConfig.server?.proxy?.['/api']
    expect(typeof proxy).toBe('object')
    expect(proxy && typeof proxy === 'object' ? proxy.changeOrigin : undefined).toBe(false)
  })
})
