import { ref, reactive, type Ref } from 'vue'

export type Tool = 'pen' | 'highlighter' | 'arrow' | 'rect' | 'ellipse' | 'line' | 'eraser' | 'text'

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
  text?: string
  fontSize?: number
}

const MIN_DIST_SQ = 4

export function useDrawing(canvasRef: Ref<HTMLCanvasElement | null>) {
  const currentTool = ref<Tool>('pen')
  const currentColor = ref('#FF0000')
  const lineWidth = ref(3)
  const isDrawing = ref(false)
  const history = reactive<DrawAction[]>([])
  const redoStack = reactive<DrawAction[]>([])
  const currentAction = ref<DrawAction | null>(null)

  let cacheCanvas: HTMLCanvasElement | null = null
  let cacheCtx: CanvasRenderingContext2D | null = null
  let cacheValid = false
  let rafId: number | null = null

  function getCtx(): CanvasRenderingContext2D | null {
    return canvasRef.value?.getContext('2d') ?? null
  }

  function ensureCache() {
    const canvas = canvasRef.value
    if (!canvas) return

    if (!cacheCanvas) {
      cacheCanvas = document.createElement('canvas')
    }

    if (cacheCanvas.width !== canvas.width || cacheCanvas.height !== canvas.height) {
      cacheCanvas.width = canvas.width
      cacheCanvas.height = canvas.height
      cacheCtx = cacheCanvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      if (cacheCtx) cacheCtx.scale(dpr, dpr)
      cacheValid = false
    }

    if (!cacheValid && cacheCtx) {
      cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height)
      for (const action of history) {
        drawActionOn(cacheCtx, action)
      }
      cacheValid = true
    }
  }

  function invalidateCache() {
    cacheValid = false
  }

  function renderFrame() {
    const ctx = getCtx()
    const canvas = canvasRef.value
    if (!ctx || !canvas) return

    ensureCache()

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (cacheCanvas) {
      ctx.drawImage(cacheCanvas, 0, 0)
    }
    ctx.restore()

    if (currentAction.value) {
      drawActionOn(ctx, currentAction.value)
    }
  }

  function scheduleRender() {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      renderFrame()
    })
  }

  function flushRender() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    renderFrame()
  }

  function addTextAction(text: string, x: number, y: number, width: number, fontSize: number, color?: string) {
    const action: DrawAction = {
      tool: 'text',
      color: color ?? currentColor.value,
      lineWidth: lineWidth.value,
      opacity: 1,
      points: [{ x, y }],
      text,
      fontSize,
    }
    history.push(action)
    redoStack.length = 0

    ensureCache()
    if (cacheCtx) drawActionOn(cacheCtx, action)
    flushRender()
  }

  function startDraw(point: Point) {
    if (currentTool.value === 'text') return
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

    const action = currentAction.value
    const isFreehand = action.tool === 'pen' || action.tool === 'highlighter' || action.tool === 'eraser'

    if (isFreehand && action.points.length > 0) {
      const last = action.points[action.points.length - 1]
      const dx = point.x - last.x
      const dy = point.y - last.y
      if (dx * dx + dy * dy < MIN_DIST_SQ) return
    }

    action.points.push(point)
    scheduleRender()
  }

  function endDraw() {
    if (!isDrawing.value || !currentAction.value) return
    isDrawing.value = false

    history.push(currentAction.value)

    ensureCache()
    if (cacheCtx) drawActionOn(cacheCtx, currentAction.value)

    currentAction.value = null
    flushRender()
  }

  function drawActionOn(ctx: CanvasRenderingContext2D, action: DrawAction) {
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

    if (action.tool === 'text') {
      const fs = action.fontSize ?? 24
      ctx.font = `${fs}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
      ctx.globalAlpha = 1
      ctx.fillStyle = action.color
      ctx.textBaseline = 'top'
      const lines = (action.text ?? '').split('\n')
      // HTML textarea 的 padding 为 0 2px，所以 x 偏移 2px
      const x = action.points[0].x + 2
      // DOM 中 textarea 的 top 为 y - fs * 1.3 / 2 = y - fs * 0.65
      // 文本在 1.3 行高中垂直居中，理论顶部是 y - fs * 0.5。
      // 对于中文字体（如微软雅黑），字体的实际渲染基线比理论居中位置更靠下。
      // 经过比例换算，补偿值约为字号的 10%~12%，这里使用 fs * 0.12 向下补偿，确保 Canvas 渲染不往上跳。
      const startY = action.points[0].y - fs * 0.5 + fs * 0.12
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, startY + i * fs * 1.3)
      }
      ctx.restore()
      return
    }

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
    invalidateCache()
    flushRender()
  }

  function undo() {
    if (history.length === 0) return
    const last = history.pop()!
    redoStack.push(last)
    invalidateCache()
    flushRender()
  }

  function redo() {
    if (redoStack.length === 0) return
    const action = redoStack.pop()!
    history.push(action)
    invalidateCache()
    flushRender()
  }

  function clearAll() {
    history.length = 0
    redoStack.length = 0
    invalidateCache()
    const ctx = getCtx()
    const canvas = canvasRef.value
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  function findTextAt(p: Point): { action: DrawAction, index: number } | null {
    const ctx = getCtx()
    if (!ctx) return null
    for (let i = history.length - 1; i >= 0; i--) {
      const action = history[i]
      if (action.tool === 'text' && action.text) {
        const fs = action.fontSize ?? 24
        ctx.font = `${fs}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
        const lines = action.text.split('\n')
        let maxWidth = 0
        for (const line of lines) {
          const w = ctx.measureText(line).width
          if (w > maxWidth) maxWidth = w
        }
        const h = lines.length * fs * 1.3
        const boxX = action.points[0].x - 10
        const boxY = action.points[0].y - fs * 0.65 - 10
        if (p.x >= boxX && p.x <= boxX + maxWidth + 20 && p.y >= boxY && p.y <= boxY + h + 20) {
          return { action, index: i }
        }
      }
    }
    return null
  }

  function removeAction(index: number) {
    if (index >= 0 && index < history.length) {
      history.splice(index, 1)
      invalidateCache()
      flushRender()
    }
  }

  function destroy() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    cacheCanvas = null
    cacheCtx = null
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
    findTextAt,
    removeAction,
    addTextAction,
    undo,
    redo,
    clearAll,
    redrawAll,
    destroy,
  }
}
