export interface AppConfig {
  shortcuts: {
    toggleDrawing: string
    clearDrawing: string
  }
}

export interface SaveResult {
  ok: boolean
  failed?: string[]
}
