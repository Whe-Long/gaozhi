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
    await expect(page.locator('.preedit')).toHaveText('ni')
    await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
    await cdp.send('Input.insertText', { text: '你好' })
    await expect.poll(() => paperText(page)).toBe('开头你好')
    await expect(page.locator('.preedit')).toHaveCount(0)

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => paperText(page)).toBe('开头')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(() => paperText(page)).toBe('开头你好')
  })

  test('pinyin being composed stays out of the grid and shows as one string', async ({ page }) => {
    await openWith(page, makeDraft('我说\n后文'))
    const positions = () => glyphs(page).evaluateAll(nodes => nodes.map(n => `${n.textContent}@${(n as HTMLElement).style.left},${(n as HTMLElement).style.top}`))
    const before = await positions()
    await setCaret(page, 2)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'wo shi', selectionStart: 6, selectionEnd: 6 })

    const preedit = page.locator('.preedit')
    await expect(preedit).toHaveText('wo shi')
    // The preedit starts at the caret cell: first row, third cell.
    await expect(preedit).toHaveAttribute('style', /left: 60px; top: 0px/)
    expect(await positions()).toEqual(before)
    await expect(page.locator('.status-bar')).toContainText('4 字')

    await cdp.send('Input.insertText', { text: '我是' })
    await expect.poll(() => paperText(page)).toBe('我说我是后文')
    await expect(preedit).toHaveCount(0)
  })

  test('composing over a selection hides the replaced text until commit', async ({ page }) => {
    await openWith(page, makeDraft('旧字新'))
    await setCaret(page, 0, 2)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'xin', selectionStart: 3, selectionEnd: 3 })
    await expect(page.locator('.preedit')).toHaveText('xin')
    await expect.poll(() => paperText(page)).toBe('新')
    await cdp.send('Input.insertText', { text: '新' })
    await expect.poll(() => paperText(page)).toBe('新新')
  })

  test('pasting several paragraphs keeps them as separate body paragraphs', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openWith(page, makeDraft('标题'))
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

  test('there are no paragraph format buttons or storage note', async ({ page }) => {
    await openWith(page, makeDraft('正文'))
    for (const label of ['正文', '标题', '称呼', '落款']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
    }
    await expect(page.getByText('文字仅保存在此浏览器中')).toHaveCount(0)
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
