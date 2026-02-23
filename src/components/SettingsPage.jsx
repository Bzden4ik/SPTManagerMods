import React, { useState, useEffect } from 'react'
import './SettingsPage.css'

export default function SettingsPage({ settings, setSettings }) {
  const [ssh, setSsh] = useState(settings.ssh)
  const [gamePath, setGamePath] = useState(settings.gamePath)
  const [forgeToken, setForgeToken] = useState(settings.forgeToken || '')

  // Автосохранение при любом изменении
  useEffect(() => {
    setSettings({ gamePath, ssh, forgeToken })
  }, [gamePath, ssh, forgeToken])

  const pickFolder = async () => {
    const p = await window.electronAPI.openFolder()
    if (p) setGamePath(p)
  }

  const upd = (k, v) => setSsh(prev => ({ ...prev, [k]: v }))

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Настройки</h1>
          <p className="page-subtitle">Изменения сохраняются автоматически</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="card">
          <div className="section-title">🔑 Forge API токен</div>
          <div className="input-group">
            <label>API токен (forge.sp-tarkov.com → профиль → API Tokens)</label>
            <input type="password" value={forgeToken} onChange={e => setForgeToken(e.target.value)} placeholder="Вставь токен сюда" />
          </div>
        </section>

        <section className="card">
          <div className="section-title">🎮 Путь к игре (клиентские моды)</div>
          <div className="input-group">
            <label>Папка SPT</label>
            <div className="input-row">
              <input type="text" value={gamePath} onChange={e => setGamePath(e.target.value)} placeholder="C:\SPT\" />
              <button className="btn btn-ghost" onClick={pickFolder}>Обзор</button>
            </div>
          </div>
        </section>

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
            <label>Путь к SPT на сервере</label>
            <input type="text" value={ssh.serverPath} onChange={e => upd('serverPath', e.target.value)} placeholder="/root/SPT/" />
          </div>
        </section>
      </div>
    </div>
  )
}
