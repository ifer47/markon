import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.stubGlobal('navigator', { language: 'en' })

const { useI18n } = await import('./index')

describe('useI18n', () => {
  describe('locale detection', () => {
    it('exposes current locale', () => {
      const { locale } = useI18n()
      expect(locale.locale).toBeDefined()
    })
  })

  describe('t() path resolution', () => {
    it('resolves a simple dot-path key', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      expect(t('tools.pen')).toBe('Pen')
    })

    it('resolves nested keys', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      expect(t('settings.tabs.general')).toBe('General')
    })

    it('returns the raw path for a missing key', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      expect(t('nonexistent.deep.path')).toBe('nonexistent.deep.path')
    })

    it('returns the raw path when intermediate key is not an object', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      // tools.pen is a string, so tools.pen.deeper should fail
      expect(t('tools.pen.deeper')).toBe('tools.pen.deeper')
    })

    it('returns the raw path for an empty string', () => {
      const { t } = useI18n()
      expect(t('')).toBe('')
    })
  })

  describe('locale switching', () => {
    it('returns Chinese for zh-CN locale', () => {
      const { locale, t } = useI18n()
      locale.locale = 'zh-CN'
      expect(t('tools.pen')).toBe('画笔')
      expect(t('tools.eraser')).toBe('橡皮擦')
    })

    it('returns English for en locale', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      expect(t('tools.pen')).toBe('Pen')
      expect(t('tools.eraser')).toBe('Eraser')
    })

    it('falls back to English for unknown locale', () => {
      const { locale, t } = useI18n()
      locale.locale = 'fr'
      expect(t('tools.pen')).toBe('Pen')
    })
  })

  describe('variable substitution', () => {
    it('replaces {var} placeholders', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      const result = t('settings.shortcutsConflict', { keys: 'Ctrl+A' })
      expect(result).toBe('These shortcuts are occupied: Ctrl+A')
    })

    it('replaces {mod} placeholder in comboRequirement', () => {
      const { locale, t } = useI18n()
      locale.locale = 'zh-CN'
      const result = t('settings.comboRequirement', { mod: 'Ctrl' })
      expect(result).toContain('Ctrl')
      expect(result).not.toContain('{mod}')
    })

    it('leaves unmatched placeholders untouched', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      const result = t('settings.shortcutsConflict', { wrong: 'value' })
      expect(result).toContain('{keys}')
    })

    it('works without vars parameter', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      const result = t('settings.shortcutsConflict')
      expect(result).toContain('{keys}')
    })
  })
})
