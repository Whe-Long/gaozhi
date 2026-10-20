import { type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, STORAGE_KEY, type Draft, type Settings } from '../../src/model'
import { BACKUP_KEY } from '../../src/storage'

export { BACKUP_KEY, STORAGE_KEY }

export function makeDraft(text: string, settings: Partial<Settings> = {}, minPages = 1): Draft {
  return { version: 1, name: '测试文稿', text, minPages, settings: { ...DEFAULT_SETTINGS, ...settings } }
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

/** Click the centre of a cell, converting grid coordinates to the zoomed paper. */
export async function clickCell(page: Page, row: number, column: number, pageIndex = 0) {
  const grid = page.locator(`.paper-grid[data-page="${pageIndex}"]`)
  const { width } = (await grid.boundingBox())!
  const { columns, cellSize, rowGap } = await page.evaluate(key =>
    JSON.parse(localStorage.getItem(key) ?? 'null')?.settings ?? { columns: 20, cellSize: 30, rowGap: 12 }, STORAGE_KEY)
  const scale = width / (columns * cellSize)
  await grid.click({ position: { x: (column + 0.5) * cellSize * scale, y: (row * (cellSize + rowGap) + cellSize / 2) * scale } })
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
