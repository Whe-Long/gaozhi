import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, MAX_LENGTH, maxCellSize, normalizeSettings, sampleDraft, validateDraft } from './model'

describe('normalizeSettings', () => {
  it('falls back to defaults for missing or invalid input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ columns: 'abc', rows: Number.NaN, punctuation: 'loose', font: 'hei', gridColor: 'red' }))
      .toEqual(DEFAULT_SETTINGS)
  })

  it('clamps and rounds numeric fields', () => {
    const s = normalizeSettings({ columns: 99, rows: 3, rowGap: 7.6 })
    expect(s.columns).toBe(24)
    expect(s.rows).toBe(10)
    expect(s.rowGap).toBe(8)
  })

  it('keeps the cell size within what fits on an A4 page', () => {
    const s = normalizeSettings({ columns: 24, rows: 24, rowGap: 16, cellSize: 36 })
    expect(s.cellSize).toBe(maxCellSize(s))
    expect(s.cellSize).toBeLessThan(36)
  })

  it('drops the retired first-line indent setting from older drafts', () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, indent: 2 })).not.toHaveProperty('indent')
  })

  it('accepts every supported option value', () => {
    const s = normalizeSettings({ punctuation: 'strict', pairAscii: false, gridColor: '#628a77', font: 'song' })
    expect(s).toMatchObject({ punctuation: 'strict', pairAscii: false, gridColor: '#628a77', font: 'song' })
  })
})

describe('validateDraft', () => {
  it('rejects values that are not drafts', () => {
    expect(() => validateDraft(null)).toThrow('有效')
    expect(() => validateDraft('text')).toThrow('有效')
    expect(() => validateDraft({ version: 2, text: '' })).toThrow('不受支持')
    expect(() => validateDraft({ version: 1, text: 1 })).toThrow('不受支持')
  })

  it('enforces the length limit', () => {
    expect(() => validateDraft({ version: 1, text: 'a'.repeat(MAX_LENGTH + 1) })).toThrow('20,000')
    expect(validateDraft({ version: 1, text: 'a'.repeat(MAX_LENGTH) }).text).toHaveLength(MAX_LENGTH)
  })

  it('normalizes line endings', () => {
    expect(validateDraft({ version: 1, text: '一\r\n二\r三' }).text).toBe('一\n二\n三')
  })

  it('accepts older drafts and drops their retired paragraph formats', () => {
    const d = validateDraft({ version: 1, text: '标题\n正文', formats: ['title', 'body'] })
    expect(d.text).toBe('标题\n正文')
    expect(d).not.toHaveProperty('formats')
  })

  it('sanitizes the name and settings', () => {
    const d = validateDraft({ version: 1, text: '', formats: [], name: 'x'.repeat(150), settings: { columns: 50 } })
    expect(d.name).toHaveLength(100)
    expect(d.settings.columns).toBe(24)
    expect(validateDraft({ version: 1, text: '' }).name).toBe('导入的文稿')
  })

  it('round-trips the sample draft', () => {
    const sample = sampleDraft()
    expect(validateDraft(JSON.parse(JSON.stringify(sample)))).toEqual(sample)
  })
})
