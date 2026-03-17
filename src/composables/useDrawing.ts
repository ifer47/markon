import { ref, reactive, type Ref } from 'vue'

export type Tool = 'pen' | 'highlighter' | 'arrow' | 'rect' | 'ellipse' | 'line' | 'eraser'

export interface Point {
  x: number
  y: number
}

export interface DrawAction {
  tool: Tool
  color: string
  lineWidth: number
  opacity: number
  points: Point[]
}

export function useDrawing(canvasRef: Ref<HTMLCanvasElement | null>) {
  const currentTool = ref<Tool>('pen')
  const currentColor = ref('#FF0000')
  const lineWidth = ref(3)
  const isDrawing = ref(false)
  const history = reactive<DrawAction[]>([])
  const redoStack = reactive<DrawAction[]>([])
  const currentAction = ref<DrawAction | null>(null)

  function getCtx(): CanvasRenderingContext2D | null {
    return canvasRef.value?.getContext('2d') ?? null
  }

  function startDraw(point: Point) {
    isDrawing.value = true
    redoStack.length = 0

    const opacity = currentTool.value === 'highlighter' ? 0.35 : 1
    const width = currentTool.value === 'highlighter' ? 20 :
                  currentTool.value === 'eraser' ? 25 : lineWidth.value

    currentAction.value = {
      tool: currentTool.value,
      color: currentTool.value === 'eraser' ? 'rgba(0,0,0,1)' : currentColor.value,
      lineWidth: width,
      opacity,
      points: [point],
    }
  }

  function draw(point: Point) {
    if (!isDrawing.value || !currentAction.value) return

    currentAction.value.points.push(point)
    redrawAll()
    drawAction(currentAction.value, true)
  }

  function endDraw() {
    if (!isDrawing.value || !currentAction.value) return
    isDrawing.value = false
    history.push(currentAction.value)
    currentAction.value = null
    redrawAll()
  }

  function drawAction(action: DrawAction, isPreview = false) {
    const ctx = getCtx()
    if (!ctx) return

    ctx.save()
    ctx.globalAlpha = action.opacity

    if (action.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1
    } else {
      ctx.globalCompositeOperation = 'source-over'
    }

    ctx.strokeStyle = action.color
    ctx.fillStyle = action.color
    ctx.lineWidth = action.lineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const pts = action.points
    if (pts.length < 2) {
      ctx.beginPath()
      ctx.arc(pts[0].x, pts[0].y, action.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }

    switch (action.tool) {
      case 'pen':
      case 'highlighter':
      case 'eraser':
        drawFreehand(ctx, pts)
        break
      case 'line':
        drawLine(ctx, pts[0], pts[pts.length - 1])
        break
      case 'arrow':
        drawArrow(ctx, pts[0], pts[pts.length - 1])
        break
      case 'rect':
        drawRect(ctx, pts[0], pts[pts.length - 1])
        break
      case 'ellipse':
        drawEllipse(ctx, pts[0], pts[pts.length - 1])
        break
    }

    ctx.restore()
  }

  function drawFreehand(ctx: CanvasRenderingContext2D, points: Point[]) {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)

    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y)
    } else {
      for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) / 2
        const midY = (points[i].y + points[i + 1].y) / 2
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY)
      }
      const last = points[points.length - 1]
      ctx.lineTo(last.x, last.y)
    }
    ctx.stroke()
  }

  function drawLine(ctx: CanvasRenderingContext2D, start: Point, end: Point) {
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
  }

  function drawArrow(ctx: CanvasRenderingContext2D, start: Point, end: Point) {
    const headLen = Math.max(15, ctx.lineWidth * 4)
    const angle = Math.atan2(end.y - start.y, end.x - start.x)

    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(
      end.x - headLen * Math.cos(angle - Math.PI / 6),
      end.y - headLen * Math.sin(angle - Math.PI / 6)
    )
    ctx.lineTo(
      end.x - headLen * Math.cos(angle + Math.PI / 6),
      end.y - headLen * Math.sin(angle + Math.PI / 6)
    )
    ctx.closePath()
    ctx.fill()
  }

  function drawRect(ctx: CanvasRenderingContext2D, start: Point, end: Point) {
    ctx.beginPath()
    ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y)
    ctx.stroke()
  }

  function drawEllipse(ctx: CanvasRenderingContext2D, start: Point, end: Point) {
    const cx = (start.x + end.x) / 2
    const cy = (start.y + end.y) / 2
    const rx = Math.abs(end.x - start.x) / 2
    const ry = Math.abs(end.y - start.y) / 2

    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  function redrawAll() {
    const ctx = getCtx()
    const canvas = canvasRef.value
    if (!ctx || !canvas) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const action of history) {
      drawAction(action)
    }
  }

  function undo() {
    if (history.length === 0) return
    const last = history.pop()!
    redoStack.push(last)
    redrawAll()
  }

  function redo() {
    if (redoStack.length === 0) return
    const action = redoStack.pop()!
    history.push(action)
    redrawAll()
  }

  function clearAll() {
    history.length = 0
    redoStack.length = 0
    const ctx = getCtx()
    const canvas = canvasRef.value
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  return {
    currentTool,
    currentColor,
    lineWidth,
    isDrawing,
    history,
    startDraw,
    draw,
    endDraw,
    undo,
    redo,
    clearAll,
    redrawAll,
  }
}
