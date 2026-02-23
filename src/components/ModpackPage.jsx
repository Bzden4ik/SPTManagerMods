import React, { useState } from 'react'
import './ModpackPage.css'

export default function ModpackPage({ settings, onAddToQueue }) {
  const [exportKey, setExportKey] = useState('')
  const [exportCount, setExportCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const [importKey, setImportKey] = useState('')
  const [importedMods, setImportedMods] = useState(null)
  const [importError, setImportError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadLog, setDownloadLog] = useState([])

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
    const res = await window.electronAPI.modpackImport({ key: importKey.trim() })
    if (res.error) { setImportError(res.error); return }
    setImportedMods(res.mods)
  }

  const downloadAll = async () => {
    if (!importedMods?.length) return
    const token = settings.forgeToken
    if (!token) { alert('Укажи Forge API токен в Настройках'); return }

    setDownloading(true)
    setDownloadLog([])
    const log = (msg) => setDownloadLog(prev => [...prev, msg])
    const downloaded = []

    for (const mod of importedMods) {
      log(`⟳ ${mod.name} v${mod.version}...`)
      try {
        const verRes = await window.electronAPI.forgeGetModVersions({ token, modId: mod.id })
        const versions = verRes?.data
        if (!versions?.length) { log(`✗ ${mod.name} — версии не найдены`); continue }

        // Ищем нужную версию или берём последнюю
        const ver = versions.find(v => v.version === mod.version) || versions[0]
        const dlUrl = ver.link || ver.download_url
        if (!dlUrl) { log(`✗ ${mod.name} — нет ссылки для скачивания`); continue }

        const filename = `${mod.slug || mod.id}_${ver.version}.zip`
        const localPath = await window.electronAPI.forgeDownloadMod({ url: dlUrl, token, filename })
        downloaded.push({
          path: localPath, name: filename, type: 'unknown', status: 'pending',
          meta: { id: mod.id, name: mod.name, version: ver.version, slug: mod.slug }
        })
        log(`✓ ${mod.name} v${ver.version}`)
      } catch (e) {
        log(`✗ ${mod.name} — ${e.message}`)
      }
    }

    setDownloading(false)
    if (downloaded.length > 0) {
      onAddToQueue(downloaded)
      log(`\n→ ${downloaded.length} модов добавлено в очередь установки`)
    }
  }

  return (
    <div className="modpack-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Modpack</h1>
          <p className="page-subtitle">Делись списком модов одним ключом</p>
        </div>
      </div>

      <div className="modpack-grid">
        {/* Экспорт */}
        <section className="card modpack-section">
          <div className="section-title">📤 Экспорт — поделиться своими модами</div>
          <p className="section-desc">Генерирует ключ со списком всех твоих установленных модов. Отправь его другу.</p>
          <button className="btn btn-accent" onClick={doExport}>Создать ключ</button>
          {exportKey && (
            <div className="key-box">
              <div className="key-meta">{exportCount} модов · ключ готов</div>
              <div className="key-text">{exportKey}</div>
              <button className="btn btn-ghost key-copy" onClick={copyKey}>
                {copied ? '✓ Скопировано' : 'Копировать'}
              </button>
            </div>
          )}
        </section>

        {/* Импорт */}
        <section className="card modpack-section">
          <div className="section-title">📥 Импорт — установить чужие моды</div>
          <p className="section-desc">Вставь ключ от друга, чтобы скачать и установить все его моды.</p>
          <div className="import-row">
            <input
              className="key-input"
              placeholder="SPT-..."
              value={importKey}
              onChange={e => { setImportKey(e.target.value); setImportedMods(null); setImportError('') }}
            />
            <button className="btn btn-ghost" onClick={doImport} disabled={!importKey.trim()}>Проверить</button>
          </div>
          {importError && <div className="import-error">✗ {importError}</div>}
          {importedMods && (
            <div className="import-result">
              <div className="import-count">{importedMods.length} модов в ключе:</div>
              <div className="import-list">
                {importedMods.map((m, i) => (
                  <div key={i} className="import-mod">
                    <span className="import-mod-name">{m.name}</span>
                    <span className="tag tag-ver">v{m.version}</span>
                  </div>
                ))}
              </div>
              <button className="btn btn-accent" onClick={downloadAll} disabled={downloading}>
                {downloading ? '⟳ Скачиваю...' : `↓ Скачать и установить все (${importedMods.length})`}
              </button>
            </div>
          )}
          {downloadLog.length > 0 && (
            <div className="log-panel" style={{marginTop: 12}}>
              <div className="log-header">Лог загрузки</div>
              <div className="log-body">
                {downloadLog.map((l, i) => (
                  <div key={i} className={`log-line ${l.startsWith('✓') ? 'log-success' : l.startsWith('✗') ? 'log-error' : 'log-info'}`}>{l}</div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
