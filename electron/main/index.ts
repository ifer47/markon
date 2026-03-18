import { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ── Config ──

interface AppConfig {
  shortcuts: {
    toggleDrawing: string
    clearDrawing: string
  }
}

const DEFAULT_CONFIG: AppConfig = {
  shortcuts: {
    toggleDrawing: 'Ctrl+Shift+D',
    clearDrawing: 'Ctrl+Shift+C',
  },
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

function loadConfig(): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))
    return { shortcuts: { ...DEFAULT_CONFIG.shortcuts, ...raw?.shortcuts } }
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  }
}

function saveConfig(cfg: AppConfig): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2))
}

let config: AppConfig

// ── State ──

let overlayWin: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let tray: Tray | null = null
let isDrawing = false

const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.size

  overlayWin = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: true,
    hasShadow: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  overlayWin.setAlwaysOnTop(true, 'screen-saver')
  overlayWin.setVisibleOnAllWorkspaces(true)

  if (VITE_DEV_SERVER_URL) {
    overlayWin.loadURL(VITE_DEV_SERVER_URL)
  } else {
    overlayWin.loadFile(indexHtml)
  }

  overlayWin.setIgnoreMouseEvents(true)
  overlayWin.hide()

  let keyboardBlur = false
  overlayWin.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Meta' || input.key === 'Alt')) {
      keyboardBlur = true
      setTimeout(() => { keyboardBlur = false }, 500)
    }
  })

  overlayWin.on('blur', () => {
    if (isDrawing && keyboardBlur) {
      keyboardBlur = false
      toggleDrawing()
    }
  })

  overlayWin.on('closed', () => {
    overlayWin = null
  })
}

function toggleDrawing() {
  if (!overlayWin) return

  isDrawing = !isDrawing

  if (isDrawing) {
    const { bounds } = screen.getPrimaryDisplay()
    overlayWin.setBounds(bounds)
    overlayWin.webContents.send('clear-drawing')
    overlayWin.show()
    overlayWin.setIgnoreMouseEvents(false)
    overlayWin.setAlwaysOnTop(true, 'screen-saver')
    overlayWin.focus()
    overlayWin.webContents.send('toggle-drawing', true)
  } else {
    overlayWin.setIgnoreMouseEvents(true)
    overlayWin.webContents.send('toggle-drawing', false)
    overlayWin.hide()
  }
}

function clearDrawing() {
  if (!overlayWin) return
  overlayWin.webContents.send('clear-drawing')
}

function createTray() {
  const iconPath = path.join(process.env.VITE_PUBLIC, 'icon.png')
  let trayIcon: nativeImage
  try {
    trayIcon = nativeImage.createFromPath(iconPath)
  } catch {
    trayIcon = nativeImage.createEmpty()
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('MarkOn - 屏幕标注工具')
  tray.on('click', () => toggleDrawing())
  rebuildTrayMenu()
}

function rebuildTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '设置', click: () => openSettings() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]))
}

// ── Settings window ──

function openSettings() {
  if (settingsWin) {
    settingsWin.focus()
    return
  }

  const iconPath = path.join(process.env.VITE_PUBLIC, 'icon.png')

  settingsWin = new BrowserWindow({
    width: 600,
    height: 450,
    minWidth: 500,
    minHeight: 380,
    title: 'MarkOn 设置',
    icon: iconPath,
    backgroundColor: '#1e1e20',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  settingsWin.setMenuBarVisibility(false)

  if (VITE_DEV_SERVER_URL) {
    settingsWin.loadURL(`${VITE_DEV_SERVER_URL}#settings`)
  } else {
    settingsWin.loadFile(indexHtml, { hash: 'settings' })
  }

  settingsWin.on('closed', () => { settingsWin = null })
}

function registerShortcuts() {
  globalShortcut.unregisterAll()

  const failed: string[] = []

  if (!globalShortcut.register(config.shortcuts.toggleDrawing, toggleDrawing))
    failed.push(`开始标注: ${config.shortcuts.toggleDrawing}`)

  if (!globalShortcut.register(config.shortcuts.clearDrawing, clearDrawing))
    failed.push(`清除标注: ${config.shortcuts.clearDrawing}`)

  if (failed.length > 0 && tray) {
    tray.displayBalloon({
      iconType: 'warning',
      title: 'MarkOn - 快捷键注册失败',
      content: `以下快捷键可能被其他应用占用：\n${failed.join('\n')}\n\n右键托盘图标 → 设置快捷键`,
    })
  }
}

app.whenReady().then(() => {
  config = loadConfig()
  createOverlayWindow()
  createTray()
  registerShortcuts()
})

app.on('window-all-closed', (e: Electron.Event) => {
  e.preventDefault()
})

app.on('second-instance', () => {
  if (overlayWin) {
    if (isDrawing) {
      overlayWin.focus()
    }
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

ipcMain.handle('get-config', () => {
  return config
})

ipcMain.handle('save-shortcuts', (_event, shortcuts: AppConfig['shortcuts']) => {
  const failed: string[] = []
  globalShortcut.unregisterAll()

  const actions: Array<{ key: keyof AppConfig['shortcuts']; label: string; cb: () => void }> = [
    { key: 'toggleDrawing', label: '开始标注', cb: toggleDrawing },
    { key: 'clearDrawing', label: '清除标注', cb: clearDrawing },
  ]

  for (const { key, label, cb } of actions) {
    const accel = shortcuts[key]
    if (!globalShortcut.register(accel, cb)) {
      failed.push(`${label}: ${accel}`)
    }
  }

  if (failed.length > 0) {
    globalShortcut.unregisterAll()
    for (const { key, cb } of actions) {
      globalShortcut.register(config.shortcuts[key], cb)
    }
    return { ok: false, failed }
  }

  config.shortcuts = { ...shortcuts }
  saveConfig(config)
  return { ok: true }
})

ipcMain.on('exit-drawing', () => {
  if (isDrawing) {
    toggleDrawing()
  }
})

ipcMain.on('set-ignore-mouse', (_event, ignore: boolean) => {
  if (overlayWin) {
    overlayWin.setIgnoreMouseEvents(ignore)
  }
})
