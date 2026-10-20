import { describe, expect, it } from 'vitest'
import { emptyDraft, STORAGE_KEY } from './model'
import { BACKUP_KEY, loadDraft, readBackup, type DraftStorage } from './storage'

function memoryStorage(initial: Record<string, string> = {}, failWrites = false): DraftStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: key => data[key] ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error('QuotaExceededError')
      data[key] = value
    },
  }
}

describe('loadDraft', () => {
  it('loads the sample draft when nothing is stored', () => {
    const result = loadDraft(memoryStorage())
    expect(result.error).toBe('')
    expect(result.autosave).toBe(true)
    expect(result.unreadable).toBeNull()
    expect(result.draft.text.length).toBeGreaterThan(0)
  })

  it('restores a valid stored draft', () => {
    const stored = { ...emptyDraft(), name: '测试', text: '你好\n世界', formats: ['title', 'body'] }
    const result = loadDraft(memoryStorage({ [STORAGE_KEY]: JSON.stringify(stored) }))
    expect(result.error).toBe('')
    expect(result.autosave).toBe(true)
    expect(result.draft.text).toBe('你好\n世界')
    expect(result.draft.formats).toEqual(['title', 'body'])
  })

  it('copies an unreadable draft to the backup key before anything can overwrite it', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{broken json' })
    const result = loadDraft(storage)
    expect(storage.data[BACKUP_KEY]).toBe('{broken json')
    expect(storage.data[STORAGE_KEY]).toBe('{broken json')
    expect(result.autosave).toBe(true)
    expect(result.unreadable).toBe('{broken json')
    expect(result.error).toContain('导出')
  })

  it('backs up drafts that parse but fail validation', () => {
    const raw = JSON.stringify({ version: 2, text: '未来格式' })
    const storage = memoryStorage({ [STORAGE_KEY]: raw })
    loadDraft(storage)
    expect(storage.data[BACKUP_KEY]).toBe(raw)
  })

  it('pauses autosave when the unreadable draft cannot be backed up', () => {
    const result = loadDraft(memoryStorage({ [STORAGE_KEY]: '{broken json' }, true))
    expect(result.autosave).toBe(false)
    expect(result.unreadable).toBe('{broken json')
    expect(result.error).toContain('暂停')
  })

  it('treats a throwing storage as empty', () => {
    const storage: DraftStorage = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => undefined,
    }
    const result = loadDraft(storage)
    expect(result.unreadable).toBeNull()
    expect(result.autosave).toBe(true)
  })
})

describe('readBackup', () => {
  it('returns the backed-up raw draft or null', () => {
    expect(readBackup(memoryStorage())).toBeNull()
    expect(readBackup(memoryStorage({ [BACKUP_KEY]: 'raw' }))).toBe('raw')
  })

  it('returns null when storage access throws', () => {
    const storage: DraftStorage = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => undefined,
    }
    expect(readBackup(storage)).toBeNull()
  })
})
