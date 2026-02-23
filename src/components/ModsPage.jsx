import React, { useState, useEffect } from 'react'
import './ModsPage.css'

export default function ModsPage({ settings, externalQueue = [], clearExternalQueue, onInstallDone }) {
  const [mods, setMods] = useState([])
  const [installing, setInstalling] = useState(false)
  const [log, setLog] = useState([])
  const [serverMode, setServerMode] = useState(() => localStorage.getItem('serverMode') || 'local')

  const setMode = (m) => { setServerMode(m); localStorage.setItem('serverMode', m) }

  useEffect(() => {
    if (externalQueue.length > 0) {
      setMods(prev => [...prev, ...externalQueue])
      clearExternalQueue?.()
    }
  }, [externalQueue])

  // Подгружаем файлы из temp папки если список пустой
  useEffect(() => {
    window.electronAPI.getTempDownloads().then(files => {
      if (files.length > 0) {
        setMods(prev => {
          const existingPaths = new Set(prev.map(m => m.path))
          const newFiles = files.filter(f => !existingPaths.has(f.path))
          return [...prev, ...newFiles]
        })
      }
    }).catch(() => {})
  }, [])

  const addMods = async () => {
    const files = await window.electronAPI.openArchives()
    if (!files.length) return
    const newMods = files.map(f => ({
      path: f,
      name: f.split('\\').pop().split('/').pop(),
      type: 'unknown',
      status: 'pending'
    }))
    setMods(prev => [...prev, ...newMods])
  }

  const removeMod = (idx) => setMods(prev => prev.filter((_, i) => i !== idx))
  const clearAll = () => setMods([])

  const installAll = async () => {
    setInstalling(true)
    setLog([{ type: 'info', text: '▶ Запускаю установку...' }])
    setMods(prev => prev.map(m => ({ ...m, status: 'pending' })))

    let currentIndex = -1
    window.electronAPI.onInstallLog((msg) => {
      setLog(prev => [...prev, msg])
      if (msg.text?.startsWith('▶')) {
        currentIndex++
        setMods(prev => prev.map((m, i) => i === currentIndex ? { ...m, status: 'installing' } : m))
      }
      if (msg.type === 'success' && msg.text?.includes('— готово')) {
        const idx = currentIndex
        setMods(prev => prev.map((m, i) => i === idx ? { ...m, status: 'done' } : m))
      }
      if (msg.type === 'error') {
        const idx = currentIndex
        setMods(prev => prev.map((m, i) => i === idx ? { ...m, status: 'error' } : m))
      }
    })

    try {
      await window.electronAPI.installMods({
        mods: mods.map(m => ({ path: m.path, meta: m.meta || null })),
        gamePath: settings.gamePath,
        ssh: settings.ssh,
        serverMode
      })
    } catch (e) {
      setLog(prev => [...prev, { type: 'error', text: `Критическая ошибка: ${e.message}` }])
    }

    window.electronAPI.removeInstallLog()
    setInstalling(false)
    if (onInstallDone) onInstallDone()
  }

  const getStatusIcon = (status) => {
    if (status === 'done') return '✓'
    if (status === 'error') return '✗'
    if (status === 'installing') return '⟳'
    return '○'
  }

  const hasGame = !!settings.gamePath
  const hasSSH = !!(settings.ssh?.host)

  return (
    <div className="mods-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Установка модов</h1>
          <p className="page-subtitle">Перетащи архивы или добавь вручную</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={clearAll} disabled={!mods.length}>Очистить</button>
          <button className="btn btn-accent" onClick={addMods}>+ Добавить архивы</button>
        </div>
      </div>

      <div className="status-bar">
        <div className={`status-dot ${hasGame ? 'ok' : 'warn'}`}>
          <span className="dot" />
          <span>{hasGame ? `Игра: ${settings.gamePath}` : 'Путь к игре не указан'}</span>
        </div>
        <div className={`status-dot ${hasSSH ? 'ok' : 'warn'}`}>
          <span className="dot" />
          <span>{hasSSH ? `SSH: ${settings.ssh.user}@${settings.ssh.host}:${settings.ssh.port}` : 'SSH не настроен'}</span>
        </div>
      </div>

      <div className="server-mode-bar">
        <span className="server-mode-label">Режим:</span>
        <div className="mode-tabs">
          <button className={`mode-tab ${serverMode === 'local' ? 'active' : ''}`} onClick={() => setMode('local')}>🖥 Локально</button>
          <button className={`mode-tab ${serverMode === 'ssh' ? 'active' : ''}`} onClick={() => setMode('ssh')}>🌐 Сервер</button>
          <button className={`mode-tab ${serverMode === 'mixed' ? 'active' : ''}`} onClick={() => setMode('mixed')}>🔀 2 в 1</button>
          <button className={`mode-tab ${serverMode === 'both' ? 'active' : ''}`} onClick={() => setMode('both')}>🖥+🌐 Оба</button>
        </div>
        <span className="mode-hint">
          {serverMode === 'local' && 'Клиент → локально · Сервер → локально'}
          {serverMode === 'ssh'   && 'Клиент → локально · Сервер → сервер'}
          {serverMode === 'mixed' && 'Клиент → локально + сервер · Сервер → сервер'}
          {serverMode === 'both'  && 'Клиент → локально + сервер · Сервер → локально + сервер'}
        </span>
      </div>

      <div className="mods-list-wrap">
        {mods.length === 0 ? (
          <div className="empty-state" onClick={addMods}>
            <div className="empty-icon">📦</div>
            <p>Нажми чтобы добавить архивы с модами</p>
            <span>Поддерживаются .zip .7z .rar</span>
          </div>
        ) : (
          <div className="mods-list">
            {mods.map((mod, idx) => (
              <div key={idx} className={`mod-item status-${mod.status}`}>
                <div className="mod-status-icon">{getStatusIcon(mod.status)}</div>
                <div className="mod-info">
                  <span className="mod-name">{mod.name}</span>
                  <span className="mod-path">{mod.path}</span>
                </div>
                <div className="mod-tags">
                  {mod.type === 'client' && <span className="tag tag-client">BepInEx</span>}
                  {mod.type === 'server' && <span className="tag tag-server">SPT</span>}
                  {mod.type === 'both' && <span className="tag tag-both">Оба</span>}
                  {mod.type === 'unknown' && <span className="tag" style={{color:'var(--text-dim)',background:'rgba(255,255,255,0.05)'}}>Анализ...</span>}
                </div>
                <button className="btn-remove" onClick={() => removeMod(idx)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {mods.length > 0 && (
        <div className="install-footer">
          <button className="btn btn-accent btn-install" onClick={installAll} disabled={installing}>
            {installing ? '⟳ Устанавливаю...' : `Установить (${mods.length})`}
          </button>
        </div>
      )}

      {log.length > 0 && (
        <div className="log-panel">
          <div className="log-header">Лог установки</div>
          <div className="log-body">
            {log.map((l, i) => (
              <div key={i} className={`log-line log-${l.type || 'info'}`}>{l.text || l}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
