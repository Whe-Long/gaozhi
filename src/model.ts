export type BlockKind = 'body' | 'title' | 'salutation' | 'signature'
export type PunctuationMode = 'hang' | 'strict'

export interface Settings {
  columns: number
  rows: number
  cellSize: number
  rowGap: number
  punctuation: PunctuationMode
  pairAscii: boolean
  gridColor: string
  font: 'kai' | 'song'
}

export interface Draft {
  version: 1
  name: string
  text: string
  formats: BlockKind[]
  settings: Settings
}

export const STORAGE_KEY = 'gaozhi:draft:v1'
export const MAX_LENGTH = 20_000
export const PAGE_WIDTH = 794
export const PAGE_HEIGHT = 1123
export const DEFAULT_SETTINGS: Settings = {
  columns: 20, rows: 20, cellSize: 30, rowGap: 12,
  punctuation: 'hang', pairAscii: true, gridColor: '#bb786b', font: 'kai',
}
export const BLOCK_LABELS: Record<BlockKind, string> = {
  body: '正文', title: '标题', salutation: '称呼', signature: '落款',
}

export function emptyDraft(): Draft {
  return { version: 1, name: '未命名文稿', text: '', formats: ['body'], settings: { ...DEFAULT_SETTINGS } }
}

export function sampleDraft(): Draft {
  return {
    ...emptyDraft(), name: '写给未来的自己',
    text: '写给未来的自己\n亲爱的自己：\n　　写下这些文字时，窗外的树影正在轻轻摇晃。我想把今天的一点心情，认真地留在纸上。\n　　日子不必匆忙，脚步可以坚定。愿你始终对世界保有好奇，在平凡的生活里，也能发现值得珍藏的光。\n　　当你再次读到这封信，希望仍记得出发时的心情：认真学习，真诚待人，把喜欢的事情慢慢做好。\n　　愿未来的你，眼中有光，心中有爱。\n一个晴朗的午后\n2026年10月20日',
    formats: ['title', 'salutation', 'body', 'body', 'body', 'body', 'signature', 'signature'],
  }
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value))) : fallback
}

export function maxCellSize(settings: Pick<Settings, 'columns' | 'rows' | 'rowGap'>): number {
  return Math.min(36, Math.floor((PAGE_WIDTH - 96) / settings.columns),
    Math.floor((PAGE_HEIGHT - 200 - (settings.rows - 1) * settings.rowGap) / settings.rows))
}

export function normalizeSettings(value: unknown): Settings {
  const s = (value && typeof value === 'object' ? value : {}) as Partial<Settings>
  const base = {
    columns: bounded(s.columns, 20, 10, 24), rows: bounded(s.rows, 20, 10, 24),
    rowGap: bounded(s.rowGap, 12, 4, 16),
  }
  return {
    ...base,
    cellSize: bounded(s.cellSize, 30, 18, maxCellSize(base)),
    punctuation: s.punctuation === 'strict' ? 'strict' : 'hang',
    pairAscii: typeof s.pairAscii === 'boolean' ? s.pairAscii : true,
    gridColor: ['#bb786b', '#628a77', '#858581'].includes(s.gridColor ?? '') ? s.gridColor! : '#bb786b',
    font: s.font === 'song' ? 'song' : 'kai',
  }
}

export function validateDraft(value: unknown): Draft {
  if (!value || typeof value !== 'object') throw new Error('这不是有效的稿纸备份文件。')
  const d = value as Partial<Draft>
  if (d.version !== 1 || typeof d.text !== 'string' || !Array.isArray(d.formats)) {
    throw new Error('备份格式不受支持，请导入稿纸导出的 JSON 文件。')
  }
  if (d.text.length > MAX_LENGTH) throw new Error('第一版支持最多 20,000 个文本编码单元，请分成多份文稿。')
  const kinds: BlockKind[] = ['body', 'title', 'salutation', 'signature']
  return {
    version: 1, name: typeof d.name === 'string' ? d.name.slice(0, 100) : '导入的文稿',
    text: d.text.replace(/\r\n?/g, '\n'),
    formats: d.text.replace(/\r\n?/g, '\n').split('\n').map((_, i) => kinds.includes(d.formats![i]) ? d.formats![i] : 'body'),
    settings: normalizeSettings(d.settings),
  }
}

/**
 * Common prefix and suffix of an edit. The caret marks where inserted text
 * ends, which decides between equivalent diffs such as Enter at the end of
 * one paragraph versus the start of the next.
 */
function editRange(before: string, after: string, caret?: number): { prefix: number; suffix: number } {
  const max = Math.min(before.length, after.length)
  const prefixLength = (limit: number) => {
    let n = 0
    while (n < limit && after[n] === before[n]) n++
    return n
  }
  const suffixLength = (limit: number) => {
    let n = 0
    while (n < limit && after[after.length - 1 - n] === before[before.length - 1 - n]) n++
    return n
  }
  if (caret === undefined) {
    const prefix = prefixLength(max)
    return { prefix, suffix: suffixLength(max - prefix) }
  }
  const end = Math.max(0, Math.min(after.length, caret))
  const suffix = suffixLength(Math.min(max, after.length - end))
  return { prefix: prefixLength(Math.min(max - suffix, end)), suffix }
}

/**
 * Preserve paragraph formats around an edit; new paragraphs default to body.
 * A format stays with the line that keeps the paragraph's original text.
 */
export function withText(draft: Draft, text: string, caret?: number): Draft {
  if (text === draft.text) return draft
  const { prefix, suffix } = editRange(draft.text, text, caret)
  const lineAt = (s: string, end: number) => (s.slice(0, end).match(/\n/g) ?? []).length
  const startLine = lineAt(draft.text, prefix)
  const endLine = lineAt(draft.text, draft.text.length - suffix)
  const added = (text.slice(prefix, text.length - suffix).match(/\n/g) ?? []).length
  // With nothing kept before the edit on its first line, the paragraph's
  // text continues on the last replaced line, so its format moves there.
  const headEmpty = prefix === 0 || draft.text[prefix - 1] === '\n'
  const replaced = Array.from({ length: added + 1 }, (_, i): BlockKind =>
    i === (headEmpty ? added : 0) ? draft.formats[headEmpty ? endLine : startLine] ?? 'body' : 'body')
  const formats: BlockKind[] = [
    ...draft.formats.slice(0, startLine),
    ...replaced,
    ...draft.formats.slice(endLine + 1),
  ]
  return { ...draft, text, formats: text.split('\n').map((_, i) => formats[i] ?? 'body') }
}
