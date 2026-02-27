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
  const [installedMap, setInstalledMap] = useState({}) // { forge_ID: entry }

  const refreshInstalled = async () => {
    const list = await window.electronAPI.getInstalledMods().catch(() => [])
    const map = {}
    list.forEach(e => { map[e.key] = e })
    setInstalledMap(map)
  }

  useEffect(() => { refreshInstalled() }, [])
  const [settings, setSettings] = useState(() => loadState('settings', {
    gamePath: '',
    forgeToken: '',
    ssh: { host: '', port: '22', user: '', password: '', keyPath: '', authType: 'password', serverPath: '/root/SPT/' }
  }))
  const [browseFilters, setBrowseFilters] = useState(() => loadState('browseFilters', {
    search: '', selectedVersions: [], selectedCategory: '',
    featured: 'include', fikaOnly: false, sortBy: '-updated_at'
  }))

  useEffect(() => { saveState('settings', settings) }, [settings])
  useEffect(() => { saveState('browseFilters', browseFilters) }, [browseFilters])

  const [modpackState, setModpackState] = useState(() => {
    const saved = loadState('modpackState', null)
    // Защита от старых/битых данных в localStorage
    if (!saved || !Array.isArray(saved.downloadItems)) {
      return { importKey: '', importedMods: null, downloadItems: [] }
    }
    return saved
  })

  useEffect(() => { saveState('modpackState', modpackState) }, [modpackState])

  const addToQueue = (mods) => {
    setQueue(prev => [...prev, ...mods])
    setPage('mods')
  }
  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Sidebar page={page} setPage={setPage} queueCount={queue.length} />
        <main className="app-content">
          {page === 'mods' && <ModsPage settings={settings} externalQueue={queue} clearExternalQueue={() => setQueue([])} onInstallDone={refreshInstalled} />}
          {page === 'browse' && <BrowsePage settings={settings} onAddToQueue={addToQueue} filters={browseFilters} setFilters={setBrowseFilters} installedMap={installedMap} />}
          {page === 'library' && <LibraryPage settings={settings} onRemoved={refreshInstalled} />}
          {page === 'modpack' && <ModpackPage settings={settings} onAddToQueue={addToQueue} modpackState={modpackState} setModpackState={setModpackState} />}
          {page === 'settings' && <SettingsPage settings={settings} setSettings={setSettings} />}
        </main>
      </div>
    </div>
  )
}
