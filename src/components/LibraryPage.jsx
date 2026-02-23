import React, { useState, useEffect } from 'react'
import './LibraryPage.css'

export default function LibraryPage({ onRemoved, settings }) {
  const [mods, setMods] = useState([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState({})
  const [checking, setChecking] = useState(false)

  const load = async () => {
    setLoading(true)
    setChecking(!!settings?.ssh?.host)
    const list = await window.electronAPI.getInstalledMods({ ssh: settings?.ssh })
    setMods(list || [])
    setLoading(false)
    setChecking(false)
  }

  useEffect(() => { load() }, [])

  const remove = async (mod) => {
    setRemoving(prev => ({ ...prev, [mod.key]: true }))
    const res = await window.electronAPI.removeMod({ key: mod.key })
    if (res.success) {
      setMods(prev => prev.filter(m => m.key !== mod.key))
      if (onRemoved) onRemoved()
    } else {
      alert('Ошибка удаления:\n' + res.errors?.join('\n'))
    }
    setRemoving(prev => ({ ...prev, [mod.key]: false }))
  }

  return (
    <div className="library-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Библиотека</h1>
          <p className="page-subtitle">
            {mods.length} установленных модов
            {checking && <span className="ssh-checking"> · 🔌 Проверяю SSH...</span>}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={load}>↺ Обновить</button>
      </div>

      {loading ? (
        <div className="lib-loading"><span className="spinner" /> Загружаю...</div>
      ) : mods.length === 0 ? (
        <div className="lib-empty">
          <div className="empty-icon">📭</div>
          <p>Нет установленных модов</p>
          <span>Установи моды через каталог или вручную</span>
        </div>
      ) : (
        <div className="lib-list">
          {mods.map(mod => (
            <div key={mod.key} className={`lib-item ${!mod.isPresent ? 'missing' : ''}`}>
              <div className="lib-item-info">
                <div className="lib-item-name">{mod.name}</div>
                <div className="lib-item-meta">
                  {mod.version && <span className="tag tag-ver">v{mod.version}</span>}
                  <span className={`tag ${mod.isPresent ? 'tag-ok' : 'tag-missing'}`}>
                    {mod.isPresent ? '✓ Файлы на месте' : '⚠ Файлы не найдены'}
                  </span>
                  <span className="lib-date">{mod.installedAt ? new Date(mod.installedAt).toLocaleDateString('ru') : ''}</span>
                </div>
                <div className="lib-paths">
                  {mod.paths?.map((p, i) => (
                    <span key={i} className="lib-path">{p}</span>
                  ))}
                </div>
              </div>
              <button
                className="btn btn-danger"
                onClick={() => remove(mod)}
                disabled={removing[mod.key]}
              >
                {removing[mod.key] ? '...' : '🗑 Удалить'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
