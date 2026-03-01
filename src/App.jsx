import React, { useState, useEffect } from 'react'
import TitleBar from './components/TitleBar.jsx'
import Sidebar from './components/Sidebar.jsx'
import ModsPage from './components/ModsPage.jsx'
import BrowsePage from './components/BrowsePage.jsx'
import ModpackPage from './components/ModpackPage.jsx'
import LibraryPage from './components/LibraryPage.jsx'
import SettingsPage from './components/SettingsPage.jsx'
import './App.css'

const loadState = (key, def) => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : def } catch { return def } }
const saveState = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }

export default function App() {
  const [page, setPage] = useState('mods')
  const [queue, setQueue] = useState([])
  const [installedMap, setInstalledMap] = useState({})

  // ─── Профили ───────────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState({ active: null, list: [] })

  const loadProfiles = async () => {
    const data = await window.electronAPI.profilesGetAll().catch(() => ({ active: null, list: [] }))
    setProfiles(data)
    // Синхронизируем gamePath из активного профиля
    const activeProfile = data.list.find(p => p.id === data.active)
    if (activeProfile) {
      setSettings(prev => ({ ...prev, gamePath: activeProfile.gamePath || '' }))
    }
    return data
  }

  const switchProfile = async (id) => {
    const res = await window.electronAPI.profilesSetActive({ id })
    if (res.error) return
    setProfiles({ active: id, list: res.list })
    const profile = res.list.find(p => p.id === id)
    if (profile) setSettings(prev => ({ ...prev, gamePath: profile.gamePath || '' }))
    // Обновляем библиотеку для нового профиля
    refreshInstalled()
  }

  useEffect(() => { loadProfiles() }, [])

  // ─── Настройки ─────────────────────────────────────────────────────────
  const [settings, setSettings] = useState(() => loadState('settings', {
    gamePath: '',
    forgeToken: '',
    ssh: { host: '', port: '22', user: '', password: '', keyPath: '', authType: 'password', serverPath: '/root/SPT/' }
  }))

  const [browseFilters, setBrowseFilters] = useState(() => loadState('browseFilters', {
    search: '', selectedVersions: [], selectedCategory: '',
    featured: 'include', fikaOnly: false, sortBy: '-updated_at'
  }))

  // Сохраняем только ssh и forgeToken в localStorage; gamePath берём из профиля
  useEffect(() => { saveState('settings', settings) }, [settings])
  useEffect(() => { saveState('browseFilters', browseFilters) }, [browseFilters])

  const [modpackState, setModpackState] = useState(() => {
    const saved = loadState('modpackState', null)
    if (!saved || !Array.isArray(saved.downloadItems)) {
      return { importKey: '', importedMods: null, downloadItems: [] }
    }
    return saved
  })

  useEffect(() => { saveState('modpackState', modpackState) }, [modpackState])

  // ─── Установленные моды ─────────────────────────────────────────────────
  const refreshInstalled = async () => {
    const list = await window.electronAPI.getInstalledMods().catch(() => [])
    const map = {}
    list.forEach(e => { map[e.key] = e })
    setInstalledMap(map)
  }

  useEffect(() => { refreshInstalled() }, [])

  const addToQueue = (mods) => {
    setQueue(prev => [...prev, ...mods])
    setPage('mods')
  }

  // Активный профиль
  const activeProfile = profiles.list.find(p => p.id === profiles.active) || null

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Sidebar page={page} setPage={setPage} queueCount={queue.length} activeProfile={activeProfile} />
        <main className="app-content">
          {page === 'mods'     && <div key="mods"     className="page-enter"><ModsPage settings={settings} externalQueue={queue} clearExternalQueue={() => setQueue([])} onInstallDone={refreshInstalled} /></div>}
          {page === 'browse'   && <div key="browse"   className="page-enter"><BrowsePage settings={settings} onAddToQueue={addToQueue} filters={browseFilters} setFilters={setBrowseFilters} installedMap={installedMap} /></div>}
          {page === 'library'  && <div key="library"  className="page-enter"><LibraryPage settings={settings} onRemoved={refreshInstalled} activeProfile={activeProfile} /></div>}
          {page === 'modpack'  && <div key="modpack"  className="page-enter"><ModpackPage settings={settings} onAddToQueue={addToQueue} modpackState={modpackState} setModpackState={setModpackState} /></div>}
          {page === 'settings' && <div key="settings" className="page-enter"><SettingsPage settings={settings} setSettings={setSettings} profiles={profiles} setProfiles={setProfiles} onSwitchProfile={switchProfile} onProfilesReload={loadProfiles} /></div>}
        </main>
      </div>
    </div>
  )
}
