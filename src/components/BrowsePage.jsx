import React, { useState, useEffect, useCallback, useRef } from 'react'
import './BrowsePage.css'

export default function BrowsePage({ settings, onAddToQueue, filters, setFilters, installedMap = {} }) {
  const [mods, setMods] = useState([])
  const [loading, setLoading] = useState(false)
  const [totalPages, setTotalPages] = useState(1)
  const [totalMods, setTotalMods] = useState(0)
  const [sptVersions, setSptVersions] = useState([])
  const [categories, setCategories] = useState([])
  const [showVersionFilter, setShowVersionFilter] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [downloading, setDownloading] = useState({})
  const [expandedMod, setExpandedMod] = useState(null)
  const [modVersions, setModVersions] = useState({})
  const [cacheProgress, setCacheProgress] = useState(null)
  const [page, setPage] = useState(1)
  const filterRef = useRef(null)
  const sortRef = useRef(null)
  const token = settings.forgeToken

  const search = filters.search
  const selectedVersions = filters.selectedVersions
  const selectedCategory = filters.selectedCategory
  const featured = filters.featured
  const fikaOnly = filters.fikaOnly
  const sortBy = filters.sortBy

  const setSearch = v => setFilters(f => ({ ...f, search: v }))
  const setSelectedVersions = v => setFilters(f => ({ ...f, selectedVersions: typeof v === 'function' ? v(f.selectedVersions) : v }))
  const setSelectedCategory = v => setFilters(f => ({ ...f, selectedCategory: v }))
  const setFeatured = v => setFilters(f => ({ ...f, featured: v }))
  const setFikaOnly = v => setFilters(f => ({ ...f, fikaOnly: v }))
  const setSortBy = v => setFilters(f => ({ ...f, sortBy: v }))

  useEffect(() => {
    // Подписываемся на прогресс кеша
    window.electronAPI.onCacheProgress(({ loaded, total }) => {
      setCacheProgress({ loaded, total })
      if (loaded >= total) setTimeout(() => setCacheProgress(null), 1000)
    })
    return () => window.electronAPI.removeCacheProgress()
  }, [])

  useEffect(() => {
    // Парсим категории со страницы Forge, версии — захардкожены как fallback
    const knownVersions = [
      '4.0.12','4.0.11','4.0.10','4.0.9','4.0.8','4.0.7','4.0.6','4.0.5',
      '4.0.4','4.0.3','4.0.2','4.0.1','4.0.0',
      '3.11.4','3.11.3','3.11.2','3.11.1','3.11.0',
      '3.10.5','3.10.4','3.10.3','3.10.2','3.10.1','3.10.0'
    ]
    setSptVersions(knownVersions)
    window.electronAPI.forgeScrapeFilters().then(r => {
      if (r?.versions?.length > knownVersions.length) {
        setSptVersions(r.versions.filter(v => v !== 'all' && v !== 'legacy'))
      }
      if (r?.categories?.length) setCategories(r.categories.filter(c => c.value !== ''))
    }).catch(() => {})
  }, [])

  // Закрытие дропдаунов по клику снаружи
  useEffect(() => {
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setShowVersionFilter(false)
      if (sortRef.current && !sortRef.current.contains(e.target)) setShowSortMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fetchMods = useCallback(async (p = 1) => {
    if (!token) return
    setLoading(true)
    try {
      const r = await window.electronAPI.forgeGetMods({ token, page: p, search, sptVersions: selectedVersions, category: selectedCategory, sort: sortBy, featured, fikaOnly })
      if (r?.data) {
        setMods(r.data)
        setTotalPages(r.meta?.last_page || 1)
        setTotalMods(r.meta?.total || 0)
      }
    } catch {}
    setLoading(false)
  }, [token, search, selectedVersions, selectedCategory, sortBy, featured, fikaOnly])

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); fetchMods(1) }, 400)
    return () => clearTimeout(t)
  }, [search, selectedVersions, selectedCategory, token, sortBy, featured, fikaOnly])

  useEffect(() => { fetchMods(page) }, [page])

  const toggleVersion = (v) => {
    setSelectedVersions(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  const expandMod = async (mod) => {
    if (expandedMod?.id === mod.id) { setExpandedMod(null); return }
    setExpandedMod(mod)
    if (!modVersions[mod.id]) {
      const r = await window.electronAPI.forgeGetModVersions({ token, modId: mod.id })
      if (r?.data) setModVersions(prev => ({ ...prev, [mod.id]: r.data }))
    }
  }

  const downloadWithDeps = async (mod) => {
    // Сначала получаем последнюю версию мода
    const verRes = await window.electronAPI.forgeGetModVersions({ token, modId: mod.id })
    const versions = verRes?.data
    if (!versions?.length) return
    const latest = versions[0]

    // Зависимости
    const depsRes = await window.electronAPI.forgeGetDependencies({ token, modId: mod.id, version: latest.version })
    const deps = depsRes?.data || []
    const toDownload = [{ mod, version: latest }, ...deps.map(d => ({ mod: d, version: null }))]

    window.electronAPI.onDownloadProgress(({ filename, received, total }) => {
      const pct = total > 0 ? Math.round(received / total * 100) : -1
      setDownloading(prev => ({ ...prev, [filename]: pct }))
    })

    const downloaded = []
    for (const item of toDownload) {
      let ver = item.version
      if (!ver) {
        const vr = await window.electronAPI.forgeGetModVersions({ token, modId: item.mod.id })
        ver = vr?.data?.[0]
      }
      if (!ver) continue
      const dlUrl = ver.link || ver.download_url || ver.file_url
      if (!dlUrl) continue
      const filename = `${item.mod.slug || item.mod.id}_${ver.version || 'latest'}.zip`
      setDownloading(prev => ({ ...prev, [filename]: 0 }))
      try {
        const localPath = await window.electronAPI.forgeDownloadMod({ url: dlUrl, token, filename })
        downloaded.push({
          path: localPath,
          name: filename,
          type: 'unknown',
          status: 'pending',
          meta: { id: item.mod.id, name: item.mod.name, version: ver.version, slug: item.mod.slug }
        })
      } catch (e) { console.error('Download error', e) }
    }

    window.electronAPI.removeDownloadProgress()
    setDownloading({})
    if (downloaded.length > 0) onAddToQueue(downloaded)
  }

  if (!token) {
    return (
      <div className="browse-no-token">
        <div className="empty-icon">🔑</div>
        <p>Укажи API токен Forge в <strong>Настройках</strong></p>
        <span>forge.sp-tarkov.com → профиль → API Tokens</span>
      </div>
    )
  }

  const versionLabel = selectedVersions.length === 0
    ? 'Все версии SPT'
    : selectedVersions.length === 1
      ? `SPT ${selectedVersions[0]}`
      : `SPT: ${selectedVersions.length} выбрано`

  const sortOptions = [
    { value: '-created_at', label: 'Newest' },
    { value: '-updated_at', label: 'Recently Updated' },
    { value: '-downloads', label: 'Most Downloaded' },
  ]
  const sortLabel = sortOptions.find(o => o.value === sortBy)?.label || 'Сортировка'

  return (
    <div className="browse-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Каталог модов</h1>
          <p className="page-subtitle">
            forge.sp-tarkov.com
            {totalMods > 0 && <span className="mods-count"> · {totalMods.toLocaleString()} модов</span>}
          </p>
        </div>
        {cacheProgress && (
          <div className="cache-progress">
            <span className="spinner" />
            Загружаю каталог {cacheProgress.loaded}/{cacheProgress.total}
          </div>
        )}
      </div>

      <div className="browse-filters">
        <div className="browse-filters-top">
          <input className="browse-search" placeholder="🔍 Поиск модов..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="sort-menu" ref={sortRef}>
            <button className="version-filter-btn" onClick={() => setShowSortMenu(v => !v)}>
              {sortLabel} ▾
            </button>
            {showSortMenu && (
              <div className="sort-dropdown">
                {sortOptions.map(o => (
                  <button key={o.value} className={`sort-option ${sortBy === o.value ? 'active' : ''}`}
                    onClick={() => { setSortBy(o.value); setShowSortMenu(false) }}>{o.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="browse-filters-row">
          <div className="filter-group">
            <span className="filter-group-title">SPT Versions</span>
            <div className="version-filter" ref={filterRef}>
              <button className={`version-filter-btn ${selectedVersions.length > 0 ? 'active' : ''}`} onClick={() => setShowVersionFilter(v => !v)}>
                {versionLabel} ▾
              </button>
              {showVersionFilter && (
                <div className="version-dropdown">
                  <div className="vd-header">
                    <span>SPT Versions</span>
                    <button className="vd-clear" onClick={() => setSelectedVersions([])}>Сбросить</button>
                  </div>
                  <div className="vd-grid">
                    {sptVersions.map(v => (
                      <label key={v} className="vd-item">
                        <input type="checkbox" checked={selectedVersions.includes(v)} onChange={() => toggleVersion(v)} />
                        <span>{v}</span>
                      </label>
                    ))}
                    <label className="vd-item vd-item-legacy">
                      <input type="checkbox" checked={selectedVersions.includes('legacy')} onChange={() => toggleVersion('legacy')} />
                      <span>Legacy Versions</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-group-title">Category</span>
            <select className="browse-select" value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div className="filter-group">
            <span className="filter-group-title">Featured</span>
            <div className="radio-group">
              {[['include','Include'],['exclude','Exclude'],['only','Only']].map(([val, label]) => (
                <label key={val} className="radio-item">
                  <input type="radio" name="featured" checked={featured === val} onChange={() => setFeatured(val)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-group-title">Fika Compatibility</span>
            <label className="checkbox-item">
              <input type="checkbox" checked={fikaOnly} onChange={e => setFikaOnly(e.target.checked)} />
              <span>Compatible Only</span>
            </label>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="browse-loading"><span className="spinner" />Загружаю...</div>
      ) : (
        <div className="browse-grid">
          {mods.map(mod => {
            const isExpanded = expandedMod?.id === mod.id
            const versions = modVersions[mod.id] || []
            const dlKey = Object.keys(downloading).find(k => k.startsWith(mod.slug || String(mod.id)))
            const dlPct = dlKey != null ? downloading[dlKey] : null
            const installedEntry = installedMap[`forge_${mod.id}`]
            const isInstalled = installedEntry?.isPresent

            return (
              <div key={mod.id} className={`mod-card ${isExpanded ? 'expanded' : ''}`}>
                <div className="mod-card-main" onClick={() => expandMod(mod)}>
                  {mod.thumbnail
                    ? <img className="mod-thumb" src={mod.thumbnail} alt="" onError={e => { e.target.style.display = 'none' }} />
                    : <div className="mod-thumb-placeholder">📦</div>
                  }
                  <div className="mod-card-info">
                    <div className="mod-card-name">
                      {mod.name}
                      {isInstalled && <span className="tag-installed">✓ Установлен</span>}
                    </div>
                    <div className="mod-card-author">{mod.owner?.name || '—'}</div>
                    <div className="mod-card-meta">
                      {mod.category && <span className="tag tag-cat">{mod.category.title}</span>}
                      {mod.fika_compatibility && <span className="tag tag-fika">Fika ✓</span>}
                      <span className="tag tag-dl">↓ {(mod.downloads || 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="mod-card-chevron">{isExpanded ? '▲' : '▼'}</div>
                </div>

                {isExpanded && (
                  <div className="mod-card-expand">
                    <p className="mod-desc">{mod.teaser || '—'}</p>
                    {versions.length > 0 && (
                      <div className="mod-versions">
                        <span className="versions-label">Версии:</span>
                        {versions.slice(0, 6).map((v, i) => (
                          <span key={i} className="tag tag-ver">{v.version} {v.spt_version_constraint && <span className="tag-spt-small">SPT {v.spt_version_constraint}</span>}</span>
                        ))}
                      </div>
                    )}
                    {versions.length === 0 && expandedMod?.id === mod.id && (
                      <div className="versions-loading"><span className="spinner" /> Загружаю версии...</div>
                    )}
                    <div className="mod-card-actions">
                      {dlPct != null ? (
                        <div className="dl-progress-wrap">
                          <div className="dl-progress">
                            <div className="dl-bar" style={{ width: dlPct >= 0 ? dlPct + '%' : '60%' }} />
                          </div>
                          <span className="dl-pct">{dlPct >= 0 ? dlPct + '%' : '...'}</span>
                        </div>
                      ) : (
                        <button className="btn btn-accent" onClick={(e) => { e.stopPropagation(); downloadWithDeps(mod) }}>
                          ↓ Скачать и установить
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="browse-pagination">
        <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Назад</button>
        <span>{page} / {totalPages}</span>
        <button className="btn btn-ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Вперёд →</button>
      </div>
    </div>
  )
}
