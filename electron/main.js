const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fse = require('fs-extra')
const os = require('os')
const zlib = require('zlib')
const AdmZip = require('adm-zip')
const { NodeSSH } = require('node-ssh')
const isDev = !app.isPackaged
ipcMain.handle('modpack:export', () => {
  const reg = loadRegistry()
  const mods = Object.values(reg)
    .filter(e => e.id) // только Forge моды
    .map(e => ({ id: e.id, name: e.name, version: e.version, slug: e.slug }))
  if (!mods.length) return { error: 'Нет установленных Forge модов' }
  const json = JSON.stringify({ v: 1, mods })
  const compressed = zlib.deflateSync(Buffer.from(json, 'utf8'))
  const key = 'SPT-' + compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return { key, count: mods.length }
})

ipcMain.handle('modpack:import', (_, { key }) => {
  try {
    const b64 = key.replace(/^SPT-/, '').replace(/-/g, '+').replace(/_/g, '/')
    const buf = Buffer.from(b64, 'base64')
    const json = zlib.inflateSync(buf).toString('utf8')
    const data = JSON.parse(json)
    if (data.v !== 1 || !Array.isArray(data.mods)) return { error: 'Неверный формат ключа' }
    return { mods: data.mods }
  } catch {
    return { error: 'Не удалось прочитать ключ — возможно он повреждён' }
  }
})

// ─── Глобальный перехватчик SSH/сетевых ошибок ─────────────────────────────
process.on('uncaughtException', (err) => {
  const ignorable = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH']
  if (ignorable.some(code => err.code === code || err.message?.includes(code))) {
    console.warn('[SSH] Ignored network error:', err.message)
    return
  }
  console.error('[UNCAUGHT]', err)
})

process.on('unhandledRejection', (reason) => {
  console.warn('[UNHANDLED REJECTION]', reason)
})

// ─── Профили ───────────────────────────────────────────────────────────────
function getProfilesFilePath() {
  return path.join(app.getPath('userData'), 'profiles.json')
}

function loadProfilesData() {
  try {
    const p = getProfilesFilePath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {}
  return { active: null, list: [] }
}

function saveProfilesData(data) {
  try { fs.writeFileSync(getProfilesFilePath(), JSON.stringify(data, null, 2), 'utf8') } catch {}
}

function ensureDefaultProfile() {
  let data = loadProfilesData()
  if (data.list.length > 0 && data.active) return data

  const defaultId = 'profile_default'
  // Мигрируем старый реестр если есть
  const oldRegistry = path.join(app.getPath('userData'), 'installed_mods.json')
  const newRegistry = path.join(app.getPath('userData'), `registry_${defaultId}.json`)
  if (fs.existsSync(oldRegistry) && !fs.existsSync(newRegistry)) {
    try { fs.renameSync(oldRegistry, newRegistry) } catch {}
  }

  if (data.list.length === 0) {
    data.list.push({ id: defaultId, name: 'Default', gamePath: '', createdAt: new Date().toISOString() })
  }
  data.active = data.active || defaultId
  saveProfilesData(data)
  return data
}

ipcMain.handle('profiles:getAll', () => {
  return ensureDefaultProfile()
})

ipcMain.handle('profiles:create', (_, { name, gamePath }) => {
  const data = loadProfilesData()
  const id = 'profile_' + Date.now()
  data.list.push({ id, name: name || 'Новый профиль', gamePath: gamePath || '', createdAt: new Date().toISOString() })
  saveProfilesData(data)
  return { success: true, id, list: data.list, active: data.active }
})

ipcMain.handle('profiles:setActive', (_, { id }) => {
  const data = loadProfilesData()
  if (!data.list.find(p => p.id === id)) return { error: 'Профиль не найден' }
  data.active = id
  saveProfilesData(data)
  const profile = data.list.find(p => p.id === id)
  return { success: true, profile, list: data.list, active: id }
})

ipcMain.handle('profiles:rename', (_, { id, name }) => {
  const data = loadProfilesData()
  const p = data.list.find(p => p.id === id)
  if (!p) return { error: 'Профиль не найден' }
  p.name = name
  saveProfilesData(data)
  return { success: true, list: data.list }
})

ipcMain.handle('profiles:updateGamePath', (_, { id, gamePath }) => {
  const data = loadProfilesData()
  const p = data.list.find(p => p.id === id)
  if (!p) return { error: 'Профиль не найден' }
  p.gamePath = gamePath
  saveProfilesData(data)
  return { success: true }
})

ipcMain.handle('profiles:delete', (_, { id }) => {
  const data = loadProfilesData()
  if (data.list.length <= 1) return { error: 'Нельзя удалить последний профиль' }
  data.list = data.list.filter(p => p.id !== id)
  if (data.active === id) data.active = data.list[0].id
  saveProfilesData(data)
  try {
    const rp = path.join(app.getPath('userData'), `registry_${id}.json`)
    if (fs.existsSync(rp)) fs.unlinkSync(rp)
  } catch {}
  return { success: true, active: data.active, list: data.list }
})

// ─── Реестр установленных модов ────────────────────────────────────────────
function getRegistryPath() {
  const data = loadProfilesData()
  const id = data.active || 'profile_default'
  return path.join(app.getPath('userData'), `registry_${id}.json`)
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

function checkModPaths(entry, sshResults = {}) {
  if (!entry?.paths?.length) return false
  return entry.paths.some(p => {
    if (p.startsWith('ssh:')) {
      // Если есть результат проверки — используем его, иначе считаем установленным
      return p in sshResults ? sshResults[p] : true
    }
    return fs.existsSync(p)
  })
}

ipcMain.handle('mods:getInstalled', async (_, { ssh } = {}) => {
  const reg = loadRegistry()

  // Собираем уникальные SSH-хосты из всех путей
  const sshPaths = {}
  for (const entry of Object.values(reg)) {
    for (const p of (entry.paths || [])) {
      if (p.startsWith('ssh:')) {
        // Формат: ssh:user@host:path
        const match = p.match(/^ssh:([^@]+)@([^:]+):(.+)$/)
        if (match) {
          const host = match[2]
          if (!sshPaths[host]) sshPaths[host] = []
          sshPaths[host].push({ entry, path: p, remotePath: match[3] })
        }
      }
    }
  }

  // Проверяем SSH пути если есть настройки
  const sshResults = {} // path → true/false
  if (ssh?.host && Object.keys(sshPaths).length > 0) {
    const conn = new NodeSSH()
    let connected = false
    try {
      const connCfg = { host: ssh.host, port: parseInt(ssh.port) || 22, username: ssh.user, readyTimeout: 6000 }
      if (ssh.authType === 'key') connCfg.privateKeyPath = ssh.keyPath
      else connCfg.password = ssh.password
      await conn.connect(connCfg)
      connected = true

      const hostPaths = sshPaths[ssh.host] || []
      for (const { path: fullPath, remotePath } of hostPaths) {
        const res = await conn.execCommand(`if exist "${remotePath}" (echo 1) else (echo 0)`)
        // Пробуем и Windows и Linux команду
        const winOut = res.stdout?.trim()
        if (winOut === '1' || winOut === '0') {
          sshResults[fullPath] = winOut === '1'
        } else {
          const res2 = await conn.execCommand(`[ -e "${remotePath}" ] && echo 1 || echo 0`)
          sshResults[fullPath] = res2.stdout?.trim() === '1'
        }
      }
    } catch {}
    if (connected) try { conn.dispose() } catch {}
  }

  return Object.values(reg).map(entry => {
    const pathStatuses = (entry.paths || []).map(p => ({
      path: p,
      isSSH: p.startsWith('ssh:'),
      present: p.startsWith('ssh:')
        ? (p in sshResults ? sshResults[p] : true)
        : fs.existsSync(p)
    }))
    return {
      ...entry,
      pathStatuses,
      isPresent: pathStatuses.some(s => s.present)
    }
  })
})

ipcMain.handle('mods:checkInstalled', (_, { modId }) => {
  const reg = loadRegistry()
  const key = `forge_${modId}`
  const entry = reg[key]
  if (!entry) return { installed: false }
  return { installed: checkModPaths(entry), entry }
})

ipcMain.handle('mods:remove', async (_, { key, ssh }) => {
  const reg = loadRegistry()
  const entry = reg[key]
  if (!entry) return { success: false, error: 'Не найдено в реестре' }

  const errors = []
  let sshConn = null

  for (const p of (entry.paths || [])) {
    if (p.startsWith('ssh:')) {
      // Формат: ssh:user@host:remotePath
      const match = p.match(/^ssh:([^@]+)@([^:]+):(.+)$/)
      if (!match) continue
      const remotePath = match[3]
      try {
        if (!sshConn) {
          if (!ssh?.host) { errors.push(`SSH: нет настроек подключения`); continue }
          sshConn = new NodeSSH()
          const connCfg = { host: ssh.host, port: parseInt(ssh.port) || 22, username: ssh.user, readyTimeout: 10000 }
          if (ssh.authType === 'key') connCfg.privateKeyPath = ssh.keyPath
          else connCfg.password = ssh.password
          await sshConn.connect(connCfg)
        }
        if (sshConn) {
          const isWin = /^[A-Za-z]:/.test(remotePath)
          let deleted = false

          if (isWin) {
            // Windows: пробуем rmdir (папка) и del (файл)
            const r1 = await sshConn.execCommand(`rmdir /s /q "${remotePath}"`)
            if (!r1.stderr?.includes('не найден') && !r1.stderr?.includes('cannot find')) {
              deleted = true
            } else {
              const r2 = await sshConn.execCommand(`del /f /q "${remotePath}"`)
              deleted = !r2.stderr
            }
          } else {
            // Linux
            const r = await sshConn.execCommand(`rm -rf "${remotePath}"`)
            deleted = !r.stderr
          }

          // Проверяем что реально удалилось
          const check = isWin
            ? await sshConn.execCommand(`if exist "${remotePath}" (echo 1) else (echo 0)`)
            : await sshConn.execCommand(`[ -e "${remotePath}" ] && echo 1 || echo 0`)
          const still = check.stdout?.trim() === '1'
          if (still) errors.push(`SSH: не удалось удалить ${remotePath}`)
        }
      } catch (e) {
        errors.push(`SSH ${remotePath}: ${e.message}`)
      }
    } else {
      try {
        if (fs.existsSync(p)) fse.removeSync(p)
      } catch (e) {
        errors.push(`${p}: ${e.message}`)
      }
    }
  }

  if (sshConn) try { sshConn.dispose() } catch {}

  delete reg[key]
  saveRegistry(reg)
  return { success: errors.length === 0, errors }
})

ipcMain.handle('mods:exportList', async () => {
  const reg = loadRegistry()
  const names = Object.values(reg).map(e => e.name).filter(Boolean).sort()
  const content = names.join('\n')
  const filePath = path.join(app.getPath('desktop'), 'spt-mods-list.txt')
  fs.writeFileSync(filePath, content, 'utf8')
  require('electron').shell.openPath(filePath)
  return { success: true, count: names.length, filePath }
})

ipcMain.handle('mods:deleteTempFile', (_, { path: filePath }) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('mods:getTempDownloads', () => {
  const tmpDir = path.join(os.tmpdir(), 'spt_downloads')
  if (!fs.existsSync(tmpDir)) return []
  return fs.readdirSync(tmpDir)
    .filter(f => /\.(zip|7z|rar)$/i.test(f))
    .map(f => {
      const full = path.join(tmpDir, f)
      return { path: full, name: f, type: 'unknown', status: 'pending', fromTemp: true }
    })
})

function createWindow() {
  const iconPath = path.join(__dirname, '../assets/icon.ico')
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f1117',
    icon: iconPath,
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

app.whenReady().then(() => {
  ensureDefaultProfile()
  createWindow()
})

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
  // В packaged приложении 7za.exe лежит в resources/ (extraResources)
  // В dev режиме — из node_modules
  let sevenBin
  if (app.isPackaged) {
    sevenBin = path.join(process.resourcesPath, '7za.exe')
  } else {
    sevenBin = require('7zip-bin').path7za
  }
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

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Таймаут распаковки (10 мин)')), 600000)
  )

  let extract
  if (type === 'zip') {
    // Сначала пробуем adm-zip, при ошибке fallback на 7z
    extract = (async () => {
      try {
        extractZip(archivePath, tmpDir)
      } catch (e) {
        if (e.message?.includes('Invalid') || e.message?.includes('unsupported')) {
          await extract7z(archivePath, tmpDir)
        } else {
          throw e
        }
      }
    })()
  } else {
    extract = extract7z(archivePath, tmpDir)
  }

  await Promise.race([extract, timeout])
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

  // Создаём корневую папку
  await ssh.execCommand(`mkdir "${remoteDir}" 2>nul & md "${remoteDir}" 2>nul || mkdir -p "${remoteDir}" 2>/dev/null; true`)

  const allFiles = []
  function collectFiles(dir, remoteBase) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const localPath = path.join(dir, entry.name)
      const remotePath = remoteBase + '\\' + entry.name
      if (entry.isDirectory()) {
        collectFiles(localPath, remotePath)
      } else {
        allFiles.push({ local: localPath, remote: remotePath })
      }
    }
  }
  collectFiles(localDir, remoteDir)

  // Создаём все нужные папки
  const remoteDirs = new Set()
  for (const f of allFiles) {
    remoteDirs.add(f.remote.substring(0, f.remote.lastIndexOf('\\')))
  }
  for (const d of remoteDirs) {
    await ssh.execCommand(`mkdir "${d}" 2>nul & md "${d}" 2>nul || mkdir -p "${d}" 2>/dev/null; true`)
  }

  // Загружаем файлы батчами по 5
  let errors = 0
  for (let i = 0; i < allFiles.length; i += 5) {
    const batch = allFiles.slice(i, i + 5)
    await Promise.all(batch.map(async f => {
      try {
        await ssh.putFile(f.local, f.remote)
      } catch (e) {
        errors++
        logFn({ type: 'error', text: `Ошибка: ${path.basename(f.local)}: ${e.message}` })
      }
    }))
  }
  if (errors === 0) logFn({ type: 'success', text: `Загружено ${allFiles.length} файлов ✓` })
  else logFn({ type: 'info', text: `Загружено ${allFiles.length - errors}/${allFiles.length} файлов` })
}

async function connectSSH(ssh, log) {
  const conn = new NodeSSH()
  const connCfg = {
    host: ssh.host, port: parseInt(ssh.port) || 22, username: ssh.user,
    readyTimeout: 15000, keepaliveInterval: 5000
  }
  if (ssh.authType === 'key') connCfg.privateKeyPath = ssh.keyPath
  else connCfg.password = ssh.password

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) {
        log({ type: 'info', text: `SSH: попытка ${attempt}/3...` })
        await new Promise(r => setTimeout(r, 2000 * attempt))
      }
      await conn.connect(connCfg)
      return conn
    } catch (e) {
      if (attempt === 3) throw e
      log({ type: 'info', text: `SSH: ошибка (${e.message}), повтор...` })
    }
  }
}
ipcMain.handle('ssh:test', async (_, { ssh }) => {
  return new Promise((resolve) => {
    const conn = new NodeSSH()
    let settled = false

    const done = (result) => {
      if (settled) return
      settled = true
      try { conn.dispose() } catch {}
      resolve(result)
    }

    const timer = setTimeout(() => {
      done({ success: false, error: 'Таймаут подключения (8 сек)' })
    }, 8000)

    const connCfg = {
      host: ssh.host,
      port: parseInt(ssh.port) || 22,
      username: ssh.user,
      readyTimeout: 7000,
      keepaliveInterval: 0,
    }
    if (ssh.authType === 'key') connCfg.privateKeyPath = ssh.keyPath
    else connCfg.password = ssh.password

    conn.connect(connCfg).then(async () => {
      clearTimeout(timer)
      try {
        const result = await conn.execCommand('echo OK && uname -a')
        done({ success: true, info: result.stdout?.trim() })
      } catch (e) {
        done({ success: false, error: e.message })
      }
    }).catch((e) => {
      clearTimeout(timer)
      done({ success: false, error: e.message })
    })

    // Ловим низкоуровневые ошибки сокета через внутренний клиент
    try {
      const client = conn.connection
      if (client) {
        client.on('error', (e) => {
          clearTimeout(timer)
          done({ success: false, error: e.message })
        })
      }
    } catch {}
  })
})
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
      log({ type: 'info', text: `Формат: ${archiveType}, размер: ${(fs.statSync(archivePath).size / 1024 / 1024).toFixed(1)} МБ` })
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

    // Клиентский мод (BepInEx) — локально всегда, + SSH если режим 'both'
    if (bepinex) {
      if (!gamePath) {
        log({ type: 'error', text: 'Путь к игре не указан — пропускаю BepInEx' })
      } else {
        try {
          // Копируем весь BepInEx целиком → gamePath/BepInEx (сохраняет patchers, config, core и т.д.)
          const destBepInEx = path.join(gamePath, 'BepInEx')
          fse.copySync(bepinex, destBepInEx, { overwrite: true })
          // Для реестра записываем конкретные папки плагинов
          const pluginsDir = path.join(destBepInEx, 'plugins')
          if (fs.existsSync(pluginsDir)) {
            for (const entry of fs.readdirSync(pluginsDir)) {
              installedPaths.push(path.join(pluginsDir, entry))
            }
          } else {
            installedPaths.push(destBepInEx)
          }
          log({ type: 'success', text: `BepInEx установлен локально ✓` })
        } catch (err) {
          log({ type: 'error', text: `Ошибка копирования BepInEx: ${err.message}` })
        }
      }

      // В режимах 'both' и 'mixed' — заливаем BepInEx и на сервер
      if (serverMode === 'both' || serverMode === 'mixed') {
        if (!ssh?.host) {
          log({ type: 'error', text: 'SSH не настроен — пропускаю BepInEx на сервер' })
        } else {
          try {
            if (!sshConn) {
              log({ type: 'info', text: `Подключаюсь к ${ssh.user}@${ssh.host}:${ssh.port}...` })
              sshConn = await connectSSH(ssh, log)
              log({ type: 'success', text: `SSH подключён ✓` })
            }
            const serverRoot = (ssh.serverPath || 'C:\\SPT').replace(/[/\\]$/, '')
            const isWinServer = /^[A-Za-z]:/.test(serverRoot)
            const sep = isWinServer ? '\\' : '/'
            const remoteBepInEx = serverRoot + sep + 'BepInEx'
            await uploadDirSSH(sshConn, bepinex, remoteBepInEx, log)
            // Для реестра — конкретные папки плагинов на сервере
            const pluginsDir = path.join(bepinex, 'plugins')
            if (fs.existsSync(pluginsDir)) {
              for (const entry of fs.readdirSync(pluginsDir)) {
                installedPaths.push(`ssh:${ssh.user}@${ssh.host}:${remoteBepInEx}${sep}plugins${sep}${entry}`)
              }
            } else {
              installedPaths.push(`ssh:${ssh.user}@${ssh.host}:${remoteBepInEx}`)
            }
            log({ type: 'success', text: `BepInEx залит на сервер ✓` })
          } catch (err) {
            log({ type: 'error', text: `SSH ошибка (BepInEx): ${err.message}` })
            if (sshConn) { try { sshConn.dispose() } catch {} sshConn = null }
          }
        }
      }
    }

    // Серверный мод
    const hasSptContent = sptUser || sptDir
    if (hasSptContent) {
      // local, both: локально | ssh, both, mixed: SSH
      const serverLocal = serverMode === 'local' || serverMode === 'both'
      const serverSSH   = serverMode === 'ssh'   || serverMode === 'both' || serverMode === 'mixed'

      if (serverLocal) {
        if (!gamePath) {
          log({ type: 'error', text: 'Путь к игре не указан — пропускаю локальный SPT' })
        } else if (!sptDir) {
          log({ type: 'error', text: 'Папка SPT не найдена в архиве' })
        } else {
          try {
            const dest = path.join(gamePath, 'SPT')
            log({ type: 'info', text: `Копирую SPT → ${dest}` })
            fse.copySync(sptDir, dest, { overwrite: true })
            // Записываем конкретные папки модов
            const modsDir = path.join(gamePath, 'SPT', 'user', 'mods')
            if (fs.existsSync(modsDir)) {
              for (const modFolder of fs.readdirSync(modsDir)) {
                installedPaths.push(path.join(modsDir, modFolder))
              }
            } else {
              installedPaths.push(dest)
            }
            log({ type: 'success', text: `Серверный мод установлен локально ✓` })
          } catch (err) {
            log({ type: 'error', text: `Ошибка копирования SPT: ${err.message}` })
          }
        }
      }

      // SSH установка
      if (serverSSH) {
        if (!ssh?.host) {
          log({ type: 'error', text: 'SSH не настроен — пропускаю удалённую установку' })
        } else {
          try {
            if (!sshConn) {
              log({ type: 'info', text: `Подключаюсь к ${ssh.user}@${ssh.host}:${ssh.port}...` })
              sshConn = await connectSSH(ssh, log)
              log({ type: 'success', text: `SSH подключён ✓` })
            }
            const serverRoot = (ssh.serverPath || 'C:\\SPT').replace(/[/\\]$/, '')
            const isWinServer = /^[A-Za-z]:/.test(serverRoot)
            const sep = isWinServer ? '\\' : '/'
            const uploadSrc = sptUser || path.join(sptDir, 'user')
            if (!fs.existsSync(uploadSrc)) {
              log({ type: 'error', text: `Папка user не найдена в архиве для SSH` })
            } else {
              const remoteUser = serverRoot + sep + 'SPT' + sep + 'user'
              await uploadDirSSH(sshConn, uploadSrc, remoteUser, log)

              // Записываем конкретные папки модов, а не всю user/
              const modsDir = path.join(uploadSrc, 'mods')
              if (fs.existsSync(modsDir)) {
                for (const modFolder of fs.readdirSync(modsDir)) {
                  installedPaths.push(`ssh:${ssh.user}@${ssh.host}:${remoteUser}${sep}mods${sep}${modFolder}`)
                }
              } else {
                // Нет mods/ — пишем корень user как fallback
                installedPaths.push(`ssh:${ssh.user}@${ssh.host}:${remoteUser}`)
              }
              log({ type: 'success', text: `Серверный мод установлен на сервер ✓` })
            }
          } catch (err) {
            log({ type: 'error', text: `SSH ошибка: ${err.message}` })
            if (sshConn) { try { sshConn.dispose() } catch {} sshConn = null }
          }
        }
      }
    }

    // Чистим temp архив асинхронно чтобы не блокировать
    if (tmpDir) setImmediate(() => { try { fse.removeSync(tmpDir) } catch {} })

    // Удаляем скачанный файл из spt_downloads асинхронно
    const downloadsDir = path.join(os.tmpdir(), 'spt_downloads')
    if (archivePath.startsWith(downloadsDir)) {
      setImmediate(() => { try { fs.unlinkSync(archivePath) } catch {} })
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
        source: modMeta?.id ? 'forge' : 'manual',
        installedAt: new Date().toISOString(),
        paths: installedPaths
      }
      saveRegistry(reg)
    }

    log({ type: 'success', text: `${name} — готово\n` })
  }

  if (sshConn) try { sshConn.dispose() } catch {}
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
  const { net } = require('electron')
  const win = BrowserWindow.fromWebContents(event.sender)

  const tmpDir = path.join(os.tmpdir(), 'spt_downloads')
  fs.mkdirSync(tmpDir, { recursive: true })
  const dest = path.join(tmpDir, filename)

  const normalizedUrl = normalizeDownloadUrl(url)

  async function doDownload(dlUrl, redirectCount = 0) {
    if (redirectCount > 10) throw new Error('Too many redirects')
    return new Promise((resolve, reject) => {
      const request = net.request({ url: dlUrl, redirect: 'manual' })
      request.setHeader('Authorization', `Bearer ${token}`)
      request.setHeader('Accept', '*/*')
      request.setHeader('User-Agent', 'Mozilla/5.0')

      request.on('redirect', (statusCode, method, redirectUrl) => {
        request.abort()
        doDownload(redirectUrl, redirectCount + 1).then(resolve).catch(reject)
      })

      request.on('response', (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const next = response.headers.location[0]
          doDownload(next, redirectCount + 1).then(resolve).catch(reject)
          return
        }
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }
        const total = parseInt(response.headers['content-length']?.[0] || '0')
        let received = 0
        const file = fs.createWriteStream(dest)
        response.on('data', chunk => {
          received += chunk.length
          win.webContents.send('forge:downloadProgress', { filename, received, total })
          file.write(chunk)
        })
        response.on('end', () => file.close(() => resolve(dest)))
        response.on('error', reject)
      })

      request.on('error', reject)
      request.end()
    })
  }

  await doDownload(normalizedUrl)
  return dest
})
