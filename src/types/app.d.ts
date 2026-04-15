export interface AppConfig {
  shortcuts: {
    toggleDrawing: string
    clearDrawing: string
  }
  general: {
    enableDragging: boolean
    locale?: string
  }
}

export interface SaveResult {
  ok: boolean
  failed?: string[]
}
