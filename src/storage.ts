import { sampleDraft, STORAGE_KEY, validateDraft, type Draft } from './model'

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>
export interface LoadResult {
  draft: Draft
  error: string
  /** False when writing would overwrite an unreadable draft that has no backup. */
  autosave: boolean
  /** Raw stored text that failed to load, kept so the user can download it. */
  unreadable: string | null
}

export const BACKUP_KEY = 'gaozhi:draft:v1:unreadable'

function readRaw(storage: DraftStorage): string | null {
  try { return storage.getItem(STORAGE_KEY) } catch { return null }
}

/** Load the saved draft; an unreadable one is copied aside before autosave can replace it. */
export function loadDraft(storage: DraftStorage): LoadResult {
  const raw = readRaw(storage)
  if (raw === null) return { draft: sampleDraft(), error: '', autosave: true, unreadable: null }
  try {
    return { draft: validateDraft(JSON.parse(raw)), error: '', autosave: true, unreadable: null }
  } catch {
    try {
      storage.setItem(BACKUP_KEY, raw)
      return { draft: sampleDraft(), autosave: true, unreadable: raw, error: '上次草稿未能读取，原内容已另行保留，可在“导出”中下载。' }
    } catch {
      return { draft: sampleDraft(), autosave: false, unreadable: raw, error: '上次草稿未能读取，也无法另存。自动保存已暂停，在“导出”中下载原内容后恢复。' }
    }
  }
}

export function readBackup(storage: DraftStorage): string | null {
  try { return storage.getItem(BACKUP_KEY) } catch { return null }
}
