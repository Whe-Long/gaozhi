import { expect, test } from '@playwright/test'
import { clickCell, glyphs, makeDraft, openWith, pageCount, paperText, storedDraft } from './helpers'

const B = '　'
const addPage = (page: import('@playwright/test').Page) => page.getByRole('button', { name: '添加一页' }).click()

test.describe('adding and removing pages', () => {
  test('adds a blank page that is kept after reload', async ({ page }) => {
    await openWith(page, makeDraft('第一页的字'))
    await expect.poll(() => pageCount(page)).toBe(1)
    await addPage(page)
    await expect.poll(() => pageCount(page)).toBe(2)
    await expect(page.locator('.status-bar')).toContainText('共 2 页')
    await expect.poll(async () => (await storedDraft(page))?.minPages).toBe(2)

    await page.reload()
    await expect.poll(() => pageCount(page)).toBe(2)
  })

  test('writing in a cell of a new page lands on that page', async ({ page }) => {
    await openWith(page, makeDraft('开头'))
    await addPage(page)
    await clickCell(page, 1, 3, 1)
    await page.keyboard.type('次页')
    const glyph = page.locator('.paper-grid[data-page="1"] .glyph', { hasText: '次' })
    await expect(glyph).toHaveAttribute('style', /left: 90px; top: 42px/)
    // Page two, row two is line 21; the text ends on line 0, so 21 line breaks reach it.
    await expect.poll(async () => (await storedDraft(page))?.text).toBe(`开头${'\n'.repeat(21)}${B.repeat(3)}次页`)
  })

  test('removes a trailing blank page but never a page with text', async ({ page }) => {
    await openWith(page, makeDraft('字', {}, 3))
    await expect.poll(() => pageCount(page)).toBe(3)
    await expect(page.getByRole('button', { name: '删除此页' })).toHaveCount(1)
    await page.getByRole('button', { name: '删除此页' }).click()
    await page.getByRole('button', { name: '删除此页' }).click()
    await expect.poll(() => pageCount(page)).toBe(1)
    await expect(page.getByRole('button', { name: '删除此页' })).toHaveCount(0)
    await expect.poll(() => paperText(page)).toBe('字')
  })

  test('adding a page can be undone', async ({ page }) => {
    await openWith(page, makeDraft('字'))
    await addPage(page)
    await expect.poll(() => pageCount(page)).toBe(2)
    await page.getByRole('button', { name: '撤销' }).click()
    await expect.poll(() => pageCount(page)).toBe(1)
  })

  test('text that outgrows the added pages still adds pages automatically', async ({ page }) => {
    await openWith(page, makeDraft('一\n'.repeat(45), {}, 2))
    await expect.poll(() => pageCount(page)).toBe(3)
    await expect(page.getByRole('button', { name: '删除此页' })).toHaveCount(0)
    await expect(glyphs(page).last()).toBeVisible()
  })

  test('the workspace scrolls through the pages', async ({ page }) => {
    await openWith(page, makeDraft('字', {}, 3))
    const workspace = page.locator('.workspace')
    await workspace.hover()
    await page.mouse.wheel(0, 1500)
    await expect.poll(() => workspace.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  })

  test('blank pages are printed', async ({ page }) => {
    await openWith(page, makeDraft('字', {}, 2))
    await expect(page.getByRole('button', { name: '添加一页' })).toBeVisible()
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true })
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)).toHaveLength(2)
  })
})
