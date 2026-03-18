export interface AppConfig {
  shortcuts: {
    toggleDrawing: string
    clearDrawing: string
  }
}

export interface ElectronAPI {
  onToggleDrawing: (callback: (active: boolean) => void) => void
  onClearDrawing: (callback: () => void) => void
  exitDrawing: () => void
  setIgnoreMouse: (ignore: boolean) => void
  getConfig: () => Promise<AppConfig>
  saveShortcuts: (shortcuts: AppConfig['shortcuts']) => Promise<{ ok: boolean; failed?: string[] }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
