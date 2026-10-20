import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, emptyDraft, MAX_LENGTH, maxCellSize, normalizeSettings, sampleDraft, validateDraft, withText, type BlockKind, type Draft } from './model'

function draftOf(text: string, formats: BlockKind[]): Draft {
  return { ...emptyDraft(), text, formats }
}

describe('normalizeSettings', () => {
  it('falls back to defaults for missing or invalid input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ columns: 'abc', rows: Number.NaN, punctuation: 'loose', font: 'hei', gridColor: 'red' }))
      .toEqual(DEFAULT_SETTINGS)
  })

  it('clamps and rounds numeric fields', () => {
    const s = normalizeSettings({ columns: 99, rows: 3, rowGap: 7.6, indent: -1 })
    expect(s.columns).toBe(24)
    expect(s.rows).toBe(10)
    expect(s.rowGap).toBe(8)
    expect(s.indent).toBe(0)
  })

  it('keeps the cell size within what fits on an A4 page', () => {
    const s = normalizeSettings({ columns: 24, rows: 24, rowGap: 16, cellSize: 36 })
    expect(s.cellSize).toBe(maxCellSize(s))
    expect(s.cellSize).toBeLessThan(36)
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
    expect(() => validateDraft({ version: 2, text: '', formats: [] })).toThrow('不受支持')
    expect(() => validateDraft({ version: 1, text: 1, formats: [] })).toThrow('不受支持')
  })

  it('enforces the length limit', () => {
    expect(() => validateDraft({ version: 1, text: 'a'.repeat(MAX_LENGTH + 1), formats: [] })).toThrow('20,000')
    expect(validateDraft({ version: 1, text: 'a'.repeat(MAX_LENGTH), formats: [] }).text).toHaveLength(MAX_LENGTH)
  })

  it('normalizes line endings and aligns formats with paragraphs', () => {
    const d = validateDraft({ version: 1, text: '一\r\n二\r三', formats: ['title', 'bogus'] })
    expect(d.text).toBe('一\n二\n三')
    expect(d.formats).toEqual(['title', 'body', 'body'])
  })

  it('sanitizes the name and settings', () => {
    const d = validateDraft({ version: 1, text: '', formats: [], name: 'x'.repeat(150), settings: { columns: 50 } })
    expect(d.name).toHaveLength(100)
    expect(d.settings.columns).toBe(24)
    expect(validateDraft({ version: 1, text: '', formats: [] }).name).toBe('导入的文稿')
  })

  it('round-trips the sample draft', () => {
    const sample = sampleDraft()
    expect(validateDraft(JSON.parse(JSON.stringify(sample)))).toEqual(sample)
  })
})

describe('withText', () => {
  const base = draftOf('AB\nCD', ['title', 'signature'])

  it('returns the same draft when text is unchanged', () => {
    expect(withText(base, 'AB\nCD')).toBe(base)
  })

  it('keeps formats when editing inside a paragraph', () => {
    const next = withText(base, 'AXB\nCD', 2)
    expect(next.formats).toEqual(['title', 'signature'])
    expect(base.text).toBe('AB\nCD')
  })

  it('gives a paragraph split in the middle a body tail', () => {
    expect(withText(base, 'A\nB\nCD', 2).formats).toEqual(['title', 'body', 'signature'])
  })

  it('inserts a body paragraph when Enter is pressed at the end of a paragraph', () => {
    // Caret after the new line break: the empty paragraph is the new one.
    expect(withText(base, 'AB\n\nCD', 3).formats).toEqual(['title', 'body', 'signature'])
  })

  it('keeps the following format when Enter is pressed at the start of a paragraph', () => {
    // Caret at the start of "CD": the empty paragraph sits before it.
    expect(withText(base, 'AB\n\nCD', 4).formats).toEqual(['title', 'body', 'signature'])
  })

  it('keeps the first format when two paragraphs merge', () => {
    expect(withText(base, 'ABCD', 2).formats).toEqual(['title'])
  })

  it('removes an empty paragraph with Backspace without moving neighbouring formats', () => {
    const d = draftOf('AB\n\nCD', ['title', 'body', 'signature'])
    expect(withText(d, 'AB\nCD', 2).formats).toEqual(['title', 'signature'])
    expect(withText(d, 'AB\nCD', 3).formats).toEqual(['title', 'signature'])
  })

  it('marks every pasted paragraph as body', () => {
    expect(withText(base, 'AB\n1\n2\nCD', 7).formats).toEqual(['title', 'body', 'body', 'signature'])
  })

  it('uses the caret when pasted text repeats the start of the next paragraph', () => {
    // "\nC" pasted at the end of "AB": the new line is "C", and "CD" keeps its format.
    expect(withText(base, 'AB\nC\nCD', 5).formats).toEqual(['title', 'body', 'signature'])
    expect(withText(base, 'AB\nC\nCD').formats).not.toEqual(['title', 'body', 'signature'])
  })

  it('falls back to a prefix-first diff without a caret', () => {
    expect(withText(base, 'ABCD').formats).toEqual(['title'])
  })
})
