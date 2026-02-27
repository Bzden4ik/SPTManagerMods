import React, { useState, useRef, useEffect } from 'react'
import './ModpackPage.css'

export default function ModpackPage({ settings, onAddToQueue, modpackState, setModpackState }) {
  const [exportKey, setExportKey] = useState('')
  const [exportCount, setExportCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const [importError, setImportError] = useState('')
  const [downloading, setDownloading] = useState(false)

  const cancelRef = useRef(false)

  const importKey = modpackState.importKey
  const importedMods = modpackState.importedMods
  const downloadItems = modpackState.downloadItems

  const setImportKey = (v) => setModpackState(s => ({ ...s, importKey: v }))
  const setImportedMods = (v) => setModpackState(s => ({ ...s, importedMods: v }))
  const setDownloadItems = (fn) => setModpackState(s => ({
    ...s, downloadItems: typeof fn === 'function' ? fn(s.downloadItems) : fn
  }))

  // Сбрасываем зависшие downloading → pending при монтировании
  useEffect(() => {
    if (!Array.isArray(modpackState.downloadItems)) return
    const hasDl = modpackState.downloadItems.some(it => it.status === 'downloading')
    if (hasDl) {
      setModpackState(s => ({
        ...s,
        downloadItems: s.downloadItems.map(it =>
          it.status === 'downloading' ? { ...it, status: 'pending', pct: null, mb: null } : it
        )
      }))
    }
  }, [])

  const doExport = async () => {
    const res = await window.electronAPI.modpackExport()
    if (res.error) { alert(res.error); return }
    setExportKey(res.key)
    setExportCount(res.count)
    setCopied(false)
  }

  const copyKey = () => {
    navigator.clipboard.writeText(exportKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const doImport = async () => {
    setImportError('')
    setImportedMods(null)
    setDownloadItems([])
    const res = await window.electronAPI.modpackImport({ key: importKey.trim() })
    if (res.error) { setImportError(res.error); return }
    setImportedMods(res.mods)
    setDownloadItems(res.mods.map(m => ({
      name: m.name, version: m.version, pct: null, mb: null, totalMb: null, status: 'pending'
    })))
  }

  const cancelDownload = () => {
    cancelRef.current = true
  }

  const downloadAll = async () => {
    if (!importedMods?.length) return
    const token = settings.forgeToken
    if (!token) { alert('Укажи Forge API токен в Настройках'); return }

    cancelRef.current = false
    setDownloading(true)

    // Сбрасываем ошибки/отменённые в pending
    setDownloadItems(prev => prev.map(it =>
      it.status === 'error' || it.status === 'cancelled' ? { ...it, status: 'pending', pct: null, mb: null } : it
    ))

    window.electronAPI.onDownloadProgress(({ filename, received, total }) => {
      const mb = (received / 1024 / 1024).toFixed(1)
      const totalMb = total > 1024 * 1024 ? (total / 1024 / 1024).toFixed(1) : null
      const pct = totalMb ? Math.min(99, Math.round(received / total * 100)) : null
      setDownloadItems(prev => prev.map((it, i) => {
        const slug = importedMods[i]?.slug || String(importedMods[i]?.id)
        if (filename.startsWith(slug)) return { ...it, pct, mb, totalMb, status: 'downloading' }
        return it
      }))
    })

    const downloaded = []
    for (let i = 0; i < importedMods.length; i++) {
      if (cancelRef.current) {
        // Помечаем оставшиеся pending как cancelled
        setDownloadItems(prev => prev.map((it, j) => j >= i && it.status === 'pending' ? { ...it, status: 'cancelled' } : it))
        break
      }
      // Пропускаем уже скачанные
      const currentStatus = downloadItems[i]?.status
      if (currentStatus === 'done') continue

      const mod = importedMods[i]
      setDownloadItems(prev => prev.map((it, j) => j === i ? { ...it, status: 'downloading' } : it))
      try {
        const verRes = await window.electronAPI.forgeGetModVersions({ token, modId: mod.id })
        const versions = verRes?.data
        if (!versions?.length) { setDownloadItems(prev => prev.map((it, j) => j === i ? { ...it, status: 'error' } : it)); continue }
        const ver = versions.find(v => v.version === mod.version) || versions[0]
        const dlUrl = ver.link || ver.download_url
        if (!dlUrl) { setDownloadItems(prev => prev.map((it, j) => j === i ? { ...it, status: 'error' } : it)); continue }
        const filename = `${mod.slug || mod.id}_${ver.version}.zip`
        const localPath = await window.electronAPI.forgeDownloadMod({ url: dlUrl, token, filename })
        downloaded.push({ path: localPath, name: filename, type: 'unknown', status: 'pending',
          meta: { id: mod.id, name: mod.name, version: ver.version, slug: mod.slug } })
        setDownloadItems(prev => prev.map((it, j) => j === i ? { ...it, pct: 100, status: 'done' } : it))
      } catch {
        setDownloadItems(prev => prev.map((it, j) => j === i ? { ...it, status: 'error' } : it))
      }
    }

    window.electronAPI.removeDownloadProgress()
    setDownloading(false)
    if (downloaded.length > 0) onAddToQueue(downloaded)
  }

  const resetImport = () => {
    cancelRef.current = true
    setImportKey('')
    setImportedMods(null)
    setDownloadItems([])
    setImportError('')
  }

  const doneCount = downloadItems.filter(it => it.status === 'done').length
  const totalCount = downloadItems.length
  const hasErrors = downloadItems.some(it => it.status === 'error')
  const hasPending = downloadItems.some(it => it.status === 'pending')

  return (
    <div className="modpack-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Modpack</h1>
          <p className="page-subtitle">Делись списком модов одним ключом</p>
        </div>
      </div>

      <div className="modpack-grid">
        <section className="card modpack-section">
          <div className="section-title">📤 Экспорт — поделиться своими модами</div>
          <p className="section-desc">Генерирует ключ со списком всех твоих установленных модов.</p>
          <button className="btn btn-accent" onClick={doExport}>Создать ключ</button>
          {exportKey && (
            <div className="key-box">
              <div className="key-meta">{exportCount} модов · ключ готов</div>
              <div className="key-text">{exportKey}</div>
              <button className="btn btn-ghost key-copy" onClick={copyKey}>{copied ? '✓ Скопировано' : 'Копировать'}</button>
            </div>
          )}
        </section>

        <section className="card modpack-section">
          <div className="section-title">📥 Импорт — установить чужие моды</div>
          <p className="section-desc">Вставь ключ от друга, чтобы скачать и установить все его моды.</p>
          <div className="import-row">
            <input className="key-input" placeholder="SPT-..." value={importKey}
              onChange={e => { setImportKey(e.target.value); setImportError('') }}
              disabled={downloading} />
            <button className="btn btn-ghost" onClick={doImport} disabled={!importKey.trim() || downloading}>Проверить</button>
            {importedMods && <button className="btn btn-ghost" onClick={resetImport} disabled={downloading}>✕ Сброс</button>}
          </div>
          {importError && <div className="import-error">✗ {importError}</div>}

          {downloadItems.length > 0 && (
            <div className="mp-download-list">
              {totalCount > 0 && (
                <div className="mp-progress-summary">
                  {downloading
                    ? `Скачиваю ${doneCount + 1} из ${totalCount}...`
                    : doneCount === totalCount ? `✓ Все ${totalCount} скачаны`
                    : hasErrors ? `Скачано ${doneCount}/${totalCount}, есть ошибки`
                    : `Готово к скачиванию: ${totalCount} модов`}
                </div>
              )}
              <div className="mp-items-scroll">
                {downloadItems.map((it, i) => (
                  <div key={i} className={`mp-dl-item mp-status-${it.status}`}>
                    <div className="mp-dl-info">
                      <span className="mp-dl-name">{it.name}</span>
                      {it.version && <span className="tag tag-ver">v{it.version}</span>}
                      <span className={`mp-dl-badge mp-badge-${it.status}`}>
                        {it.status === 'pending'     && '○ Ожидание'}
                        {it.status === 'downloading' && '⟳ Скачиваю'}
                        {it.status === 'done'        && '✓ Готово'}
                        {it.status === 'error'       && '✗ Ошибка'}
                        {it.status === 'cancelled'   && '— Отменено'}
                      </span>
                    </div>
                    {it.status === 'downloading' && (
                      <div className="dl-progress-wrap">
                        <div className="dl-progress">
                          <div className={`dl-bar ${it.pct === null ? 'dl-bar-indeterminate' : ''}`}
                            style={{ width: it.pct !== null ? it.pct + '%' : '100%' }} />
                        </div>
                        <span className="dl-pct">
                          {it.pct !== null ? `${it.pct}% · ${it.mb} / ${it.totalMb || '?'} МБ` : it.mb ? `${it.mb} МБ...` : '...'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mp-actions">
                {downloading ? (
                  <button className="btn btn-danger" onClick={cancelDownload}>✕ Отмена</button>
                ) : (
                  <button className="btn btn-accent" onClick={downloadAll}
                    disabled={!hasPending && !hasErrors}>
                    {hasErrors && hasPending ? `↓ Скачать оставшиеся (${downloadItems.filter(it => it.status === 'pending').length})`
                      : hasErrors ? '↺ Повторить ошибки'
                      : `↓ Скачать все (${totalCount})`}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
