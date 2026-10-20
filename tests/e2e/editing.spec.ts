import { expect, test } from '@playwright/test'
import { clickCell, editor, glyphs, makeDraft, openWith, pageCount, paperText, setCaret } from './helpers'

test.describe('typing and editing', () => {
  test('clicking the paper focuses the editor and typed text appears in cells', async ({ page }) => {
    await openWith(page, makeDraft(''))
    await expect(page.getByText('点击任意位置，写下第一句话。')).toBeVisible()
    await clickCell(page, 0, 0)
    await expect(editor(page)).toBeFocused()
    await page.keyboard.type('春天来了。')
    await expect.poll(() => paperText(page)).toBe('春天来了。')
    await expect(page.locator('.status-bar')).toContainText('5 字')
    await expect(page.locator('.status-bar')).toContainText('第 1 页 · 第 1 行 · 第 6 格')
  })

  test('IME composition commits as one edit and one undo step', async ({ page }) => {
    await openWith(page, makeDraft('开头'))
    await setCaret(page, 2)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
    await expect(page.locator('.paper-caret.composing')).toHaveCount(1)
    await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
    await cdp.send('Input.insertText', { text: '你好' })
    await expect.poll(() => paperText(page)).toBe('开头你好')
    await expect(page.locator('.paper-caret.composing')).toHaveCount(0)

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => paperText(page)).toBe('开头')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(() => paperText(page)).toBe('开头你好')
  })

  test('pasting several paragraphs keeps them as separate body paragraphs', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openWith(page, makeDraft('标题', ['title']))
    await setCaret(page, 2)
    await page.evaluate(() => navigator.clipboard.writeText('\n第一段。\n第二段。'))
    await page.keyboard.press('ControlOrMeta+v')
    await expect.poll(() => paperText(page)).toBe('标题第一段。第二段。')
    // Each pasted paragraph starts in the first cell of its own row.
    await expect(glyphs(page).filter({ hasText: '第' }).first()).toHaveAttribute('style', /left: 0px; top: 42px/)
    await expect(glyphs(page).filter({ hasText: '第' }).last()).toHaveAttribute('style', /left: 0px; top: 84px/)
  })

  test('deleting a selection across pages reflows and undo restores it', async ({ page }) => {
    const text = Array.from({ length: 30 }, (_, i) => `第${i + 1}段。`).join('\n')
    await openWith(page, makeDraft(text))
    await expect.poll(() => pageCount(page)).toBe(2)
    await expect(page.locator('.status-bar')).toContainText('共 2 页')

    const from = text.indexOf('第5段')
    const to = text.indexOf('第25段')
    await setCaret(page, from, to)
    await page.keyboard.press('Backspace')
    await expect.poll(() => pageCount(page)).toBe(1)
    await expect.poll(() => paperText(page)).toContain('第4段。第25段。')

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => pageCount(page)).toBe(2)
    await expect.poll(() => paperText(page)).toBe(text.replace(/\n/g, ''))
  })

  test('Enter at the end of a title keeps the next paragraph format', async ({ page }) => {
    await openWith(page, makeDraft('标题\n张三', ['title', 'signature']))
    await setCaret(page, 2)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '正文', exact: true })).toHaveAttribute('aria-pressed', 'true')
    // The signature stays right-aligned, now on row 3.
    await expect(glyphs(page).filter({ hasText: '张' })).toHaveAttribute('style', /left: 540px; top: 84px/)
  })

  test('pasting a line that repeats the next paragraph start keeps formats in place', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openWith(page, makeDraft('标题\n张三', ['title', 'signature']))
    await setCaret(page, 2)
    await page.evaluate(() => navigator.clipboard.writeText('\n张'))
    await page.keyboard.press('ControlOrMeta+v')
    await expect.poll(() => paperText(page)).toBe('标题张张三')
    // The pasted "张" is a body line; "张三" stays right-aligned below it.
    await expect(glyphs(page).nth(2)).toHaveAttribute('style', /left: 0px; top: 42px/)
    await expect(glyphs(page).nth(3)).toHaveAttribute('style', /left: 540px; top: 84px/)
  })

  test('format buttons change the paragraph under the caret', async ({ page }) => {
    await openWith(page, makeDraft('落款人'))
    await setCaret(page, 1)
    await page.getByRole('button', { name: '落款' }).click()
    await expect(page.getByRole('button', { name: '落款' })).toHaveAttribute('aria-pressed', 'true')
    // Right-aligned: the last character sits in the last of 20 cells.
    await expect(glyphs(page).filter({ hasText: '人' })).toHaveAttribute('style', /left: 570px/)
    await expect(editor(page)).toBeFocused()
  })

  test('arrow keys move between visual lines', async ({ page }) => {
    await openWith(page, makeDraft('一\n二'))
    await setCaret(page, 1)
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.status-bar')).toContainText('第 2 行')
    await page.keyboard.press('Shift+ArrowUp')
    await expect(page.locator('.selected-glyph')).not.toHaveCount(0)
  })
})
