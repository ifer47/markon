export type Tool = 'pen' | 'highlighter' | 'arrow' | 'rect' | 'ellipse' | 'line' | 'eraser' | 'text'

export interface Point {
  x: number
  y: number
}

export interface InputPointLike {
  x?: number
  y?: number
  clientX?: number
  clientY?: number
}

export interface DrawAction {
  tool: Tool
  color: string
  lineWidth: number
  opacity: number
  points: Point[]
  attachedErasers?: DrawAction[]
  text?: string
  fontSize?: number
  textWidth?: number
  bbox?: { x1: number, y1: number, x2: number, y2: number }
  rectHit?: { x0: number, y0: number, x1: number, y1: number }
  ellipseHit?: { cx: number, cy: number, rx: number, ry: number }
}
