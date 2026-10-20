import { type BlockKind, type Draft, type Settings } from './model'

export interface Position { page: number; row: number; column: number }
export interface Glyph extends Position {
  text: string; start: number; end: number; span: number; hanging: boolean; kind: BlockKind
}
export interface Layout {
  glyphs: Glyph[]; carets: Position[]; pages: number; characters: number
}
interface Token { text: string; start: number; end: number; span: number }
const CLOSE = new Set(Array.from('，。、；：？！）》」』】〕〉〗〙〛”’％%…'))
const OPEN = new Set(Array.from('（《「『【〔〈〖〘〚“‘'))
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })

export function graphemes(text: string): { text: string; start: number; end: number }[] {
  return Array.from(segmenter.segment(text), s => ({ text: s.segment, start: s.index, end: s.index + s.segment.length }))
}

function tokenize(text: string, offset: number, settings: Settings): Token[] {
  const chars = graphemes(text)
  const out: Token[] = []
  for (let i = 0; i < chars.length; i++) {
    const a = chars[i]
    const b = chars[i + 1]
    if (b && ((a.text === '…' && b.text === '…') || (a.text === '—' && b.text === '—'))) {
      out.push({ text: a.text + b.text, start: offset + a.start, end: offset + b.end, span: 2 })
      i++
    } else if (b && settings.pairAscii && /^[a-zA-Z0-9]$/.test(a.text) && /^[a-zA-Z0-9]$/.test(b.text)) {
      out.push({ text: a.text + b.text, start: offset + a.start, end: offset + b.end, span: 1 })
      i++
    } else {
      out.push({ ...a, start: offset + a.start, end: offset + a.end, span: 1 })
    }
  }
  return out
}

/** Pure, deterministic layout. Source strings and punctuation are never rewritten. */
export function layoutDocument(draft: Draft): Layout {
  const { settings } = draft
  const { columns, rows } = settings
  const glyphs: Glyph[] = []
  const carets: Position[] = new Array(draft.text.length + 1)
  const position = (line: number, column: number): Position => ({ page: Math.floor(line / rows), row: line % rows, column })
  let line = 0
  let offset = 0
  const blocks = draft.text.split('\n')

  blocks.forEach((text, blockIndex) => {
    const kind = draft.formats[blockIndex] ?? 'body'
    let col = kind === 'body' && !/^[\s\u3000]/u.test(text) ? settings.indent : 0
    const firstGlyph = glyphs.length
    const firstLine = line
    const tokens = tokenize(text, offset, settings)
    carets[offset] = position(line, col)
    let hangingCount = 0

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const closing = CLOSE.has(token.text[0]) && token.span === 1
      const canHang = settings.punctuation === 'hang' && closing && col === columns && hangingCount < 2
      let needed = token.span
      // Keep opening marks with the following unit, and keep closing marks with
      // their predecessor in strict mode. Groups longer than a row can wrap.
      let j = i
      while (j + 1 < tokens.length && (OPEN.has(tokens[j].text) ||
        (settings.punctuation === 'strict' && CLOSE.has(tokens[j + 1].text[0])))) {
        needed += tokens[++j].span
      }
      if (!canHang && (col + token.span > columns ||
        (needed <= columns && col > 0 && col + needed > columns))) {
        line++
        col = 0
        hangingCount = 0
      }
      const drawColumn = canHang ? columns - 0.02 + hangingCount * 0.48 : col
      const glyph: Glyph = { ...position(line, drawColumn), ...token, hanging: canHang, kind }
      glyphs.push(glyph)
      for (let p = token.start; p < token.end; p++) {
        // UTF-16 offsets are preserved for textarea selections. A grapheme is
        // visually indivisible; paired ASCII gets a half-cell caret.
        const fraction = /^[a-zA-Z0-9]{2}$/.test(token.text) ? (p - token.start) / 2 : 0
        carets[p] = position(line, drawColumn + fraction)
      }
      if (canHang) hangingCount++
      else { col += token.span; hangingCount = 0 }
      carets[token.end] = position(line, Math.min(col, columns))
    }

    // Alignment is applied per visual line without changing source offsets.
    if (kind === 'title' || kind === 'signature') {
      for (let visual = firstLine; visual <= line; visual++) {
        const onLine = glyphs.slice(firstGlyph).filter(g => g.page * rows + g.row === visual)
        const width = onLine.reduce((n, g) => Math.max(n, g.column + (g.hanging ? 0 : g.span)), 0)
        const shift = kind === 'title' ? Math.floor((columns - width) / 2) : columns - width
        for (const g of onLine) g.column += shift
        for (let p = offset; p <= offset + text.length; p++) {
          const c = carets[p]
          if (c && c.page * rows + c.row === visual) c.column += shift
        }
      }
    }
    if (blockIndex < blocks.length - 1) {
      offset += text.length + 1
      line++
    }
  })
  return {
    glyphs, carets, pages: Math.max(1, Math.floor(line / rows) + 1),
    characters: graphemes(draft.text).filter(g => !/[\r\n]/.test(g.text)).length,
  }
}

/** Whitespace clicks resolve to the nearest source caret, including empty blocks. */
export function hitTest(layout: Layout, page: number, row: number, column: number, rows: number): number {
  const targetLine = page * rows + row
  let best = 0
  let distance = Infinity
  layout.carets.forEach((p, i) => {
    if (!p) return
    const d = Math.abs(p.page * rows + p.row - targetLine) * 1000 + Math.abs(p.column - column)
    if (d < distance || (d === distance && i > best)) { best = i; distance = d }
  })
  return best
}
