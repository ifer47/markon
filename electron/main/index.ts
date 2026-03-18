import { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
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

let overlayWin: BrowserWindow | null = null
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
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '开始标注 (Ctrl+Shift+D)',
      click: () => toggleDrawing(),
    },
    {
      label: '清除标注 (Ctrl+Shift+C)',
      click: () => clearDrawing(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      },
    },
  ])

  tray.setToolTip('MarkOn - 屏幕标注工具')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => toggleDrawing())
}

function registerShortcuts() {
  globalShortcut.register('Ctrl+Shift+D', () => {
    toggleDrawing()
  })

  globalShortcut.register('Ctrl+Shift+C', () => {
    clearDrawing()
  })
}

app.whenReady().then(() => {
  createOverlayWindow()
  createTray()
  registerShortcuts()
})

app.on('window-all-closed', () => {
  overlayWin = null
  if (process.platform !== 'darwin') app.quit()
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
