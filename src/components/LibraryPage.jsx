import React, { useState, useEffect, useMemo } from 'react'
import './LibraryPage.css'

export default function LibraryPage({ onRemoved, settings, activeProfile }) {
  const [mods, setMods] = useState([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState({})
  const [checking, setChecking] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('date_desc')
  const [filterSource, setFilterSource] = useState('all')

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
    const res = await window.electronAPI.removeMod({ key: mod.key, ssh: settings?.ssh })
    if (res.success) {
      setMods(prev => prev.filter(m => m.key !== mod.key))
      if (onRemoved) onRemoved()
    } else {
      alert('Ошибка удаления:\n' + res.errors?.join('\n'))
    }
    setRemoving(prev => ({ ...prev, [mod.key]: false }))
  }

  const filtered = useMemo(() => {
    let list = [...mods]

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(m => m.name?.toLowerCase().includes(q))
    }

    if (filterSource !== 'all') {
      list = list.filter(m => (m.source || 'manual') === filterSource)
    }

    list.sort((a, b) => {
      if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '')
      if (sortBy === 'name_desc') return (b.name || '').localeCompare(a.name || '')
      if (sortBy === 'date_asc') return new Date(a.installedAt) - new Date(b.installedAt)
      if (sortBy === 'date_desc') return new Date(b.installedAt) - new Date(a.installedAt)
      return 0
    })

    return list
  }, [mods, search, sortBy, filterSource])

  return (
    <div className="library-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Библиотека</h1>
          <p className="page-subtitle">
            {activeProfile && <span className="lib-profile-badge">🎮 {activeProfile.name}</span>}
            {filtered.length} из {mods.length} модов
            {checking && <span className="ssh-checking"> · 🔌 Проверяю SSH...</span>}
          </p>
        </div>
        <div style={{display:'flex', gap:8}}>
          <button className="btn btn-ghost" onClick={async () => {
            const res = await window.electronAPI.exportModList()
            if (!res.success) alert('Ошибка экспорта')
          }}>📄 Экспорт списка</button>
          <button className="btn btn-ghost" onClick={load}>↺ Обновить</button>
        </div>
      </div>

      <div className="lib-controls">
        <input
          className="lib-search"
          placeholder="🔍 Поиск по библиотеке..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="lib-filters">
          <select className="lib-select" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="all">Все моды</option>
            <option value="forge">С Forge</option>
            <option value="manual">Вручную</option>
          </select>
          <select className="lib-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="date_desc">Сначала новые</option>
            <option value="date_asc">Сначала старые</option>
            <option value="name_asc">По алфавиту A→Z</option>
            <option value="name_desc">По алфавиту Z→A</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="lib-loading"><span className="spinner" /> Загружаю...</div>
      ) : filtered.length === 0 ? (
        <div className="lib-empty">
          <div className="empty-icon">📭</div>
          <p>{mods.length === 0 ? 'Нет установленных модов' : 'Ничего не найдено'}</p>
          <span>{mods.length === 0 ? 'Установи моды через каталог или вручную' : 'Попробуй изменить поиск или фильтры'}</span>
        </div>
      ) : (
        <div className="lib-list">
          {filtered.map(mod => {
            const source = mod.source || 'manual'
            return (
              <div key={mod.key} className={`lib-item ${!mod.isPresent ? 'missing' : ''}`}>
                <div className="lib-item-info">
                  <div className="lib-item-name">
                    {mod.name}
                    <span className={`tag lib-source-tag ${source === 'forge' ? 'source-forge' : 'source-manual'}`}>
                      {source === 'forge' ? '⬡ Forge' : '📁 Вручную'}
                    </span>
                  </div>
                  <div className="lib-item-meta">
                    {mod.version && <span className="tag tag-ver">v{mod.version}</span>}
                    <span className={`tag ${mod.isPresent ? 'tag-ok' : 'tag-missing'}`}>
                      {mod.isPresent ? '✓ Файлы на месте' : '⚠ Файлы не найдены'}
                    </span>
                    <span className="lib-date">{mod.installedAt ? new Date(mod.installedAt).toLocaleDateString('ru') : ''}</span>
                  </div>
                  <div className="lib-paths">
                    {(mod.pathStatuses || mod.paths?.map(p => ({ path: p, present: true, isSSH: p.startsWith('ssh:') }))).map((s, i) => (
                      <div key={i} className="lib-path-row">
                        <span className={`lib-path-status ${s.present ? 'ok' : 'missing'}`}>{s.present ? '✓' : '⚠'}</span>
                        <span className="lib-path-label">{s.isSSH ? '🌐' : '🖥'}</span>
                        <span className="lib-path">{s.path}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <button className="btn btn-danger" onClick={() => remove(mod)} disabled={removing[mod.key]}>
                  {removing[mod.key] ? '...' : '🗑 Удалить'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
