import { describe, expect, it } from 'vitest'
import { graphemes, hitTest, layoutDocument, type Glyph } from './layout'
import { DEFAULT_SETTINGS, sampleDraft, type BlockKind, type Draft, type Settings } from './model'

const SMALL: Settings = { ...DEFAULT_SETTINGS, columns: 10, rows: 10 }

function draft(text: string, formats?: BlockKind[], settings: Partial<Settings> = {}): Draft {
  return {
    version: 1, name: 'test', text,
    formats: formats ?? text.split('\n').map(() => 'body'),
    settings: { ...SMALL, ...settings },
  }
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
    expect(layout.carets[0]).toEqual({ page: 0, row: 0, column: 2 })
  })

  it('indents body paragraphs and wraps at the column limit', () => {
    const { glyphs } = layoutDocument(draft('一二三四五六七八九'))
    expect(cells(glyphs).slice(0, 2)).toEqual([['一', 0, 0, 2], ['二', 0, 0, 3]])
    expect(cells(glyphs).slice(-2)).toEqual([['八', 0, 0, 9], ['九', 0, 1, 0]])
  })

  it('treats the indent as layout, not text', () => {
    expect(layoutDocument(draft('一', undefined, { indent: 4 })).glyphs[0].column).toBe(4)
    expect(layoutDocument(draft('一', undefined, { indent: 0 })).glyphs[0].column).toBe(0)
  })

  it('does not add an indent when the paragraph already starts with spaces', () => {
    const { glyphs } = layoutDocument(draft('　　一'))
    expect(cells(glyphs)).toEqual([['　', 0, 0, 0], ['　', 0, 0, 1], ['一', 0, 0, 2]])
  })

  it('starts each paragraph on a new line and leaves the rest of the line blank', () => {
    const { glyphs } = layoutDocument(draft('一\n二'))
    expect(cells(glyphs)).toEqual([['一', 0, 0, 2], ['二', 0, 1, 2]])
  })

  it('keeps salutations flush left', () => {
    expect(layoutDocument(draft('老师：', ['salutation'])).glyphs[0].column).toBe(0)
  })

  it('centres titles on each line', () => {
    const { glyphs } = layoutDocument(draft('标题', ['title']))
    expect(cells(glyphs)).toEqual([['标', 0, 0, 4], ['题', 0, 0, 5]])
    expect(glyphs[0].kind).toBe('title')
  })

  it('right-aligns signatures', () => {
    const { glyphs } = layoutDocument(draft('张三', ['signature']))
    expect(cells(glyphs)).toEqual([['张', 0, 0, 8], ['三', 0, 0, 9]])
  })

  it('moves carets together with aligned glyphs', () => {
    const { carets } = layoutDocument(draft('张三', ['signature']))
    expect(carets.map(c => c.column)).toEqual([8, 9, 10])
  })
})

describe('layoutDocument: pagination', () => {
  const full = '字'.repeat(100)

  it('fills a page exactly without starting a new one', () => {
    const layout = layoutDocument(draft(full, ['salutation']))
    expect(layout.pages).toBe(1)
    expect(layout.glyphs.at(-1)).toMatchObject({ page: 0, row: 9, column: 9 })
  })

  it('continues on the next page when the page is full', () => {
    const layout = layoutDocument(draft(full + '多', ['salutation']))
    expect(layout.pages).toBe(2)
    expect(layout.glyphs.at(-1)).toMatchObject({ page: 1, row: 0, column: 0 })
  })

  it('counts empty trailing paragraphs as lines', () => {
    expect(layoutDocument(draft('一\n'.repeat(10))).pages).toBe(2)
  })

  it('respects custom row counts', () => {
    expect(layoutDocument(draft('一\n'.repeat(11), undefined, { rows: 12 })).pages).toBe(1)
  })
})

describe('layoutDocument: punctuation', () => {
  // Nine characters after a two-cell indent fill the first line minus one cell.
  const almostFull = '一二三四五六七'

  it('hangs a closing mark outside the grid when the line is full', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '八，后'))
    const comma = glyphFor(glyphs, '，')
    expect(comma).toMatchObject({ row: 0, hanging: true })
    expect(comma.column).toBeGreaterThan(9)
    expect(glyphFor(glyphs, '后')).toMatchObject({ row: 1, column: 0 })
  })

  it('hangs at most two closing marks', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '八。”）'))
    expect(glyphs.filter(g => g.hanging).map(g => g.text)).toEqual(['。', '”'])
    expect(glyphFor(glyphs, '）')).toMatchObject({ row: 1, column: 0, hanging: false })
  })

  it('carries the previous character in strict mode instead of starting a line with punctuation', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '八，后', undefined, { punctuation: 'strict' }))
    expect(glyphs.some(g => g.hanging)).toBe(false)
    expect(glyphFor(glyphs, '八')).toMatchObject({ row: 1, column: 0 })
    expect(glyphFor(glyphs, '，')).toMatchObject({ row: 1, column: 1 })
  })

  it('keeps consecutive closing marks with their character in strict mode', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '八。”', undefined, { punctuation: 'strict' }))
    expect(cells(glyphs).slice(-3)).toEqual([['八', 0, 1, 0], ['。', 0, 1, 1], ['”', 0, 1, 2]])
  })

  it('never leaves an opening mark at the end of a line', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '“好”'))
    expect(glyphFor(glyphs, '“')).toMatchObject({ row: 1, column: 0 })
    expect(glyphFor(glyphs, '好')).toMatchObject({ row: 1, column: 1 })
  })

  it('places a closing mark at the end of the last row on the page', () => {
    const text = '字'.repeat(100) + '。'
    const { glyphs, pages } = layoutDocument(draft(text, ['salutation']))
    expect(pages).toBe(1)
    expect(glyphs.at(-1)).toMatchObject({ page: 0, row: 9, hanging: true })
  })

  it('gives ellipses and dashes two cells without splitting them', () => {
    const { glyphs } = layoutDocument(draft('啊……——', ['salutation']))
    expect(glyphs.map(g => [g.text, g.column, g.span])).toEqual([['啊', 0, 1], ['……', 1, 2], ['——', 3, 2]])
  })

  it('moves a two-cell mark to the next line rather than splitting it', () => {
    const { glyphs } = layoutDocument(draft(almostFull + '八……'))
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
    const { glyphs } = layoutDocument(draft('2026年', ['salutation']))
    expect(glyphs.map(g => [g.text, g.column])).toEqual([['20', 0], ['26', 1], ['年', 2]])
  })

  it('leaves an odd trailing character in its own cell', () => {
    const { glyphs } = layoutDocument(draft('202年', ['salutation']))
    expect(glyphs.map(g => g.text)).toEqual(['20', '2', '年'])
  })

  it('uses one cell per character when pairing is off', () => {
    const { glyphs } = layoutDocument(draft('AI', ['salutation'], { pairAscii: false }))
    expect(glyphs.map(g => [g.text, g.column])).toEqual([['A', 0], ['I', 1]])
  })

  it('places carets at half cells inside a pair', () => {
    const { carets } = layoutDocument(draft('ab', ['salutation']))
    expect(carets.map(c => c.column)).toEqual([0, 0.5, 1])
  })
})

describe('layoutDocument: carets and statistics', () => {
  it('defines a caret for every UTF-16 offset', () => {
    const text = '你好😀\n\nab，“好”……\n张三'
    const { carets } = layoutDocument(draft(text, ['title', 'body', 'body', 'signature']))
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
  const d = draft('AB\n\nCD', ['salutation', 'salutation', 'salutation'], { pairAscii: false })
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
