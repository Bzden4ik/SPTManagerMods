import React, { useState, useEffect } from 'react'
import './SettingsPage.css'

export default function SettingsPage({ settings, setSettings, profiles, setProfiles, onSwitchProfile, onProfilesReload }) {
  const [ssh, setSsh] = useState(settings.ssh)
  const [gamePath, setGamePath] = useState(settings.gamePath)
  const [forgeToken, setForgeToken] = useState(settings.forgeToken || '')
  const [sshTest, setSshTest] = useState(null)

  // Синхронизация gamePath из настроек (при смене профиля снаружи)
  useEffect(() => { setGamePath(settings.gamePath) }, [settings.gamePath])
  useEffect(() => { setSettings({ gamePath, ssh, forgeToken }) }, [gamePath, ssh, forgeToken])

  // При изменении gamePath — обновляем активный профиль
  const handleGamePathChange = (val) => {
    setGamePath(val)
    if (profiles.active) {
      window.electronAPI.profilesUpdateGamePath({ id: profiles.active, gamePath: val })
        .catch(() => {})
    }
  }

  const pickFolder = async () => {
    const p = await window.electronAPI.openFolder()
    if (p) handleGamePathChange(p)
  }

  const upd = (k, v) => setSsh(prev => ({ ...prev, [k]: v }))

  const testSSH = async () => {
    setSshTest('testing')
    const res = await window.electronAPI.testSSH({ ssh })
    setSshTest(res.success ? { ok: true, msg: res.info } : { ok: false, msg: res.error })
  }

  // ─── Профили ─────────────────────────────────────────────────────────────
  const [newProfileName, setNewProfileName] = useState('')
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const activeProfile = profiles.list.find(p => p.id === profiles.active)

  const createProfile = async () => {
    if (!newProfileName.trim()) return
    const res = await window.electronAPI.profilesCreate({ name: newProfileName.trim(), gamePath: '' })
    if (res.success) {
      setProfiles(prev => ({ ...prev, list: res.list }))
      setNewProfileName('')
      setCreatingProfile(false)
    }
  }

  const deleteProfile = async (id) => {
    if (!confirm(`Удалить профиль «${profiles.list.find(p => p.id === id)?.name}»?\nРеестр модов профиля будет удалён.`)) return
    const res = await window.electronAPI.profilesDelete({ id })
    if (res.error) { alert(res.error); return }
    setProfiles({ active: res.active, list: res.list })
    if (id === profiles.active) {
      // Переключились на другой профиль — обновляем gamePath
      const next = res.list.find(p => p.id === res.active)
      if (next) { handleGamePathChange(next.gamePath || '') }
    }
  }

  const startRename = (id, name) => { setRenamingId(id); setRenameValue(name) }

  const confirmRename = async (id) => {
    if (!renameValue.trim()) { setRenamingId(null); return }
    const res = await window.electronAPI.profilesRename({ id, name: renameValue.trim() })
    if (res.success) setProfiles(prev => ({ ...prev, list: res.list }))
    setRenamingId(null)
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Настройки</h1>
          <p className="page-subtitle">Изменения сохраняются автоматически</p>
        </div>
      </div>

      <div className="settings-grid">

        {/* ── Профили ── */}
        <section className="card">
          <div className="section-title">🎮 Профили игры</div>
          <p className="profiles-hint">Каждый профиль — отдельная папка с игрой и своя библиотека модов.</p>

          <div className="profiles-list">
            {profiles.list.map(profile => {
              const isActive = profile.id === profiles.active
              return (
                <div key={profile.id} className={`profile-item ${isActive ? 'active' : ''}`}>
                  <div className="profile-item-left">
                    {renamingId === profile.id ? (
                      <input
                        className="profile-rename-input"
                        value={renameValue}
                        autoFocus
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => confirmRename(profile.id)}
                        onKeyDown={e => { if (e.key === 'Enter') confirmRename(profile.id); if (e.key === 'Escape') setRenamingId(null) }}
                      />
                    ) : (
                      <span className="profile-name" onDoubleClick={() => startRename(profile.id, profile.name)}>
                        {isActive && <span className="profile-active-dot" />}
                        {profile.name}
                      </span>
                    )}
                    <span className="profile-path">{profile.gamePath || 'Папка не выбрана'}</span>
                  </div>
                  <div className="profile-item-actions">
                    {!isActive && (
                      <button className="btn btn-ghost btn-sm" onClick={() => onSwitchProfile(profile.id)}>
                        Переключить
                      </button>
                    )}
                    {isActive && <span className="profile-active-label">Активен</span>}
                    <button className="btn btn-ghost btn-sm profile-btn-icon" title="Переименовать" onClick={() => startRename(profile.id, profile.name)}>✏</button>
                    {profiles.list.length > 1 && (
                      <button className="btn btn-danger btn-sm profile-btn-icon" title="Удалить" onClick={() => deleteProfile(profile.id)}>✕</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {creatingProfile ? (
            <div className="profile-create-row">
              <input
                className="profile-create-input"
                placeholder="Название профиля..."
                value={newProfileName}
                autoFocus
                onChange={e => setNewProfileName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createProfile(); if (e.key === 'Escape') setCreatingProfile(false) }}
              />
              <button className="btn btn-primary btn-sm" onClick={createProfile}>Создать</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setCreatingProfile(false)}>Отмена</button>
            </div>
          ) : (
            <button className="btn btn-ghost" style={{marginTop: 10}} onClick={() => setCreatingProfile(true)}>
              + Новый профиль
            </button>
          )}
        </section>

        {/* ── Forge токен ── */}
        <section className="card">
          <div className="section-title">🔑 Forge API токен</div>
          <div className="input-group">
            <label>API токен (forge.sp-tarkov.com → профиль → API Tokens)</label>
            <input type="password" value={forgeToken} onChange={e => setForgeToken(e.target.value)} placeholder="Вставь токен сюда" />
          </div>
        </section>

        {/* ── Путь к игре ── */}
        <section className="card">
          <div className="section-title">📁 Путь к игре — профиль «{activeProfile?.name || '...'}»</div>
          <div className="input-group">
            <label>Папка SPT (клиентские моды и локальные серверные)</label>
            <div className="input-row">
              <input type="text" value={gamePath} onChange={e => handleGamePathChange(e.target.value)} placeholder="C:\SPT\" />
              <button className="btn btn-ghost" onClick={pickFolder}>Обзор</button>
            </div>
          </div>
        </section>

        {/* ── SSH ── */}
        <section className="card">
          <div className="section-title">🖥 SSH подключение (серверные моды)</div>

          <div className="input-row-2">
            <div className="input-group">
              <label>Хост / IP</label>
              <input type="text" value={ssh.host} onChange={e => upd('host', e.target.value)} placeholder="192.168.1.1" />
            </div>
            <div className="input-group" style={{maxWidth: 90}}>
              <label>Порт</label>
              <input type="number" value={ssh.port} onChange={e => upd('port', e.target.value)} placeholder="22" />
            </div>
          </div>

          <div className="input-group">
            <label>Пользователь</label>
            <input type="text" value={ssh.user} onChange={e => upd('user', e.target.value)} placeholder="root" />
          </div>

          <div className="auth-tabs">
            <button className={`auth-tab ${ssh.authType === 'password' ? 'active' : ''}`} onClick={() => upd('authType', 'password')}>Пароль</button>
            <button className={`auth-tab ${ssh.authType === 'key' ? 'active' : ''}`} onClick={() => upd('authType', 'key')}>SSH ключ</button>
          </div>

          {ssh.authType === 'password' && (
            <div className="input-group">
              <label>Пароль</label>
              <input type="password" value={ssh.password} onChange={e => upd('password', e.target.value)} placeholder="••••••••" />
            </div>
          )}

          {ssh.authType === 'key' && (
            <div className="input-group">
              <label>Путь к приватному ключу</label>
              <div className="input-row">
                <input type="text" value={ssh.keyPath} onChange={e => upd('keyPath', e.target.value)} placeholder="C:\Users\...\.ssh\id_rsa" />
                <button className="btn btn-ghost" onClick={async () => {
                  const p = await window.electronAPI.openFolder()
                  if (p) upd('keyPath', p)
                }}>Обзор</button>
              </div>
            </div>
          )}

          <div className="input-group">
            <label>Корневая папка игры на сервере</label>
            <input type="text" value={ssh.serverPath} onChange={e => upd('serverPath', e.target.value)} placeholder="C:\Hyita" />
            {ssh.serverPath && (() => {
              const p = ssh.serverPath.replace(/[/\\]$/, '')
              const sep = /^[A-Za-z]:/.test(p) ? '\\' : '/'
              return (
                <div className="path-preview">
                  Серверные моды → <code>{p}{sep}SPT{sep}user{sep}mods{sep}</code><br/>
                  Клиентские моды → <code>{p}{sep}BepInEx{sep}plugins{sep}</code>
                </div>
              )
            })()}
          </div>

          <div className="ssh-test-row">
            <button className="btn btn-ghost" onClick={testSSH} disabled={!ssh.host || sshTest === 'testing'}>
              {sshTest === 'testing' ? '⟳ Проверяю...' : '🔌 Проверить соединение'}
            </button>
            {sshTest && sshTest !== 'testing' && (
              <span className={`ssh-test-result ${sshTest.ok ? 'ok' : 'fail'}`}>
                {sshTest.ok ? `✓ ${sshTest.msg}` : `✗ ${sshTest.msg}`}
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
