import { describe, expect, it } from 'vitest'
import { BLANK, graphemes, hitTest, layoutDocument, locate, type Glyph } from './layout'
import { DEFAULT_SETTINGS, sampleDraft, type Draft, type Settings } from './model'

const SMALL: Settings = { ...DEFAULT_SETTINGS, columns: 10, rows: 10 }

function draft(text: string, settings: Partial<Settings> = {}): Draft {
  return { version: 1, name: 'test', text, minPages: 1, settings: { ...SMALL, ...settings } }
}

const cells = (glyphs: Glyph[]) => glyphs.map(g => [g.text, g.page, g.row, g.column])
const glyphFor = (glyphs: Glyph[], text: string) => glyphs.find(g => g.text === text)!

describe('graphemes', () => {
  it('keeps emoji and combining sequences as single units with UTF-16 offsets', () => {
    expect(graphemes('a😀e\u0301')).toEqual([
      { text: 'a', start: 0, end: 1 },
      { text: '😀', start: 1, end: 3 },
      { text: 'e\u0301', start: 3, end: 5 },
    ])
  })
})

describe('layoutDocument: paragraphs', () => {
  it('returns a single empty page for an empty draft', () => {
    const layout = layoutDocument(draft(''))
    expect(layout.pages).toBe(1)
    expect(layout.glyphs).toEqual([])
    expect(layout.characters).toBe(0)
    expect(layout.carets[0]).toEqual({ page: 0, row: 0, column: 0 })
  })

  it('starts body paragraphs in the first cell and wraps at the column limit', () => {
    const { glyphs } = layoutDocument(draft('一二三四五六七八九十甲'))
    expect(cells(glyphs).slice(0, 2)).toEqual([['一', 0, 0, 0], ['二', 0, 0, 1]])
    expect(cells(glyphs).slice(-2)).toEqual([['十', 0, 0, 9], ['甲', 0, 1, 0]])
  })

  it('keeps spaces typed at the start of a paragraph as blank cells', () => {
    const { glyphs } = layoutDocument(draft('　　一'))
    expect(cells(glyphs)).toEqual([['　', 0, 0, 0], ['　', 0, 0, 1], ['一', 0, 0, 2]])
  })

  it('starts each paragraph on a new line and leaves the rest of the line blank', () => {
    const { glyphs } = layoutDocument(draft('一\n二'))
    expect(cells(glyphs)).toEqual([['一', 0, 0, 0], ['二', 0, 1, 0]])
  })

  it('lays out every paragraph the same way, flush left', () => {
    const { glyphs } = layoutDocument(draft('标题\n张三'))
    expect(cells(glyphs)).toEqual([['标', 0, 0, 0], ['题', 0, 0, 1], ['张', 0, 1, 0], ['三', 0, 1, 1]])
  })

  it('centres the sample title and right-aligns its signature with spaces alone', () => {
    const { glyphs } = layoutDocument(sampleDraft())
    expect(glyphFor(glyphs, '写')).toMatchObject({ row: 0, column: 6 })
    const lastRow = glyphs.at(-1)!.row
    expect(glyphs.at(-1)).toMatchObject({ text: '日', column: 19 })
    expect(glyphs.filter(g => g.row === lastRow - 1).at(-1)).toMatchObject({ text: '后', column: 19 })
  })

  it('positions spaced-out lines by their full-width spaces', () => {
    const { glyphs } = layoutDocument(draft('　　　　标题'))
    expect(glyphFor(glyphs, '标').column).toBe(4)
  })
})

describe('layoutDocument: pagination', () => {
  const full = '字'.repeat(100)

  it('fills a page exactly without starting a new one', () => {
    const layout = layoutDocument(draft(full))
    expect(layout.pages).toBe(1)
    expect(layout.glyphs.at(-1)).toMatchObject({ page: 0, row: 9, column: 9 })
  })

  it('continues on the next page when the page is full', () => {
    const layout = layoutDocument(draft(full + '多'))
    expect(layout.pages).toBe(2)
    expect(layout.glyphs.at(-1)).toMatchObject({ page: 1, row: 0, column: 0 })
  })

  it('counts empty trailing paragraphs as lines', () => {
    expect(layoutDocument(draft('一\n'.repeat(10))).pages).toBe(2)
  })

  it('respects custom row counts', () => {
    expect(layoutDocument(draft('一\n'.repeat(11), { rows: 12 })).pages).toBe(1)
  })
})

describe('layoutDocument: punctuation', () => {
  // Nine characters fill the first line minus one cell.
  const almostFull = '一二三四五六七八九'

  it('hangs a closing mark outside the grid when the line is full', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '十，后'))
    const comma = glyphFor(glyphs, '，')
    expect(comma).toMatchObject({ row: 0, hanging: true })
    expect(comma.column).toBeGreaterThan(9)
    expect(glyphFor(glyphs, '后')).toMatchObject({ row: 1, column: 0 })
  })

  it('hangs at most two closing marks', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '十。”）'))
    expect(glyphs.filter(g => g.hanging).map(g => g.text)).toEqual(['。', '”'])
    expect(glyphFor(glyphs, '）')).toMatchObject({ row: 1, column: 0, hanging: false })
  })

  it('carries the previous character in strict mode instead of starting a line with punctuation', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '十，后', { punctuation: 'strict' }))
    expect(glyphs.some(g => g.hanging)).toBe(false)
    expect(glyphFor(glyphs, '十')).toMatchObject({ row: 1, column: 0 })
    expect(glyphFor(glyphs, '，')).toMatchObject({ row: 1, column: 1 })
  })

  it('keeps consecutive closing marks with their character in strict mode', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '十。”', { punctuation: 'strict' }))
    expect(cells(glyphs).slice(-3)).toEqual([['十', 0, 1, 0], ['。', 0, 1, 1], ['”', 0, 1, 2]])
  })

  it('never leaves an opening mark at the end of a line', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '“好”'))
    expect(glyphFor(glyphs, '“')).toMatchObject({ row: 1, column: 0 })
    expect(glyphFor(glyphs, '好')).toMatchObject({ row: 1, column: 1 })
  })

  it('places a closing mark at the end of the last row on the page', () => {
    const text = '字'.repeat(100) + '。'
    const { glyphs, pages } = layoutDocument(draft(text))
    expect(pages).toBe(1)
    expect(glyphs.at(-1)).toMatchObject({ page: 0, row: 9, hanging: true })
  })

  it('gives ellipses and dashes two cells without splitting them', () => {
    const { glyphs } = layoutDocument(draft('啊……——'))
    expect(glyphs.map(g => [g.text, g.column, g.span])).toEqual([['啊', 0, 1], ['……', 1, 2], ['——', 3, 2]])
  })

  it('moves a two-cell mark to the next line rather than splitting it', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '十……'))
    expect(glyphFor(glyphs, '……')).toMatchObject({ row: 1, column: 0 })
  })

  it('leaves the source text untouched', () => {
    const d = sampleDraft()
    const before = JSON.stringify(d)
    for (const punctuation of ['hang', 'strict'] as const) {
      const { glyphs } = layoutDocument({ ...d, settings: { ...d.settings, punctuation } })
      expect(glyphs.map(g => g.text).join('')).toBe(d.text.replace(/\n/g, ''))
    }
    expect(JSON.stringify(d)).toBe(before)
  })
})

describe('layoutDocument: numbers and Latin letters', () => {
  it('pairs half-width letters and digits into one cell', () => {
    const { glyphs } = layoutDocument(draft('2026年'))
    expect(glyphs.map(g => [g.text, g.column])).toEqual([['20', 0], ['26', 1], ['年', 2]])
  })

  it('leaves an odd trailing character in its own cell', () => {
    const { glyphs } = layoutDocument(draft('202年'))
    expect(glyphs.map(g => g.text)).toEqual(['20', '2', '年'])
  })

  it('uses one cell per character when pairing is off', () => {
    const { glyphs } = layoutDocument(draft('AI', { pairAscii: false }))
    expect(glyphs.map(g => [g.text, g.column])).toEqual([['A', 0], ['I', 1]])
  })

  it('places carets at half cells inside a pair', () => {
    const { carets } = layoutDocument(draft('ab'))
    expect(carets.map(c => c.column)).toEqual([0, 0.5, 1])
  })
})

describe('layoutDocument: carets and statistics', () => {
  it('defines a caret for every UTF-16 offset', () => {
    const text = '你好😀\n\nab，“好”……\n张三'
    const { carets } = layoutDocument(draft(text))
    expect(carets).toHaveLength(text.length + 1)
    for (let i = 0; i <= text.length; i++) expect(carets[i], `offset ${i}`).toBeDefined()
  })

  it('counts graphemes without line breaks', () => {
    expect(layoutDocument(draft('你好\n😀，')).characters).toBe(4)
  })

  it('is deterministic for identical input', () => {
    const d = sampleDraft()
    expect(layoutDocument(d)).toEqual(layoutDocument(structuredClone(d)))
  })
})

describe('hitTest', () => {
  const d = draft('AB\n\nCD', { pairAscii: false })
  const layout = layoutDocument(d)
  const at = (row: number, column: number, page = 0) => hitTest(layout, page, row, column, SMALL.rows)

  it('resolves clicks on text to the nearest caret', () => {
    expect(at(0, 0.4)).toBe(0)
    expect(at(0, 1.6)).toBe(2)
  })

  it('resolves clicks past the end of a line to the line end', () => {
    expect(at(0, 9)).toBe(2)
  })

  it('resolves clicks on an empty paragraph to that paragraph', () => {
    expect(at(1, 5)).toBe(3)
  })

  it('resolves clicks below the text to the nearest line', () => {
    expect(at(9, 0)).toBe(4)
    expect(at(0, 0, 1)).toBe(4)
  })
})

describe('locate', () => {
  const d = draft('AB\n\nCD', { pairAscii: false })
  const layout = layoutDocument(d)
  const at = (row: number, column: number, page = 0) => locate(layout, page, row, column, d.settings)

  it('behaves like hitTest on text', () => {
    expect(at(0, 0.4)).toEqual({ offset: 0, padding: '', cell: null })
    expect(at(0, 2.3)).toEqual({ offset: 2, padding: '', cell: null })
  })

  it('pads blank cells after the end of a paragraph with full-width spaces', () => {
    expect(at(0, 5.7)).toEqual({ offset: 2, padding: BLANK.repeat(3), cell: { page: 0, row: 0, column: 5 } })
  })

  it('pads an empty paragraph from its first cell', () => {
    expect(at(1, 4.2)).toEqual({ offset: 3, padding: BLANK.repeat(4), cell: { page: 0, row: 1, column: 4 } })
    expect(at(1, 0.2)).toEqual({ offset: 3, padding: '', cell: null })
  })

  it('adds paragraphs to reach blank rows below the text', () => {
    expect(at(5, 3)).toEqual({ offset: 6, padding: '\n\n\n' + BLANK.repeat(3), cell: { page: 0, row: 5, column: 3 } })
    expect(at(3, 0)).toEqual({ offset: 6, padding: '\n', cell: { page: 0, row: 3, column: 0 } })
  })

  it('reaches blank rows on later pages', () => {
    expect(at(0, 1, 1).padding).toBe('\n'.repeat(8) + BLANK)
  })

  it('clamps clicks on the right edge to the last cell', () => {
    expect(at(0, 10).cell).toEqual({ page: 0, row: 0, column: 9 })
  })

  it('pads after the last paragraph line like any other', () => {
    expect(at(2, 8)).toEqual({ offset: 6, padding: BLANK.repeat(6), cell: { page: 0, row: 2, column: 8 } })
  })

  it('snaps on lines that continue on the next row', () => {
    const strict = draft('一二三四五六七八九十，', { punctuation: 'strict' })
    const wrapped = layoutDocument(strict)
    expect(locate(wrapped, 0, 0, 9.5, strict.settings)).toMatchObject({ padding: '', cell: null })
  })
})
