const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fse = require('fs-extra')
const os = require('os')
const AdmZip = require('adm-zip')
const { NodeSSH } = require('node-ssh')
const isDev = !app.isPackaged

// ─── Реестр установленных модов ────────────────────────────────────────────
function getRegistryPath() {
  return path.join(app.getPath('userData'), 'installed_mods.json')
}

function loadRegistry() {
  try {
    const p = getRegistryPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {}
  return {}
}

function saveRegistry(reg) {
  try { fs.writeFileSync(getRegistryPath(), JSON.stringify(reg, null, 2), 'utf8') } catch {}
}

function registryKey(mod) {
  if (mod?.id) return `forge_${mod.id}`
  if (mod?.name) return `local_${mod.name.replace(/[^a-z0-9]/gi, '_')}`
  return null
}

function checkModPaths(entry) {
  if (!entry?.paths?.length) return false
  return entry.paths.some(p => fs.existsSync(p))
}

ipcMain.handle('mods:getInstalled', () => {
  const reg = loadRegistry()
  return Object.values(reg).map(entry => ({
    ...entry,
    isPresent: checkModPaths(entry)
  }))
})

ipcMain.handle('mods:checkInstalled', (_, { modId }) => {
  const reg = loadRegistry()
  const key = `forge_${modId}`
  const entry = reg[key]
  if (!entry) return { installed: false }
  return { installed: checkModPaths(entry), entry }
})

ipcMain.handle('mods:remove', async (_, { key }) => {
  const reg = loadRegistry()
  const entry = reg[key]
  if (!entry) return { success: false, error: 'Не найдено в реестре' }
  const errors = []
  for (const p of (entry.paths || [])) {
    try {
      if (fs.existsSync(p)) fse.removeSync(p)
    } catch (e) { errors.push(`${p}: ${e.message}`) }
  }
  delete reg[key]
  saveRegistry(reg)
  return { success: errors.length === 0, errors }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('win-minimize', (e) => BrowserWindow.fromWebContents(e.sender).minimize())
ipcMain.on('win-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.on('win-close', (e) => BrowserWindow.fromWebContents(e.sender).close())

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openArchives', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Archives', extensions: ['zip', '7z', 'rar'] }]
  })
  return result.canceled ? [] : result.filePaths
})

// ─── Утилита: извлечь zip во временную папку ───────────────────────────────
function extractZip(archivePath, destDir) {
  const zip = new AdmZip(archivePath)
  zip.extractAllTo(destDir, true)
}

// ─── Утилита: извлечь 7z/rar через node-7z ────────────────────────────────
async function extract7z(archivePath, destDir) {
  const Seven = require('node-7z')
  const sevenBin = require('7zip-bin').path7za
  return new Promise((resolve, reject) => {
    const stream = Seven.extractFull(archivePath, destDir, { $bin: sevenBin })
    stream.on('end', resolve)
    stream.on('error', reject)
  })
}

// ─── Определить реальный формат архива по magic bytes ──────────────────────
function detectArchiveType(filePath) {
  const buf = Buffer.alloc(8)
  const fd = fs.openSync(filePath, 'r')
  fs.readSync(fd, buf, 0, 8, 0)
  fs.closeSync(fd)
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip'          // PK
  if (buf[0] === 0x37 && buf[1] === 0x7a) return '7z'           // 7z
  if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72) return 'rar' // Rar
  return path.extname(filePath).replace('.', '').toLowerCase() || 'zip'
}

// ─── Извлечь архив в temp папку ────────────────────────────────────────────
async function extractArchive(archivePath) {
  const tmpDir = path.join(os.tmpdir(), 'spt_mod_' + Date.now())
  fs.mkdirSync(tmpDir, { recursive: true })
  const type = detectArchiveType(archivePath)
  if (type === 'zip') {
    extractZip(archivePath, tmpDir)
  } else {
    await extract7z(archivePath, tmpDir)
  }
  return tmpDir
}

// ─── Найти папки BepInEx, SPT (целиком) и SPT/user в архиве ────────────────
function findDirs(baseDir) {
  const results = { bepinex: null, sptDir: null, sptUser: null }

  function walk(dir, depth) {
    if (depth > 5) return
    let entries
    try { entries = fs.readdirSync(dir) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry)
      let stat
      try { stat = fs.statSync(full) } catch { continue }
      if (!stat.isDirectory()) continue
      const low = entry.toLowerCase()

      if (low === 'bepinex' && !results.bepinex) results.bepinex = full

      if (low === 'spt') {
        if (!results.sptDir) results.sptDir = full
        const userInside = path.join(full, 'user')
        if (fs.existsSync(userInside) && !results.sptUser) results.sptUser = userInside
      }

      // user/ папка — только если внутри есть mods/ или configs/ (серверный мод)
      if (low === 'user' && !results.sptUser) {
        const subEntries = fs.readdirSync(full).map(e => e.toLowerCase())
        if (subEntries.includes('mods') || subEntries.includes('configs') || subEntries.includes('cache')) {
          results.sptUser = full
          // Если нашли user/ то sptDir = родительская папка
          if (!results.sptDir) results.sptDir = path.dirname(full)
        }
      }

      walk(full, depth + 1)
    }
  }

  walk(baseDir, 0)
  return results
}

// ─── Рекурсивно загрузить папку по SSH ─────────────────────────────────────
async function uploadDirSSH(ssh, localDir, remoteDir, logFn) {
  logFn({ type: 'info', text: `Загружаю ${localDir} → ${remoteDir}` })
  await ssh.execCommand(`mkdir -p "${remoteDir}"`)
  await ssh.putDirectory(localDir, remoteDir, {
    recursive: true,
    concurrency: 5,
    tick(local, remote, err) {
      if (err) logFn({ type: 'error', text: `Ошибка: ${local}` })
    }
  })
}

// ─── Главный обработчик установки ──────────────────────────────────────────
ipcMain.handle('mods:install', async (event, { mods, gamePath, ssh, serverMode }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const log = (msg) => win.webContents.send('install:log', msg)
  let sshConn = null
  const reg = loadRegistry()

  for (const modItem of mods) {
    // modItem: { path, name, meta: { id, name, version, slug } }
    const archivePath = typeof modItem === 'string' ? modItem : modItem.path
    const modMeta = typeof modItem === 'object' ? modItem.meta : null
    const name = path.basename(archivePath)
    const installedPaths = []
    log({ type: 'info', text: `▶ ${name}` })

    let tmpDir
    try {
      log({ type: 'info', text: `Распаковываю...` })
      const archiveType = detectArchiveType(archivePath)
      log({ type: 'info', text: `Формат: ${archiveType}` })
      tmpDir = await extractArchive(archivePath)
      log({ type: 'info', text: `Распаковано в ${tmpDir}` })
    } catch (err) {
      log({ type: 'error', text: `Ошибка распаковки: ${err.message}` })
      continue
    }

    // Логируем структуру архива (1 уровень) для диагностики
    try {
      const topEntries = fs.readdirSync(tmpDir)
      log({ type: 'info', text: `Содержимое: ${topEntries.join(', ')}` })
      for (const e of topEntries) {
        try {
          const sub = fs.readdirSync(path.join(tmpDir, e))
          log({ type: 'info', text: `  ${e}/: ${sub.join(', ')}` })
        } catch {}
      }
    } catch {}

    const { bepinex, sptDir, sptUser } = findDirs(tmpDir)
    log({ type: 'info', text: `Найдено: ${[bepinex && 'BepInEx', sptDir && 'SPT', sptUser && 'user'].filter(Boolean).join(', ') || 'ничего не распознано'}` })

    // Клиентский мод — копируем BepInEx
    if (bepinex) {
      if (!gamePath) {
        log({ type: 'error', text: 'Путь к игре не указан — пропускаю BepInEx' })
      } else {
        try {
          // Копируем каждую подпапку BepInEx/plugins отдельно для точного трекинга
          const pluginsDir = path.join(bepinex, 'plugins')
          if (fs.existsSync(pluginsDir)) {
            for (const entry of fs.readdirSync(pluginsDir)) {
              const src = path.join(pluginsDir, entry)
              const dest = path.join(gamePath, 'BepInEx', 'plugins', entry)
              fse.copySync(src, dest, { overwrite: true })
              installedPaths.push(dest)
            }
          } else {
            const dest = path.join(gamePath, 'BepInEx')
            fse.copySync(bepinex, dest, { overwrite: true })
            installedPaths.push(dest)
          }
          log({ type: 'success', text: `BepInEx установлен ✓` })
        } catch (err) {
          log({ type: 'error', text: `Ошибка копирования BepInEx: ${err.message}` })
        }
      }
    }

    // Серверный мод
    const hasSptContent = sptUser || sptDir
    if (hasSptContent) {
      if (serverMode === 'local') {
        // Локальная установка — копируем папку SPT в gamePath
        if (!gamePath) {
          log({ type: 'error', text: 'Путь к игре не указан — пропускаю серверный мод' })
        } else if (!sptDir) {
          log({ type: 'error', text: 'Папка SPT не найдена в архиве' })
        } else {
          try {
            const dest = path.join(gamePath, 'SPT')
            log({ type: 'info', text: `Копирую SPT → ${dest}` })
            fse.copySync(sptDir, dest, { overwrite: true })
            // Трекаем папки user/mods и user/configs отдельно
            const userModsDir = path.join(gamePath, 'SPT', 'user', 'mods')
            installedPaths.push(fs.existsSync(userModsDir) ? userModsDir : dest)
            log({ type: 'success', text: `Серверный мод установлен локально ✓` })
          } catch (err) {
            log({ type: 'error', text: `Ошибка копирования SPT: ${err.message}` })
          }
        }
      } else {
        // SSH установка — загружаем user на сервер
        if (!ssh?.host) {
          log({ type: 'error', text: 'SSH не настроен — пропускаю серверный мод' })
        } else {
          try {
            if (!sshConn) {
              sshConn = new NodeSSH()
              const connCfg = { host: ssh.host, port: parseInt(ssh.port) || 22, username: ssh.user }
              if (ssh.authType === 'key') connCfg.privateKeyPath = ssh.keyPath
              else connCfg.password = ssh.password
              log({ type: 'info', text: `Подключаюсь к ${ssh.user}@${ssh.host}:${ssh.port}...` })
              await sshConn.connect(connCfg)
              log({ type: 'success', text: `SSH подключён ✓` })
            }
            const serverPath = (ssh.serverPath || '/root/SPT/').replace(/\/$/, '')
            const remoteUser = serverPath + '/user'
            await uploadDirSSH(sshConn, sptUser, remoteUser, log)
            installedPaths.push(`ssh:${ssh.user}@${ssh.host}:${remoteUser}`)
            log({ type: 'success', text: `Серверный мод установлен ✓` })
          } catch (err) {
            log({ type: 'error', text: `SSH ошибка: ${err.message}` })
          }
        }
      }
    }

    // Чистим temp архив
    try { fse.removeSync(tmpDir) } catch {}

    // Удаляем скачанный файл из spt_downloads
    const downloadsDir = path.join(os.tmpdir(), 'spt_downloads')
    if (archivePath.startsWith(downloadsDir)) {
      try { fs.unlinkSync(archivePath) } catch {}
    }

    // Сохраняем в реестр если есть что записать
    if (installedPaths.length > 0) {
      const key = registryKey(modMeta) || `local_${name.replace(/[^a-z0-9]/gi, '_')}`
      reg[key] = {
        key,
        id: modMeta?.id || null,
        name: modMeta?.name || name,
        version: modMeta?.version || null,
        slug: modMeta?.slug || null,
        installedAt: new Date().toISOString(),
        paths: installedPaths
      }
      saveRegistry(reg)
    }

    log({ type: 'success', text: `${name} — готово\n` })
  }

  if (sshConn) sshConn.dispose()
  log({ type: 'done', text: '✓ Установка завершена' })
})

// ─── Forge API helpers ──────────────────────────────────────────────────────
async function forgeGet(endpoint, token, params = {}) {
  const https = require('https')
  const url = new URL('https://forge.sp-tarkov.com' + endpoint)
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(i => url.searchParams.append(k, i))
    else url.searchParams.set(k, v)
  })
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname, path: url.pathname + url.search, method: 'GET',
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// Кеш всех модов для поиска/фильтрации
let allModsCache = null
let allModsCacheToken = null
let allModsCacheLoading = false

async function loadAllMods(token, progressCallback) {
  if (allModsCache && allModsCacheToken === token) return allModsCache
  if (allModsCacheLoading) {
    // Ждём пока загрузится
    while (allModsCacheLoading) await new Promise(r => setTimeout(r, 200))
    if (allModsCache) return allModsCache
  }

  allModsCacheLoading = true
  const all = []
  try {
    // Первая страница — узнаём last_page
    const first = await forgeGet('/api/v0/mods', token, { page: 1, per_page: 50 })
    if (!first?.data) { allModsCacheLoading = false; return null }
    all.push(...first.data)
    const lastPage = first.meta?.last_page || 1
    if (progressCallback) progressCallback(1, lastPage)

    // Загружаем оставшиеся страницы параллельно по 5
    const pages = []
    for (let p = 2; p <= lastPage; p++) pages.push(p)
    for (let i = 0; i < pages.length; i += 5) {
      const batch = pages.slice(i, i + 5)
      const results = await Promise.all(batch.map(p =>
        forgeGet('/api/v0/mods', token, { page: p, per_page: 50 }).catch(() => null)
      ))
      for (const r of results) {
        if (r?.data) all.push(...r.data)
      }
      if (progressCallback) progressCallback(1 + i + batch.length, lastPage)
    }

    allModsCache = all
    allModsCacheToken = token
  } finally {
    allModsCacheLoading = false
  }
  return all
}

ipcMain.handle('forge:getMods', async (event, { token, page, search, sptVersions, category, sort, featured, fikaOnly, useCache }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const currentPage = page || 1
  const sortParam = sort || '-updated_at'
  const needsLocalFilter = search || (sptVersions && sptVersions.length) || category || featured === 'only' || featured === 'exclude' || fikaOnly

  // Без фильтров — просто API пагинация
  if (!needsLocalFilter) {
    const result = await forgeGet('/api/v0/mods', token, { page: currentPage, per_page: 50, sort: sortParam })
    return result
  }

  // С фильтрами — грузим всё и фильтруем локально
  const sendProgress = (loaded, total) => {
    win.webContents.send('forge:cacheProgress', { loaded, total })
  }

  const all = await loadAllMods(token, sendProgress)
  if (!all) return { data: [], meta: { current_page: 1, last_page: 1, total: 0 } }

  let filtered = all

  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(m =>
      m.name?.toLowerCase().includes(q) ||
      m.teaser?.toLowerCase().includes(q) ||
      m.owner?.name?.toLowerCase().includes(q)
    )
  }

  if (category) {
    filtered = filtered.filter(m =>
      m.category?.slug === category ||
      m.category?.title?.toLowerCase() === category.toLowerCase()
    )
  }

  if (featured === 'only') filtered = filtered.filter(m => m.featured === true)
  if (featured === 'exclude') filtered = filtered.filter(m => m.featured !== true)
  if (fikaOnly) filtered = filtered.filter(m => m.fika_compatibility === true)

  // Сортировка локального кеша
  const sortField = sortParam.replace('-', '')
  const sortDir = sortParam.startsWith('-') ? -1 : 1
  filtered.sort((a, b) => {
    const av = a[sortField] || 0
    const bv = b[sortField] || 0
    if (av < bv) return -sortDir
    if (av > bv) return sortDir
    return 0
  })

  if (sptVersions && sptVersions.length > 0) {
    // SPT версии в versions запрашиваем только при необходимости
    // Фильтруем по category_id или другим доступным полям
    // Версии загружаем отдельно по запросу
  }

  const perPage = 24
  const total = filtered.length
  const start = (currentPage - 1) * perPage
  return {
    data: filtered.slice(start, start + perPage),
    meta: {
      current_page: currentPage,
      per_page: perPage,
      total,
      last_page: Math.max(1, Math.ceil(total / perPage))
    }
  }
})

ipcMain.handle('forge:clearCache', async () => {
  allModsCache = null
  allModsCacheToken = null
})

ipcMain.handle('forge:getModDetails', async (_, { token, modId }) => {
  return forgeGet(`/api/v0/mod/${modId}`, token)
})

ipcMain.handle('forge:getModVersions', async (_, { token, modId }) => {
  return forgeGet(`/api/v0/mod/${modId}/versions`, token, { sort: '-created_at', per_page: 50 })
})

ipcMain.handle('forge:getDependencies', async (_, { token, modId, version }) => {
  const modsParam = version ? `${modId}:${version}` : `${modId}:0`
  return forgeGet('/api/v0/mods/dependencies', token, { mods: modsParam })
})

ipcMain.handle('forge:getSptVersions', async (_, { token }) => {
  return forgeGet('/api/v0/spt-versions', token)
})

// ─── Парсинг версий и категорий со страницы Forge ──────────────────────────
ipcMain.handle('forge:scrapeFilters', async () => {
  const https = require('https')
  const html = await new Promise((resolve, reject) => {
    https.get('https://forge.sp-tarkov.com/mods', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })

  // Парсим версии: wire:click="toggleVersionFilter('4.0.12')"
  const versions = []
  const verRe = /toggleVersionFilter\('([^']+)'\)/g
  let m
  while ((m = verRe.exec(html)) !== null) {
    const v = m[1]
    if (v !== 'all' && v !== 'legacy' && !versions.includes(v)) versions.push(v)
  }
  console.log('[scrape] versions found:', versions.length, versions.slice(0,3))
  console.log('[scrape] html snippet:', html.slice(0, 300))

  // Парсим категории: <option value="audio">Audio</option>
  const categories = []
  const catRe = /wire:model\.live="category"[\s\S]*?<\/select>/
  const catBlock = html.match(catRe)?.[0] || ''
  const optRe = /<option value="([^"]+)">([^<]+)<\/option>/g
  while ((m = optRe.exec(catBlock)) !== null) {
    if (m[1]) categories.push({ value: m[1], label: m[2].trim() })
  }

  return { versions, categories }
})

// ─── Нормализовать ссылку для скачивания ───────────────────────────────────
function normalizeDownloadUrl(url) {
  if (!url) return url
  // Google Drive: /file/d/ID/view → прямая ссылка drive.usercontent
  const gdMatch = url.match(/drive\.google\.com\/file\/d\/([^\/\?]+)/)
  if (gdMatch) return `https://drive.usercontent.google.com/download?id=${gdMatch[1]}&export=download&authuser=0&confirm=t`
  // Dropbox: гарантируем dl=1
  if (url.includes('dropbox.com')) return url.replace(/[?&]dl=0/, '').replace(/[?&]st=[^&]+/, '') + (url.includes('?') ? '&dl=1' : '?dl=1')
  return url
}

// ─── Скачать файл по URL во временную папку ────────────────────────────────
ipcMain.handle('forge:downloadMod', async (event, { url, token, filename }) => {
  const https = require('https')
  const http = require('http')
  const win = BrowserWindow.fromWebContents(event.sender)

  const tmpDir = path.join(os.tmpdir(), 'spt_downloads')
  fs.mkdirSync(tmpDir, { recursive: true })
  const dest = path.join(tmpDir, filename)

  const normalizedUrl = normalizeDownloadUrl(url)

  function doDownload(dlUrl, redirectCount = 0) {
    return new Promise((resolve, reject) => {
      if (redirectCount > 10) return reject(new Error('Too many redirects'))
      const mod = dlUrl.startsWith('https') ? https : http
      const opts = new URL(dlUrl)
      const reqOpts = {
        hostname: opts.hostname, path: opts.pathname + opts.search, method: 'GET',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0' }
      }
      mod.request(reqOpts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, dlUrl).href
          res.resume()
          return doDownload(next, redirectCount + 1).then(resolve).catch(reject)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} от ${dlUrl}`))
        }
        const total = parseInt(res.headers['content-length'] || '0')
        let received = 0
        const file = fs.createWriteStream(dest)
        res.on('data', chunk => {
          received += chunk.length
          if (total > 0) win.webContents.send('forge:downloadProgress', { filename, received, total })
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve(dest)))
        file.on('error', reject)
      }).on('error', reject).end()
    })
  }

  await doDownload(normalizedUrl)
  return dest
})
