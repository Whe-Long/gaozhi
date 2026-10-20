import { expect, test, type Page } from '@playwright/test'
import { makeDraft, openWith, pageCount } from './helpers'

/** Glyph positions in unscaled paper coordinates, which zoom must not change. */
const glyphPositions = (page: Page) => page.locator('.glyph').evaluateAll(nodes =>
  nodes.map(n => {
    const el = n as HTMLElement
    return `${el.closest('.paper-grid')?.getAttribute('data-page')}:${el.dataset.start}@${el.style.left},${el.style.top}`
  }))

const longDraft = makeDraft(Array.from({ length: 40 }, (_, i) => `这是第${i + 1}段，用来检查分页。`).join('\n'))

test.describe('zoom and print', () => {
  test('zooming changes the scale but not where characters sit', async ({ page }) => {
    await openWith(page, longDraft)
    await expect.poll(() => pageCount(page)).toBeGreaterThan(1)
    const fit = await glyphPositions(page)
    for (const zoom of ['50', '125']) {
      await page.getByLabel('显示缩放').selectOption(zoom)
      await expect.poll(() => glyphPositions(page)).toEqual(fit)
    }
    const shell = page.locator('.paper-shell').first()
    expect((await shell.boundingBox())!.width).toBeCloseTo(794 * 1.25, 0)
  })

  test('print styles hide the interface and keep only the paper', async ({ page }) => {
    await openWith(page, longDraft)
    await page.emulateMedia({ media: 'print' })
    for (const selector of ['.app-header', '.editor-toolbar', '.settings-panel', '.status-bar']) {
      await expect(page.locator(selector)).toBeHidden()
    }
    await expect(page.locator('.paper').first()).toBeVisible()
  })

  test('the PDF has one A4 page per paper page', async ({ page }) => {
    await openWith(page, longDraft)
    const pages = await pageCount(page)
    expect(pages).toBeGreaterThan(1)
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: false })
    const pageObjects = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []
    expect(pageObjects).toHaveLength(pages)
  })
})
