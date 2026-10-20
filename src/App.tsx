import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, FilePlus2, HelpCircle, Minus, PanelLeftClose, PanelLeftOpen, Plus, Printer, Redo2, RotateCcw, Settings2, Undo2, X } from 'lucide-react'
import { hitTest, layoutDocument, type Layout } from './layout'
import { BLOCK_LABELS, DEFAULT_SETTINGS, emptyDraft, MAX_LENGTH, maxCellSize, normalizeSettings, PAGE_HEIGHT, PAGE_WIDTH, sampleDraft, STORAGE_KEY, validateDraft, withText, type BlockKind, type Draft, type Settings } from './model'

interface Selection { start: number; end: number; direction: 'forward' | 'backward' | 'none' }
interface Snapshot { draft: Draft; selection: Selection }
const START: Selection = { start: 0, end: 0, direction: 'none' }
const focusOffset = (s: Selection) => s.direction === 'backward' ? s.start : s.end
const readSelection = (el: HTMLTextAreaElement): Selection => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection })

function loadInitial(): { draft: Draft; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return { draft: raw ? validateDraft(JSON.parse(raw)) : sampleDraft(), error: '' }
  } catch { return { draft: sampleDraft(), error: '上次草稿未能读取。若有备份，可通过“导入”恢复。' } }
}

function downloadFile(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const initial = useMemo(loadInitial, [])
  const [draft, setDraft] = useState(initial.draft)
  const draftRef = useRef(draft)
  const [selection, setSelection] = useState<Selection>(START)
  const selectionRef = useRef(selection)
  const [focused, setFocused] = useState(false)
  const [composing, setComposing] = useState(false)
  const composition = useRef<Snapshot | null>(null)
  const undo = useRef<Snapshot[]>([])
  const redo = useRef<Snapshot[]>([])
  const [, refreshHistory] = useState(0)
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'failed'>('saving')
  const [toast, setToast] = useState(initial.error)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [fitScale, setFitScale] = useState(0.8)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const caretElement = useRef<HTMLSpanElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const grids = useRef<(HTMLDivElement | null)[]>([])
  const importInput = useRef<HTMLInputElement>(null)
  const pendingSelection = useRef<Selection | null>(null)
  const scrollToCaret = useRef(false)
  const dragAnchor = useRef<number | null>(null)
  const layout = useMemo(() => layoutDocument(draft), [draft])
  const layoutRef = useRef<Layout>(layout)
  layoutRef.current = layout
  const scale = zoom === 'fit' ? fitScale : zoom / 100
  const { settings } = draft
  const activeOffset = Math.min(focusOffset(selection), draft.text.length)
  const caret = layout.carets[activeOffset] ?? { page: 0, row: 0, column: settings.indent }
  const activeBlock = draft.text.slice(0, activeOffset).split('\n').length - 1
  const activeKind = draft.formats[activeBlock] ?? 'body'
  const gridWidth = settings.columns * settings.cellSize
  const gridHeight = settings.rows * (settings.cellSize + settings.rowGap) - settings.rowGap
  const gridLeft = (PAGE_WIDTH - gridWidth) / 2
  const gridTop = Math.max(112, (PAGE_HEIGHT - gridHeight) / 2)
  const pageGlyphs = useMemo(() => {
    const pages = Array.from({ length: layout.pages }, () => [] as typeof layout.glyphs)
    for (const glyph of layout.glyphs) pages[glyph.page].push(glyph)
    return pages
  }, [layout])

  function syncNativeInput() {
    const rect = caretElement.current?.getBoundingClientRect()
    if (rect && textarea.current) {
      textarea.current.style.left = `${Math.max(0, Math.min(window.innerWidth - 24, rect.left))}px`
      textarea.current.style.top = `${Math.max(0, Math.min(window.innerHeight - 32, rect.top))}px`
      textarea.current.style.fontSize = `${Math.max(16, draftRef.current.settings.cellSize * 0.72 * scale)}px`
      textarea.current.scrollTop = textarea.current.scrollHeight
    }
  }

  function remember(snapshot: Snapshot) {
    undo.current.push(snapshot)
    if (undo.current.length > 150) undo.current.shift()
    redo.current = []
    refreshHistory(n => n + 1)
  }

  function apply(next: Draft, nextSelection = selectionRef.current, record = true, focus = false) {
    if (record && next !== draftRef.current) remember({ draft: draftRef.current, selection: selectionRef.current })
    const safe = { ...nextSelection, start: Math.min(nextSelection.start, next.text.length), end: Math.min(nextSelection.end, next.text.length) }
    draftRef.current = next
    selectionRef.current = safe
    setDraft(next); setSelection(safe)
    if (focus) { pendingSelection.current = safe; scrollToCaret.current = true; setFocused(true) }
  }

  function select(next: Selection, shouldScroll = true) {
    selectionRef.current = next
    pendingSelection.current = next
    scrollToCaret.current = shouldScroll
    setSelection(next)
    textarea.current?.focus({ preventScroll: true })
    textarea.current?.setSelectionRange(next.start, next.end, next.direction)
  }

  function travelHistory(direction: 'undo' | 'redo') {
    if (composition.current) return
    const from = direction === 'undo' ? undo : redo
    const to = direction === 'undo' ? redo : undo
    const snapshot = from.current.pop()
    if (!snapshot) return
    to.current.push({ draft: draftRef.current, selection: selectionRef.current })
    refreshHistory(n => n + 1)
    apply(snapshot.draft, snapshot.selection, false, true)
  }

  useLayoutEffect(() => {
    const pending = pendingSelection.current
    if (pending && textarea.current && !composition.current) {
      textarea.current.focus({ preventScroll: true })
      textarea.current.setSelectionRange(pending.start, pending.end, pending.direction)
      pendingSelection.current = null
    }
    if (scrollToCaret.current && !dragAnchor.current) {
      caretElement.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      scrollToCaret.current = false
    }
    syncNativeInput()
  }, [draft, selection, scale])

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (workspace.current) setFitScale(Math.min(1, Math.max(0.25, (workspace.current.clientWidth - 56) / PAGE_WIDTH)))
    })
    if (workspace.current) observer.observe(workspace.current)
    window.addEventListener('scroll', syncNativeInput, true)
    return () => { observer.disconnect(); window.removeEventListener('scroll', syncNativeInput, true) }
  }, [scale])

  useEffect(() => {
    if (composing) return
    setSaveStatus('saving')
    const id = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(draft)); setSaveStatus('saved') }
      catch { setSaveStatus('failed') }
    }, 350)
    return () => clearTimeout(id)
  }, [draft, composing])

  useEffect(() => {
    const flush = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(draftRef.current)) } catch { /* visible save status handles errors */ } }
    window.addEventListener('pagehide', flush)
    const handleVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', handleVisibility) }
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 5500)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        exportDraft('json')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function changeSettings(patch: Partial<Settings>) {
    apply({ ...draftRef.current, settings: normalizeSettings({ ...draftRef.current.settings, ...patch }) })
  }

  function setBlock(kind: BlockKind) {
    const current = draftRef.current
    const sel = selectionRef.current
    const first = current.text.slice(0, sel.start).split('\n').length - 1
    const endOffset = sel.end > sel.start && current.text[sel.end - 1] === '\n' ? sel.end - 1 : sel.end
    const last = current.text.slice(0, endOffset).split('\n').length - 1
    const formats = current.formats.map((value, index) => index >= first && index <= last ? kind : value)
    apply({ ...current, formats }, sel, true, true)
  }

  function exportDraft(type: 'json' | 'txt') {
    const current = draftRef.current
    const name = (current.name.trim() || '未命名文稿').replace(/[\\/:*?"<>|]/g, '_')
    downloadFile(type === 'json' ? JSON.stringify(current, null, 2) : current.text,
      `${name}.${type}`, type === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8')
    setToast(type === 'json' ? '已导出备份，包含正文、格式和纸张设置。' : '已导出纯文字。')
    document.querySelector<HTMLDetailsElement>('.export-menu')?.removeAttribute('open')
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    try {
      if (file.size > 256_000) throw new Error('文件过大，请导入小于 256 KB 的文稿。')
      const content = await file.text()
      let next: Draft
      if (file.name.toLowerCase().endsWith('.json')) next = validateDraft(JSON.parse(content))
      else {
        const text = content.replace(/\r\n?/g, '\n')
        if (text.length > MAX_LENGTH) throw new Error('文稿过长，请分成每份不超过 20,000 个文本编码单元的文件。')
        next = { ...emptyDraft(), settings: draftRef.current.settings, name: file.name.replace(/\.[^.]+$/, ''), text, formats: text.split('\n').map(() => 'body') }
      }
      apply(next, START, true, true)
      setToast('已导入文稿。可以通过撤销返回导入前的内容。')
    } catch (error) { setToast(error instanceof Error ? error.message : '文件未能导入。') }
    if (importInput.current) importInput.current.value = ''
  }

  function newDocument(example = false) {
    if (draftRef.current.text && !window.confirm(example ? '载入示例会替换当前文稿。当前草稿可以通过撤销找回，是否继续？' : '新建文稿会替换当前草稿。建议先导出备份；操作后也可以撤销。是否继续？')) return
    apply(example ? sampleDraft() : { ...emptyDraft(), settings: draftRef.current.settings }, START, true, true)
  }

  function indexAtPoint(clientX: number, clientY: number) {
    let bestPage = 0
    let distance = Infinity
    grids.current.slice(0, layoutRef.current.pages).forEach((el, index) => {
      const rect = el?.getBoundingClientRect()
      if (!rect) return
      const d = Math.max(rect.top - clientY, 0, clientY - rect.bottom)
      if (d < distance) { bestPage = index; distance = d }
    })
    const rect = grids.current[bestPage]?.getBoundingClientRect()
    if (!rect) return 0
    const s = draftRef.current.settings
    const actualScale = rect.width / (s.columns * s.cellSize)
    const column = Math.max(0, Math.min(s.columns, (clientX - rect.left) / (s.cellSize * actualScale)))
    const row = Math.max(0, Math.min(s.rows - 1, Math.floor((clientY - rect.top) / ((s.cellSize + s.rowGap) * actualScale))))
    return hitTest(layoutRef.current, bestPage, row, column, s.rows)
  }

  function rangeTo(anchor: number, next: number): Selection {
    return { start: Math.min(anchor, next), end: Math.max(anchor, next), direction: next < anchor ? 'backward' : 'forward' }
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || composition.current) return
    event.preventDefault()
    const index = indexAtPoint(event.clientX, event.clientY)
    const existing = selectionRef.current
    const anchor = event.shiftKey ? (existing.direction === 'backward' ? existing.end : existing.start) : index
    dragAnchor.current = anchor
    event.currentTarget.setPointerCapture(event.pointerId)
    select(rangeTo(anchor, index), false)
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragAnchor.current === null) return
    select(rangeTo(dragAnchor.current, indexAtPoint(event.clientX, event.clientY)), false)
    const rect = workspace.current?.getBoundingClientRect()
    if (rect && workspace.current) {
      if (event.clientY > rect.bottom - 32) workspace.current.scrollTop += 18
      else if (event.clientY < rect.top + 32) workspace.current.scrollTop -= 18
    }
  }

  const saveLabel = saveStatus === 'saved' ? '已保存在此浏览器' : saveStatus === 'saving' ? '正在保存…' : '自动保存失败，请导出备份'
  return <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <header className="app-header">
      <a className="brand" href="/" aria-label="稿纸首页"><span className="brand-icon"><i /><i /><i /><i /></span><strong>稿纸</strong><span className="brand-en">GAOZHI</span></a>
      <div className={`save-state ${saveStatus === 'failed' ? 'error' : ''}`} role="status"><span className="status-dot" />{saveLabel}</div>
      <div className="header-actions">
        <button className="button subtle new-button" onClick={() => newDocument()}><FilePlus2 size={16} /><span>新建</span></button>
        <button className="button subtle" onClick={() => importInput.current?.click()}><ArrowUpFromLine size={16} /><span>导入</span></button>
        <details className="export-menu"><summary className="button subtle"><ArrowDownToLine size={16} /><span>导出</span><ChevronDown size={13} /></summary><div className="popover"><button onClick={() => exportDraft('json')}>稿纸备份 <small>.json · 保留格式</small></button><button onClick={() => exportDraft('txt')}>纯文字 <small>.txt</small></button></div></details>
        <button className="button primary" onClick={() => window.print()}><Printer size={16} /><span>打印 / PDF</span></button>
      </div>
      <input ref={importInput} type="file" accept=".txt,.json,text/plain,application/json" className="sr-only" tabIndex={-1} aria-label="导入文稿文件" onChange={event => void importFile(event.target.files?.[0])} />
    </header>

    <div className="editor-toolbar">
      <div className="document-name-wrap"><button className="icon-button desktop-sidebar-toggle" aria-label={sidebarCollapsed ? '展开设置' : '收起设置'} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><button className="icon-button mobile-settings" aria-label="纸张设置" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}><Settings2 size={19} /></button><input className="document-name" aria-label="文稿名称" value={draft.name} maxLength={100} onChange={event => apply({ ...draftRef.current, name: event.target.value }, selectionRef.current, false)} /></div>
      <div className="format-tools" role="group" aria-label="当前段落格式">{(['body', 'title', 'salutation', 'signature'] as BlockKind[]).map(kind => <button key={kind} className={activeKind === kind ? 'active' : ''} aria-pressed={activeKind === kind} onMouseDown={e => e.preventDefault()} onClick={() => setBlock(kind)}>{BLOCK_LABELS[kind]}</button>)}</div>
      <div className="toolbar-right"><div className="history-tools"><button className="icon-button" aria-label="撤销" title="撤销 ⌘/Ctrl Z" disabled={!undo.current.length || composing} onMouseDown={e => e.preventDefault()} onClick={() => travelHistory('undo')}><Undo2 size={17} /></button><button className="icon-button" aria-label="重做" title="重做 ⌘/Ctrl Shift Z" disabled={!redo.current.length || composing} onMouseDown={e => e.preventDefault()} onClick={() => travelHistory('redo')}><Redo2 size={17} /></button></div><div className="zoom-tools"><button className="icon-button" aria-label="缩小" onClick={() => setZoom(Math.max(35, Math.round(scale * 100 / 5) * 5 - 10))}><Minus size={14} /></button><select aria-label="显示缩放" value={zoom} onChange={event => setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}><option value="fit">适应宽度</option>{Array.from(new Set([35, 50, 65, 75, 85, 100, 115, 125, ...(typeof zoom === 'number' ? [zoom] : [])])).sort((a, b) => a - b).map(n => <option key={n} value={n}>{n}%</option>)}</select><button className="icon-button" aria-label="放大" onClick={() => setZoom(Math.min(125, Math.round(scale * 100 / 5) * 5 + 10))}><Plus size={14} /></button></div></div>
    </div>

    <main className="editor-main">
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="关闭设置" onClick={() => setSidebarOpen(false)} />}
      <aside className={`settings-panel ${sidebarOpen ? 'mobile-open' : ''}`} aria-label="稿纸设置">
        <div className="panel-title"><h1>纸张设置</h1><button className="icon-button mobile-settings" aria-label="关闭纸张设置" onClick={() => setSidebarOpen(false)}><X size={17} /></button><span className="small-badge">A4 横排</span></div>
        <label className="field"><span>稿纸规格</span><select aria-label="稿纸规格" value={settings.columns === 20 && [15, 20, 25].includes(settings.rows) ? `${settings.rows}` : 'custom'} onChange={event => { if (event.target.value !== 'custom') changeSettings({ columns: 20, rows: Number(event.target.value) }) }}><option value="15">300 字 · 20 × 15</option><option value="20">400 字 · 20 × 20</option><option value="custom">自定义行列</option></select></label>
        <div className="field-row"><label className="field"><span>每行格数</span><input aria-label="每行格数" type="number" min={10} max={24} value={settings.columns} onChange={event => changeSettings({ columns: Number(event.target.value) })} /></label><label className="field"><span>每页行数</span><input aria-label="每页行数" type="number" min={10} max={24} value={settings.rows} onChange={event => changeSettings({ rows: Number(event.target.value) })} /></label></div>
        <label className="field range-field"><span>格子大小 <output>{(settings.cellSize * 25.4 / 96).toFixed(1)} mm</output></span><input aria-label="格子大小" type="range" min={18} max={maxCellSize(settings)} value={settings.cellSize} onChange={event => changeSettings({ cellSize: Number(event.target.value) })} /></label>
        <label className="field range-field"><span>行间留白 <output>{(settings.rowGap * 25.4 / 96).toFixed(1)} mm</output></span><input aria-label="行间留白" type="range" min={4} max={16} value={settings.rowGap} onChange={event => changeSettings({ rowGap: Number(event.target.value) })} /></label>
        <div className="settings-section"><h2>书写规则</h2><label className="field"><span>正文首行缩进</span><select aria-label="正文首行缩进" value={settings.indent} onChange={event => changeSettings({ indent: Number(event.target.value) })}>{[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 0 ? '不缩进' : `空 ${n} 格`}</option>)}</select></label><label className="field"><span>行末标点处理</span><select aria-label="行末标点处理" value={settings.punctuation} onChange={event => changeSettings({ punctuation: event.target.value as Settings['punctuation'] })}><option value="hang">行末悬挂</option><option value="strict">严格占格</option></select><small>{settings.punctuation === 'hang' ? '行满时，点号或后引号可写在格外。' : '将前一字一并移行，避免标点落在行首。'}</small></label><label className="toggle-field"><span>数字、英文两字一格<small>连续半角字母和数字成对排入</small></span><input aria-label="数字、英文两字一格" type="checkbox" checked={settings.pairAscii} onChange={event => changeSettings({ pairAscii: event.target.checked })} /><span className="switch" /></label></div>
        <div className="settings-section"><h2>纸面样式</h2><label className="field"><span>预览字体</span><select aria-label="预览字体" value={settings.font} onChange={event => changeSettings({ font: event.target.value as Settings['font'] })}><option value="kai">楷体 · 便于誊抄</option><option value="song">宋体 · 清晰规整</option></select></label><div className="field color-field"><span>格线颜色</span><div role="group" aria-label="格线颜色">{[['#bb786b', '朱砂'], ['#628a77', '松绿'], ['#858581', '石灰']].map(([color, label]) => <button key={color} className={`color-swatch ${settings.gridColor === color ? 'selected' : ''}`} style={{ '--swatch': color } as CSSProperties} aria-label={label} aria-pressed={settings.gridColor === color} onClick={() => changeSettings({ gridColor: color })}>{settings.gridColor === color && <Check size={13} />}</button>)}</div></div></div>
        <button className="reset-button" onClick={() => apply({ ...draftRef.current, settings: { ...DEFAULT_SETTINGS } })}><RotateCcw size={14} />恢复默认设置</button>
        <div className="sidebar-note"><span className="note-mark">纸上有序，落笔从容。</span><p>先在这里把文字排好，<br />再安心地写到纸上。</p><button onClick={() => newDocument(true)}>载入示例文稿 <span>↗</span></button></div>
      </aside>

      <div className="workspace" ref={workspace}>
        <div className="workspace-heading"><span>誊抄预览</span><span>点击稿纸开始输入</span></div>
        <div className="pages">
          {pageGlyphs.map((glyphs, pageIndex) => <div className="page-group" key={pageIndex}>
            <div className="page-caption"><span>第 {String(pageIndex + 1).padStart(2, '0')} 页</span><span>{settings.columns} × {settings.rows}</span></div>
            <div className="paper-shell" style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}>
              <article className={`paper font-${settings.font}`} style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})`, '--grid-color': settings.gridColor } as CSSProperties} aria-label={`第 ${pageIndex + 1} 页稿纸`}>
                <div className="paper-head"><span>文 稿</span><span>MANUSCRIPT</span></div>
                <div className="paper-grid" data-page={pageIndex} ref={el => { grids.current[pageIndex] = el }} style={{ left: gridLeft, top: gridTop, width: gridWidth, height: gridHeight, '--cell-size': `${settings.cellSize}px`, '--row-gap': `${settings.rowGap}px` } as CSSProperties} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragAnchor.current = null }} onPointerCancel={() => { dragAnchor.current = null }}>
                  <div className="grid-lines" aria-hidden="true">{Array.from({ length: settings.rows }, (_, row) => <div className="grid-row" key={row} style={{ height: settings.cellSize, marginBottom: row === settings.rows - 1 ? 0 : settings.rowGap, gridTemplateColumns: `repeat(${settings.columns}, 1fr)` }}>{Array.from({ length: settings.columns }, (_, col) => <span key={col} />)}</div>)}</div>
                  <div className="glyph-layer" aria-hidden="true">{glyphs.map(glyph => <span key={`${glyph.start}-${glyph.end}`} className={`glyph ${glyph.hanging ? 'hanging' : ''} ${glyph.kind === 'title' ? 'title-glyph' : ''} ${glyph.end > selection.start && glyph.start < selection.end && focused ? 'selected-glyph' : ''} ${composing && glyph.end > (composition.current?.selection.start ?? activeOffset) && glyph.start < activeOffset ? 'composing-glyph' : ''}`} data-start={glyph.start} style={{ left: glyph.column * settings.cellSize, top: glyph.row * (settings.cellSize + settings.rowGap), width: glyph.hanging ? settings.cellSize * 0.5 : glyph.span * settings.cellSize, height: settings.cellSize, fontSize: settings.cellSize * (glyph.text.length === 2 && /^[A-Za-z0-9]+$/.test(glyph.text) ? 0.62 : 0.76) }}>{glyph.text}</span>)}</div>
                  {pageIndex === caret.page && <span className={`paper-caret ${focused && selection.start === selection.end ? 'visible' : ''} ${composing ? 'composing' : ''}`} ref={caretElement} aria-hidden="true" style={{ left: Math.min(caret.column, settings.columns - 0.05) * settings.cellSize, top: caret.row * (settings.cellSize + settings.rowGap) + settings.cellSize * 0.12, height: settings.cellSize * 0.76 }} />}
                  {!draft.text && pageIndex === 0 && <span className="empty-hint" style={{ top: settings.cellSize + settings.rowGap + 12 }}>点击任意位置，写下第一句话。</span>}
                </div>
                <div className="paper-foot"><span>{settings.columns} × {settings.rows} = {settings.columns * settings.rows}</span><span>稿纸 · GAOZHI</span><span>第 {pageIndex + 1} 页</span></div>
              </article>
            </div>
          </div>)}
        </div>
        <div className="workspace-bottom">文字仅保存在此浏览器中。重要文稿请定期导出备份。</div>
      </div>
    </main>

    <footer className="status-bar"><div><span><b>{layout.characters.toLocaleString()}</b> 字<span className="stat-detail">（含标点与空格）</span></span><i /><span>共 <b>{layout.pages}</b> 页</span></div><div><span>第 {caret.page + 1} 页 · 第 {caret.row + 1} 行 · 第 {Math.min(settings.columns, Math.floor(caret.column) + 1)} 格</span><i /><details className="help-menu"><summary aria-label="使用说明"><HelpCircle size={15} /><span>使用说明</span></summary><div className="popover help-popover"><strong>像在纸上写字一样</strong><p>点击稿纸定位光标，直接输入或粘贴。按 Enter 另起一段，新段落默认使用正文格式。</p><p>选中一段或多段后，可切换标题、称呼与落款。用方向键移动光标，按 Shift 配合方向键选择文字。</p><p>⌘ / Ctrl + Z 撤销<br />⌘ / Ctrl + Shift + Z 重做<br />⌘ / Ctrl + S 导出备份</p><p>打印时选择 A4、100% 缩放，关闭浏览器页眉页脚。格线属于页面内容，无须开启背景图形。</p></div></details></div></footer>

    <p id="editor-instructions" className="sr-only">在稿纸上输入正文。Enter 开始新段落。使用顶部按钮设置段落格式，使用方向键移动，Shift 加方向键选择。全文不含换行最多 20,000 个文本编码单元。</p>
    <textarea ref={textarea} className="native-input" aria-label="稿纸正文" aria-describedby="editor-instructions" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={draft.text} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onSelect={event => {
      if (pendingSelection.current || composition.current) return
      const next = readSelection(event.currentTarget)
      if (next.start !== selectionRef.current.start || next.end !== selectionRef.current.end || next.direction !== selectionRef.current.direction) {
        selectionRef.current = next; setSelection(next)
      }
    }} onChange={event => {
      const text = event.currentTarget.value
      if (text.length > MAX_LENGTH) { event.currentTarget.value = draftRef.current.text; setToast('文稿已达到第一版的长度上限，请拆分文稿。'); return }
      const nextSelection = readSelection(event.currentTarget)
      scrollToCaret.current = true
      apply(withText(draftRef.current, text), nextSelection, !composition.current)
    }} onCompositionStart={() => {
      composition.current = { draft: draftRef.current, selection: selectionRef.current }
      setComposing(true)
    }} onCompositionEnd={event => {
      const before = composition.current
      composition.current = null; setComposing(false)
      const text = event.currentTarget.value
      if (text.length > MAX_LENGTH) {
        if (before) apply(before.draft, before.selection, false, true)
        setToast('文稿已达到第一版的长度上限，请拆分文稿。')
        return
      }
      if (before && before.draft.text !== text) remember(before)
      apply(withText(draftRef.current, text), readSelection(event.currentTarget), false)
    }} onKeyDown={event => {
      if (composition.current || event.nativeEvent.isComposing) return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); travelHistory(event.shiftKey ? 'redo' : 'undo'); return }
      if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); travelHistory('redo'); return }
      if (mod || event.altKey) return
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const current = selectionRef.current
        const currentIndex = focusOffset(current)
        const pos = layoutRef.current.carets[currentIndex]
        if (!pos) return
        let absoluteRow = pos.page * settings.rows + pos.row
        let column = pos.column
        if (event.key === 'ArrowUp') absoluteRow = Math.max(0, absoluteRow - 1)
        if (event.key === 'ArrowDown') absoluteRow = Math.min(layoutRef.current.pages * settings.rows - 1, absoluteRow + 1)
        if (event.key === 'Home') column = 0
        if (event.key === 'End') column = settings.columns
        const next = hitTest(layoutRef.current, Math.floor(absoluteRow / settings.rows), absoluteRow % settings.rows, column, settings.rows)
        const anchor = current.direction === 'backward' ? current.end : current.start
        select(event.shiftKey ? rangeTo(anchor, next) : { start: next, end: next, direction: 'none' })
      }
    }} />
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast('')}><X size={15} /></button></div>}
  </div>
}
