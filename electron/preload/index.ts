import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  onToggleDrawing(callback: (active: boolean) => void) {
    ipcRenderer.on('toggle-drawing', (_event, active: boolean) => callback(active))
  },
  onClearDrawing(callback: () => void) {
    ipcRenderer.on('clear-drawing', () => callback())
  },
  exitDrawing() {
    ipcRenderer.send('exit-drawing')
  },
  setIgnoreMouse(ignore: boolean) {
    ipcRenderer.send('set-ignore-mouse', ignore)
  },
})

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})
