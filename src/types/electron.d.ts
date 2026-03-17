export interface ElectronAPI {
  onToggleDrawing: (callback: (active: boolean) => void) => void
  onClearDrawing: (callback: () => void) => void
  exitDrawing: () => void
  setIgnoreMouse: (ignore: boolean) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
