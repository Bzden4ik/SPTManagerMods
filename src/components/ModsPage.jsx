import React, { useState, useEffect, useRef } from 'react'
import './ModsPage.css'

export default function ModsPage({ settings, externalQueue = [], clearExternalQueue, onInstallDone }) {
  const [mods, setMods] = useState([])
  const [installing, setInstalling] = useState(false)
  const [log, setLog] = useState([])
  const [serverMode, setServerMode] = useState(() => localStorage.getItem('serverMode') || 'local')
  const [currentStep, setCurrentStep] = useState('')
  const logBodyRef = useRef(null)

  const setMode = (m) => { setServerMode(m); localStorage.setItem('serverMode', m) }

  useEffect(() => {
    if (externalQueue.length > 0) {
      setMods(prev => [...prev, ...externalQueue])
      clearExternalQueue?.()
    }
  }, [externalQueue])

  useEffect(() => {
    window.electronAPI.getTempDownloads().then(files => {
      if (files.length > 0) {
        setMods(prev => {
          const existingPaths = new Set(prev.map(m => m.path))
          return [...prev, ...files.filter(f => !existingPaths.has(f.path))]
        })
      }
    }).catch(() => {})
  }, [])

  // Автоскролл лога
  useEffect(() => {
    if (logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight
    }
  }, [log])

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

  const [isDragging, setIsDragging] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    const archives = files.filter(f => /\.(zip|7z|rar)$/i.test(f.name))
    if (!archives.length) return
    const newMods = archives.map(f => ({ path: f.path, name: f.name, type: 'unknown', status: 'pending' }))
    setMods(prev => {
      const existingPaths = new Set(prev.map(m => m.path))
      return [...prev, ...newMods.filter(m => !existingPaths.has(m.path))]
    })
  }

  const handleDragOver  = (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setIsDragging(true) }
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false) }

  const removeMod = (idx) => {
    const mod = mods[idx]
    if (mod?.path?.includes('spt_downloads')) {
      window.electronAPI.deleteTempFile({ path: mod.path }).catch(() => {})
    }
    setMods(prev => prev.filter((_, i) => i !== idx))
  }

  const clearAll = () => {
    mods.forEach(mod => {
      if (mod?.path?.includes('spt_downloads')) {
        window.electronAPI.deleteTempFile({ path: mod.path }).catch(() => {})
      }
    })
    setMods([])
    setLog([])
    setCurrentStep('')
  }

  // Парсим текст лога → понятный статус
  const parseStep = (text) => {
    if (!text) return ''
    if (text.includes('Распаковываю')) return '📦 Распаковка архива...'
    if (text.includes('Формат:'))      return '🔍 Определяю формат...'
    if (text.includes('Распаковано'))  return '✅ Архив распакован'
    if (text.includes('Найдено:'))     return text.replace('Найдено:', '🗂 Найдено:')
    if (text.includes('Подключаюсь')) return '🔌 Подключение к серверу...'
    if (text.includes('SSH подключён')) return '🔌 SSH подключён'
    if (text.includes('Копирую SPT'))  return '📁 Копирую серверные файлы...'
    if (text.includes('BepInEx установлен')) return '🎮 BepInEx установлен'
    if (text.includes('Серверный мод установлен')) return '🖥 Серверный мод установлен'
    if (text.includes('Загружаю'))     return '📤 Загружаю на сервер...'
    if (text.includes('Загружено'))    return '✅ Загружено на сервер'
    if (text.includes('Ошибка'))       return '❌ ' + text
    return ''
  }

  const installAll = async () => {
    setInstalling(true)
    setLog([])
    setCurrentStep('🚀 Запускаю установку...')
    setMods(prev => prev.map(m => ({ ...m, status: 'pending' })))

    let currentIndex = -1
    window.electronAPI.onInstallLog((msg) => {
      setLog(prev => [...prev, msg])

      const step = parseStep(msg.text)
      if (step) setCurrentStep(step)

      if (msg.text?.startsWith('▶')) {
        currentIndex++
        setMods(prev => prev.map((m, i) => i === currentIndex ? { ...m, status: 'installing' } : m))
        setCurrentStep(`⚙ Устанавливаю: ${msg.text.replace('▶ ', '')}`)
      }
      if (msg.type === 'success' && msg.text?.includes('— готово')) {
        const idx = currentIndex
        setMods(prev => prev.map((m, i) => i === idx ? { ...m, status: 'done' } : m))
      }
      if (msg.type === 'error') {
        const idx = currentIndex
        setMods(prev => prev.map((m, i) => i === idx ? { ...m, status: 'error' } : m))
      }
      if (msg.type === 'done') setCurrentStep('✅ Установка завершена')
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
      setCurrentStep('❌ Критическая ошибка')
    }

    window.electronAPI.removeInstallLog()
    setInstalling(false)
    if (onInstallDone) onInstallDone()
  }

  const getStatusIcon = (status) => {
    if (status === 'done')       return <span className="status-icon done">✓</span>
    if (status === 'error')      return <span className="status-icon error">✗</span>
    if (status === 'installing') return <span className="status-icon installing"><span className="spinner-sm" /></span>
    return <span className="status-icon pending">○</span>
  }

  const hasGame = !!settings.gamePath
  const hasSSH  = !!(settings.ssh?.host)

  return (
    <div className="mods-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Установка модов</h1>
          <p className="page-subtitle">Перетащи архивы или добавь вручную</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={clearAll} disabled={!mods.length || installing}>Очистить</button>
          <button className="btn btn-accent" onClick={addMods} disabled={installing}>+ Добавить архивы</button>
        </div>
      </div>

      <div className="status-bar animate-fade-in stagger-1">
        <div className={`status-dot ${hasGame ? 'ok' : 'warn'}`}>
          <span className="dot" />
          <span>{hasGame ? `Игра: ${settings.gamePath}` : 'Путь к игре не указан'}</span>
        </div>
        <div className={`status-dot ${hasSSH ? 'ok' : 'warn'}`}>
          <span className="dot" />
          <span>{hasSSH ? `SSH: ${settings.ssh.user}@${settings.ssh.host}:${settings.ssh.port}` : 'SSH не настроен'}</span>
        </div>
      </div>

      <div className="server-mode-bar animate-fade-in stagger-2">
        <span className="server-mode-label">Режим:</span>
        <div className="mode-tabs">
          {[
            { id: 'local', label: '🖥 Локально' },
            { id: 'ssh',   label: '🌐 Сервер' },
            { id: 'mixed', label: '🔀 2 в 1' },
            { id: 'both',  label: '🖥+🌐 Оба' },
          ].map(m => (
            <button key={m.id} className={`mode-tab ${serverMode === m.id ? 'active' : ''}`} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <span className="mode-hint">
          {serverMode === 'local' && 'Клиент → локально · Сервер → локально'}
          {serverMode === 'ssh'   && 'Клиент → локально · Сервер → сервер'}
          {serverMode === 'mixed' && 'Клиент → локально + сервер · Сервер → сервер'}
          {serverMode === 'both'  && 'Клиент → локально + сервер · Сервер → локально + сервер'}
        </span>
      </div>

      <div
        className={`mods-list-wrap animate-fade-in stagger-3 ${isDragging ? 'dragging' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {mods.length === 0 ? (
          <div className="empty-state" onClick={addMods}>
            <div className="empty-icon">{isDragging ? '📂' : '📦'}</div>
            <p>{isDragging ? 'Отпусти чтобы добавить' : 'Нажми или перетащи архивы с модами'}</p>
            <span>Поддерживаются .zip .7z .rar</span>
          </div>
        ) : (
          <div className="mods-list">
            {mods.map((mod, idx) => (
              <div
                key={idx}
                className={`mod-item status-${mod.status}`}
                style={{ animationDelay: `${idx * 0.04}s` }}
              >
                <div className="mod-status-icon">{getStatusIcon(mod.status)}</div>
                <div className="mod-info">
                  <span className="mod-name">{mod.name}</span>
                  <span className="mod-path">{mod.path}</span>
                </div>
                {mod.status === 'installing' && currentStep && (
                  <div className="mod-step-label">{currentStep}</div>
                )}
                <button className="btn-remove" onClick={() => removeMod(idx)} disabled={installing}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {mods.length > 0 && (
        <div className="install-footer animate-fade-in">
          {installing && currentStep && (
            <div className="install-step-bar">
              <span className="spinner" />
              <span>{currentStep}</span>
            </div>
          )}
          <button className="btn btn-accent btn-install" onClick={installAll} disabled={installing}>
            {installing ? (
              <><span className="spinner" style={{borderTopColor:'#0f1117', borderColor:'rgba(15,17,23,0.3)'}} /> Устанавливаю...</>
            ) : (
              `▶ Установить (${mods.length})`
            )}
          </button>
        </div>
      )}

      {log.length > 0 && (
        <div className="log-panel animate-fade-in">
          <div className="log-header">
            <span className={`log-header-dot ${installing ? 'live' : ''}`} />
            Лог установки
            {!installing && <button className="log-close" onClick={() => setLog([])}>✕</button>}
          </div>
          <div className="log-body" ref={logBodyRef}>
            {log.map((l, i) => (
              <div
                key={i}
                className={`log-line log-${l.type || 'info'}`}
                style={{ animationDelay: `${Math.min(i * 0.015, 0.3)}s` }}
              >
                {l.text || l}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
