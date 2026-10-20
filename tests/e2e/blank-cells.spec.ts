import { expect, test } from '@playwright/test'
import { clickCell, glyphs, makeDraft, openWith, paperText, storedDraft } from './helpers'

const B = '　'
const cellStyle = (row: number, column: number) => new RegExp(`left: ${column * 30}px; top: ${row * 42}px`)

test.describe('writing in blank cells', () => {
  test.beforeEach(async ({ page }) => {
    await openWith(page, makeDraft('春天'))
  })

  test('typing after the end of a paragraph pads the gap with full-width spaces', async ({ page }) => {
    await clickCell(page, 0, 5)
    await expect(page.locator('.status-bar')).toContainText('第 1 行 · 第 6 格')
    await page.keyboard.type('来')
    await expect.poll(() => paperText(page)).toBe(`春天${B.repeat(3)}来`)
    await expect(glyphs(page).filter({ hasText: '来' })).toHaveAttribute('style', cellStyle(0, 5))
  })

  test('typing on a blank row below the text adds the paragraphs in between', async ({ page }) => {
    await clickCell(page, 3, 2)
    await page.keyboard.type('夏')
    await expect(glyphs(page).filter({ hasText: '夏' })).toHaveAttribute('style', cellStyle(3, 2))
    await expect.poll(async () => (await storedDraft(page))?.text).toBe(`春天\n\n\n${B.repeat(2)}夏`)
    await expect.poll(async () => (await storedDraft(page))?.formats).toEqual(['body', 'body', 'body', 'body'])
  })

  test('padding and the typed text undo as one step', async ({ page }) => {
    await clickCell(page, 2, 4)
    await page.keyboard.type('秋')
    await expect.poll(() => paperText(page)).toBe(`春天${B.repeat(4)}秋`)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => paperText(page)).toBe('春天')
  })

  test('keyboard letters and Enter in a blank cell use the same padding', async ({ page }) => {
    await clickCell(page, 0, 3)
    await page.keyboard.press('a')
    await expect.poll(() => paperText(page)).toBe(`春天${B}a`)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => paperText(page)).toBe('春天')
    await clickCell(page, 2, 1)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await storedDraft(page))?.text).toBe(`春天\n\n${B}\n`)
  })

  test('IME input in a blank cell lands there and undoes in one step', async ({ page }) => {
    await clickCell(page, 0, 4)
    const cdp = await page.context().newCDPSession(page)
    // Chrome sends a placeholder keydown before an IME starts composing.
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code: 'KeyN', windowsVirtualKeyCode: 229 })
    await cdp.send('Input.imeSetComposition', { text: 'dong', selectionStart: 4, selectionEnd: 4 })
    await cdp.send('Input.insertText', { text: '冬天' })
    await expect.poll(() => paperText(page)).toBe(`春天${B.repeat(2)}冬天`)
    await expect(glyphs(page).filter({ hasText: '冬' })).toHaveAttribute('style', cellStyle(0, 4))
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => paperText(page)).toBe('春天')
  })

  test('pasting into a blank cell starts in that cell', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate(() => navigator.clipboard.writeText('花开'))
    await clickCell(page, 1, 3)
    await page.keyboard.press('ControlOrMeta+v')
    await expect(glyphs(page).filter({ hasText: '花' })).toHaveAttribute('style', cellStyle(1, 3))
  })

  test('leaving a blank cell without typing changes nothing', async ({ page }) => {
    await clickCell(page, 4, 6)
    await page.keyboard.press('Backspace')
    await clickCell(page, 0, 9)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('暖')
    await expect.poll(() => paperText(page)).toBe('春暖天')
  })

  test('the first-line indent setting is gone', async ({ page }) => {
    await expect(page.getByLabel('正文首行缩进')).toHaveCount(0)
    await expect(glyphs(page).first()).toHaveAttribute('style', cellStyle(0, 0))
  })
})

test('blank cells beside a title snap to the title text', async ({ page }) => {
  await openWith(page, makeDraft('标题', ['title']))
  await clickCell(page, 0, 15)
  await page.keyboard.type('一')
  await expect.poll(() => paperText(page)).toBe('标题一')
})
