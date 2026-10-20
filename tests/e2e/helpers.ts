import { type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, STORAGE_KEY, type BlockKind, type Draft, type Settings } from '../../src/model'
import { BACKUP_KEY } from '../../src/storage'

export { BACKUP_KEY, STORAGE_KEY }

export function makeDraft(text: string, formats?: BlockKind[], settings: Partial<Settings> = {}): Draft {
  return {
    version: 1, name: '测试文稿', text,
    formats: formats ?? text.split('\n').map(() => 'body'),
    settings: { ...DEFAULT_SETTINGS, ...settings },
  }
}

/**
 * Store raw text under the draft key before the app's first load. A session
 * flag keeps later reloads from reseeding, so persistence can be observed.
 */
export async function seedRaw(page: Page, raw: string) {
  await page.addInitScript(([key, value]) => {
    if (sessionStorage.getItem('e2e-seeded')) return
    localStorage.setItem(key, value)
    sessionStorage.setItem('e2e-seeded', '1')
  }, [STORAGE_KEY, raw] as const)
}

export async function openWith(page: Page, draft: Draft) {
  await seedRaw(page, JSON.stringify(draft))
  await page.goto('/')
}

export const editor = (page: Page) => page.getByLabel('稿纸正文')
export const glyphs = (page: Page) => page.locator('.glyph-layer .glyph')
export const pageCount = (page: Page) => page.locator('.page-group').count()

/** The text drawn on the paper, read back from the glyphs in source order. */
export async function paperText(page: Page): Promise<string> {
  const items = await glyphs(page).evaluateAll(nodes =>
    nodes.map(n => ({ start: Number((n as HTMLElement).dataset.start), text: n.textContent ?? '' })))
  return items.sort((a, b) => a.start - b.start).map(g => g.text).join('')
}

export async function setCaret(page: Page, start: number, end = start) {
  const input = editor(page)
  await input.focus()
  await input.evaluate((el: HTMLTextAreaElement, [s, e]) => {
    el.setSelectionRange(s, e)
    el.dispatchEvent(new Event('select'))
  }, [start, end] as const)
}

export function storedDraft(page: Page): Promise<Draft | null> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), STORAGE_KEY)
}
