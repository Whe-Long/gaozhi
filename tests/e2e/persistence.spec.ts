import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { BACKUP_KEY, makeDraft, openWith, paperText, seedRaw, setCaret, STORAGE_KEY, storedDraft } from './helpers'

test.describe('local saving', () => {
  test('a fresh browser starts with the sample draft', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByLabel('文稿名称')).toHaveValue('写给未来的自己')
    await expect.poll(() => paperText(page)).toContain('亲爱的自己：')
  })

  test('text and settings survive a reload', async ({ page }) => {
    await openWith(page, makeDraft('题目\n正文'))
    await page.getByLabel('行末标点处理').selectOption('strict')
    await setCaret(page, 5)
    await page.keyboard.type('内容')
    await expect.poll(async () => (await storedDraft(page))?.text).toBe('题目\n正文内容')

    await page.reload()
    await expect.poll(() => paperText(page)).toBe('题目正文内容')
    await expect(page.getByLabel('行末标点处理')).toHaveValue('strict')
  })

  test('the same draft lays out identically before and after reload', async ({ page }) => {
    await page.goto('/')
    const snapshot = () => page.locator('.glyph').evaluateAll(nodes =>
      nodes.map(n => `${n.closest('.paper-grid')?.getAttribute('data-page')}:${(n as HTMLElement).style.left},${(n as HTMLElement).style.top}`))
    await expect.poll(async () => (await snapshot()).length).toBeGreaterThan(0)
    const before = await snapshot()
    await page.reload()
    await expect.poll(snapshot).toEqual(before)
  })

  test('an unreadable draft is kept and offered for download', async ({ page }) => {
    await seedRaw(page, '{坏数据')
    await page.goto('/')
    await expect(page.locator('.toast')).toContainText('原内容已另行保留')
    expect(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY)).toBe('{坏数据')

    await page.locator('.export-menu summary').click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: /无法读取的草稿/ }).click()
    expect((await download).suggestedFilename()).toBe('无法读取的草稿.txt')
  })

  test('autosave pauses when the unreadable draft cannot be backed up', async ({ page }) => {
    await page.addInitScript(key => {
      const setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === key) throw new DOMException('full', 'QuotaExceededError')
        return setItem.call(this, k, v)
      }
    }, BACKUP_KEY)
    await seedRaw(page, '{坏数据')
    await page.goto('/')
    await expect(page.locator('.save-state')).toHaveText('自动保存已暂停')
    await page.reload()
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe('{坏数据')
  })

  test('a JSON backup can be exported and imported again', async ({ page }) => {
    await openWith(page, makeDraft('备份内容\n张三', { columns: 16 }))
    await page.locator('.export-menu summary').click()
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: /稿纸备份/ }).click()
    const download = await downloadEvent
    const backup = { name: download.suggestedFilename(), mimeType: 'application/json', buffer: await readFile(await download.path()) }

    page.once('dialog', dialog => void dialog.accept())
    await page.getByRole('button', { name: '新建' }).click()
    await expect.poll(() => paperText(page)).toBe('')

    await page.locator('input[type=file]').setInputFiles(backup)
    await expect.poll(() => paperText(page)).toBe('备份内容张三')
    expect(backup.name).toBe('测试文稿.json')
    await expect(page.getByLabel('每行格数')).toHaveValue('16')
  })

  test('importing over existing text asks first and keeps it when cancelled', async ({ page }) => {
    await openWith(page, makeDraft('原来的内容'))
    const file = { name: '新文稿.txt', mimeType: 'text/plain', buffer: Buffer.from('导入的内容') }
    const messages: string[] = []

    page.once('dialog', dialog => { messages.push(dialog.message()); void dialog.dismiss() })
    await page.locator('input[type=file]').setInputFiles(file)
    await expect.poll(() => messages).toHaveLength(1)
    expect(messages[0]).toContain('新文稿.txt')
    await expect.poll(() => paperText(page)).toBe('原来的内容')

    page.once('dialog', dialog => void dialog.accept())
    await page.locator('input[type=file]').setInputFiles(file)
    await expect.poll(() => paperText(page)).toBe('导入的内容')
    await expect(page.getByLabel('文稿名称')).toHaveValue('新文稿')
  })

  test('importing into an empty draft does not ask', async ({ page }) => {
    await openWith(page, makeDraft(''))
    let asked = false
    page.on('dialog', dialog => { asked = true; void dialog.dismiss() })
    await page.locator('input[type=file]').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('内容') })
    await expect.poll(() => paperText(page)).toBe('内容')
    expect(asked).toBe(false)
  })

  test('an invalid backup is rejected before asking', async ({ page }) => {
    await openWith(page, makeDraft('原来的内容'))
    let asked = false
    page.on('dialog', dialog => { asked = true; void dialog.dismiss() })
    await page.locator('input[type=file]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
    await expect(page.locator('.toast')).toContainText('不受支持')
    await page.locator('input[type=file]').setInputFiles({ name: 'y.json', mimeType: 'application/json', buffer: Buffer.from('not json') })
    await expect(page.locator('.toast')).toContainText('这不是有效的稿纸备份文件')
    expect(asked).toBe(false)
    await expect.poll(() => paperText(page)).toBe('原来的内容')
  })
})
