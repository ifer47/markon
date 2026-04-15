import { describe, it, expect, vi, afterEach } from 'vitest'
import { isMacOS } from './platform'

describe('isMacOS', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false when navigator is undefined', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isMacOS()).toBe(false)
  })

  it('returns true for macOS platform string', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' })
    expect(isMacOS()).toBe(true)
  })

  it('returns true for iPhone platform', () => {
    vi.stubGlobal('navigator', { platform: 'iPhone', userAgent: '' })
    expect(isMacOS()).toBe(true)
  })

  it('returns true for iPad platform', () => {
    vi.stubGlobal('navigator', { platform: 'iPad', userAgent: '' })
    expect(isMacOS()).toBe(true)
  })

  it('returns true for Mac OS in userAgent', () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    expect(isMacOS()).toBe(true)
  })

  it('returns false for Windows platform', () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    expect(isMacOS()).toBe(false)
  })

  it('returns false for Linux platform', () => {
    vi.stubGlobal('navigator', {
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    })
    expect(isMacOS()).toBe(false)
  })

  it('handles missing platform/userAgent gracefully', () => {
    vi.stubGlobal('navigator', {})
    expect(isMacOS()).toBe(false)
  })
})
