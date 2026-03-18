import { ref, shallowRef, type Ref } from 'vue'

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
  textWidth?: number
  bbox?: { x1: number, y1: number, x2: number, y2: number }
}

const MIN_DIST_SQ = 4

export function useDrawing(canvasRef: Ref<HTMLCanvasElement | null>) {
  const currentTool = ref<Tool>('pen')
  const currentColor = ref('#FF0000')
  const lineWidth = ref(3)
  const isDrawing = ref(false)
  const history: DrawAction[] = []
  const redoStack: DrawAction[] = []
  const currentAction = shallowRef<DrawAction | null>(null)
  const previewAction = shallowRef<DrawAction | null>(null)

  let cacheCanvas: HTMLCanvasElement | null = null
  let cacheCtx: CanvasRenderingContext2D | null = null
  let cacheValid = false
  let rafId: number | null = null

  // Incremental stroke cache for freehand drawing
  let strokeCanvas: HTMLCanvasElement | null = null
  let strokeCtx: CanvasRenderingContext2D | null = null
  let lastBakedPtIdx = 0

  function getCtx(): CanvasRenderingContext2D | null {
    return canvasRef.value?.getContext('2d') ?? null
  }

  function computeBbox(action: DrawAction, pad: number): DrawAction['bbox'] {
    const pts = action.points
    if (pts.length === 0) return undefined
    let x1 = pts[0].x, y1 = pts[0].y, x2 = pts[0].x, y2 = pts[0].y
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].x < x1) x1 = pts[i].x
      if (pts[i].y < y1) y1 = pts[i].y
      if (pts[i].x > x2) x2 = pts[i].x
      if (pts[i].y > y2) y2 = pts[i].y
    }
    return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad }
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
      for (let i = 0; i < history.length; i++) {
        if (history[i] === previewAction.value) continue
        drawActionOn(cacheCtx, history[i])
      }
      cacheValid = true
    }
  }

  function invalidateCache() {
    cacheValid = false
  }

  function initStrokeCanvas() {
    const canvas = canvasRef.value
    if (!canvas) return
    if (!strokeCanvas) strokeCanvas = document.createElement('canvas')
    strokeCanvas.width = canvas.width
    strokeCanvas.height = canvas.height
    strokeCtx = strokeCanvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    if (strokeCtx) strokeCtx.scale(dpr, dpr)
    lastBakedPtIdx = 0
  }

  function clearStrokeCanvas() {
    if (strokeCtx && strokeCanvas) {
      strokeCtx.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height)
    }
    lastBakedPtIdx = 0
  }

  // Bake finalized segments of the current freehand stroke incrementally.
  // Segments up to pts.length-3 are "settled" (their shape won't change).
  function bakeIncrementalStroke(action: DrawAction) {
    if (!strokeCtx) return
    const pts = action.points
    const targetIdx = pts.length - 3
    if (targetIdx <= lastBakedPtIdx || targetIdx < 1) return

    strokeCtx.save()
    if (action.tool === 'eraser') {
      strokeCtx.globalCompositeOperation = 'destination-out'
      strokeCtx.globalAlpha = 1
    } else {
      strokeCtx.globalCompositeOperation = 'source-over'
      strokeCtx.globalAlpha = action.opacity
    }
    strokeCtx.strokeStyle = action.color
    strokeCtx.lineWidth = action.lineWidth
    strokeCtx.lineCap = 'round'
    strokeCtx.lineJoin = 'round'

    strokeCtx.beginPath()

    if (lastBakedPtIdx === 0) {
      strokeCtx.moveTo(pts[0].x, pts[0].y)
      // Draw from the first point using quadratic bezier
      for (let i = 1; i <= targetIdx; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2
        const midY = (pts[i].y + pts[i + 1].y) / 2
        strokeCtx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)
      }
    } else {
      // Resume from the last baked midpoint
      const mX = (pts[lastBakedPtIdx].x + pts[lastBakedPtIdx + 1].x) / 2
      const mY = (pts[lastBakedPtIdx].y + pts[lastBakedPtIdx + 1].y) / 2
      strokeCtx.moveTo(mX, mY)
      for (let i = lastBakedPtIdx + 1; i <= targetIdx; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2
        const midY = (pts[i].y + pts[i + 1].y) / 2
        strokeCtx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)
      }
    }

    strokeCtx.stroke()
    strokeCtx.restore()
    lastBakedPtIdx = targetIdx
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

    const action = currentAction.value
    if (action) {
      const isFreehand = action.tool === 'pen' || action.tool === 'highlighter' || action.tool === 'eraser'
      if (isFreehand && strokeCanvas && action.points.length > 3) {
        // Composite the pre-baked stroke layer
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(strokeCanvas, 0, 0)
        ctx.restore()
        // Draw only the unsettled tail (last 3 points)
        drawFreehandTail(ctx, action)
      } else {
        drawActionOn(ctx, action)
      }
    }

    const preview = previewAction.value
    if (preview) {
      drawActionOn(ctx, preview)
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

    // Cache text width and bbox to avoid measuring in findActionAt
    const ctx = getCtx()
    if (ctx) {
      ctx.font = `${fontSize}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
      const lines = text.split('\n')
      let maxWidth = 0
      for (const line of lines) {
        const w = ctx.measureText(line).width
        if (w > maxWidth) maxWidth = w
      }
      action.textWidth = maxWidth
      const lh = Math.round(fontSize * 1.3)
      action.bbox = {
        x1: x - 10, y1: y - lh / 2 - 10,
        x2: x + maxWidth + 20, y2: y + lines.length * lh + lh / 2 + 10,
      }
    }

    redoStack.length = 0
    ensureCache()
    if (cacheCtx) drawActionOn(cacheCtx, action)
    history.push(action)
    flushRender()
  }

  function startDraw(point: Point) {
    if (currentTool.value === 'text') return
    isDrawing.value = true
    redoStack.length = 0

    const isFreehand = currentTool.value === 'pen' || currentTool.value === 'highlighter' || currentTool.value === 'eraser'
    if (isFreehand) initStrokeCanvas()

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

  function draw(point: Point, isPerfect = false) {
    if (!isDrawing.value) return
    const action = currentAction.value
    if (!action) return

    const pts = action.points
    const isFreehand = action.tool === 'pen' || action.tool === 'highlighter' || action.tool === 'eraser'

    if (isFreehand) {
      const last = pts[pts.length - 1]
      const dx = point.x - last.x
      const dy = point.y - last.y
      if (dx * dx + dy * dy < MIN_DIST_SQ) return
      pts.push(point)
      bakeIncrementalStroke(action)
    } else {
      let finalPoint = point
      if (isPerfect && pts.length > 0 && (action.tool === 'rect' || action.tool === 'ellipse')) {
        const start = pts[0]
        const dx = point.x - start.x
        const dy = point.y - start.y
        const maxDist = Math.max(Math.abs(dx), Math.abs(dy))
        finalPoint = {
          x: start.x + (dx < 0 ? -maxDist : maxDist),
          y: start.y + (dy < 0 ? -maxDist : maxDist)
        }
      }

      if (pts.length === 1) {
        pts.push(finalPoint)
      } else {
        pts[1] = finalPoint
      }
    }

    scheduleRender()
  }

  function endDraw() {
    if (!isDrawing.value) return
    const action = currentAction.value
    if (!action) return
    isDrawing.value = false

    const pad = Math.max(20, action.lineWidth / 2 + 10)
    action.bbox = computeBbox(action, pad)

    clearStrokeCanvas()

    ensureCache()
    if (cacheCtx) drawActionOn(cacheCtx, action)
    history.push(action)

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
      ctx.textBaseline = 'alphabetic'
      const lines = (action.text ?? '').split('\n')
      const x = action.points[0].x + 2
      const lh = Math.round(fs * 1.3)
      const baselineOffsetY = fs * 0.398
      for (let i = 0; i < lines.length; i++) {
        const lineCenterY = action.points[0].y + i * lh
        ctx.fillText(lines[i], x, lineCenterY + baselineOffsetY)
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
        drawLine(ctx, pts[0], pts[1])
        break
      case 'arrow':
        drawArrow(ctx, pts[0], pts[1])
        break
      case 'rect':
        drawRect(ctx, pts[0], pts[1])
        break
      case 'ellipse':
        drawEllipse(ctx, pts[0], pts[1])
        break
    }

    ctx.restore()
  }

  // Draws only the unsettled tail of a freehand stroke (last 3 points from baked index)
  function drawFreehandTail(ctx: CanvasRenderingContext2D, action: DrawAction) {
    const pts = action.points
    if (pts.length < 2) return

    ctx.save()
    if (action.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = action.opacity
    }
    ctx.strokeStyle = action.color
    ctx.lineWidth = action.lineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()
    if (lastBakedPtIdx === 0) {
      ctx.moveTo(pts[0].x, pts[0].y)
    } else {
      const mX = (pts[lastBakedPtIdx].x + pts[lastBakedPtIdx + 1].x) / 2
      const mY = (pts[lastBakedPtIdx].y + pts[lastBakedPtIdx + 1].y) / 2
      ctx.moveTo(mX, mY)
    }

    const start = Math.max(1, lastBakedPtIdx + 1)
    for (let i = start; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2
      const midY = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last.x, last.y)

    ctx.stroke()
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

  function requestRedraw() {
    invalidateCache()
    scheduleRender()
  }

  function beginDrag(action: DrawAction) {
    previewAction.value = action
    invalidateCache()
    scheduleRender()
  }

  function endDrag() {
    if (previewAction.value) {
      const action = previewAction.value
      const pad = Math.max(20, action.lineWidth / 2 + 10)
      if (action.tool === 'text' && action.textWidth != null) {
        const fs = action.fontSize ?? 24
        const lh = Math.round(fs * 1.3)
        const lines = (action.text ?? '').split('\n')
        const x = action.points[0].x
        const y = action.points[0].y
        action.bbox = {
          x1: x - 10, y1: y - lh / 2 - 10,
          x2: x + action.textWidth + 20, y2: y + lines.length * lh + lh / 2 + 10,
        }
      } else {
        action.bbox = computeBbox(action, pad)
      }

      // 移到 history 末尾，使其层级最高
      const idx = history.indexOf(action)
      if (idx !== -1 && idx !== history.length - 1) {
        history.splice(idx, 1)
        history.push(action)
      }
    }
    previewAction.value = null
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

  function distancePointToSegment(p: Point, a: Point, b: Point): number {
    const l2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)))
  }

  function findActionAt(p: Point): { action: DrawAction, index: number } | null {
    for (let i = history.length - 1; i >= 0; i--) {
      const action = history[i]
      const pts = action.points
      if (pts.length === 0) continue

      // Fast AABB pre-filter — skip actions whose bounding box doesn't contain the point
      const bbox = action.bbox
      if (bbox && (p.x < bbox.x1 || p.x > bbox.x2 || p.y < bbox.y1 || p.y > bbox.y2)) continue

      const threshold = Math.max(10, (action.lineWidth || 2) / 2 + 5)

      if (action.tool === 'text' && action.text) {
        const fs = action.fontSize ?? 24
        const lh = Math.round(fs * 1.3)
        const textWidth = action.textWidth ?? 200
        const lines = action.text.split('\n')
        const boxX = pts[0].x - 10
        const boxY = pts[0].y - lh / 2 - 10
        if (p.x >= boxX && p.x <= boxX + textWidth + 20 && p.y >= boxY && p.y <= boxY + lines.length * lh + 20) {
          return { action, index: i }
        }
        continue
      }

      if (action.tool === 'pen' || action.tool === 'highlighter' || action.tool === 'eraser') {
        if (pts.length === 1) {
          if (Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= threshold) return { action, index: i }
        } else {
          for (let j = 0; j < pts.length - 1; j++) {
            if (distancePointToSegment(p, pts[j], pts[j + 1]) <= threshold) return { action, index: i }
          }
        }
        continue
      }

      if (action.tool === 'line' || action.tool === 'arrow') {
        if (pts.length >= 2) {
          if (distancePointToSegment(p, pts[0], pts[1]) <= threshold) return { action, index: i }
        }
        continue
      }

      if (action.tool === 'rect') {
        if (pts.length >= 2) {
          const minX = Math.min(pts[0].x, pts[1].x)
          const maxX = Math.max(pts[0].x, pts[1].x)
          const minY = Math.min(pts[0].y, pts[1].y)
          const maxY = Math.max(pts[0].y, pts[1].y)

          const d1 = distancePointToSegment(p, {x: minX, y: minY}, {x: maxX, y: minY})
          const d2 = distancePointToSegment(p, {x: maxX, y: minY}, {x: maxX, y: maxY})
          const d3 = distancePointToSegment(p, {x: maxX, y: maxY}, {x: minX, y: maxY})
          const d4 = distancePointToSegment(p, {x: minX, y: maxY}, {x: minX, y: minY})

          if (Math.min(d1, d2, d3, d4) <= threshold) return { action, index: i }
        }
        continue
      }

      if (action.tool === 'ellipse') {
        if (pts.length >= 2) {
          const cx = (pts[0].x + pts[1].x) / 2
          const cy = (pts[0].y + pts[1].y) / 2
          const rx = Math.abs(pts[1].x - pts[0].x) / 2
          const ry = Math.abs(pts[1].y - pts[0].y) / 2

          if (rx < 1 || ry < 1) {
            if (Math.hypot(p.x - cx, p.y - cy) <= threshold) return { action, index: i }
            continue
          }

          if (p.x < cx - rx - threshold || p.x > cx + rx + threshold ||
              p.y < cy - ry - threshold || p.y > cy + ry + threshold) continue

          let minDist = Infinity
          for (let j = 0; j < 32; j++) {
            const angle = (j / 32) * Math.PI * 2
            const px = cx + rx * Math.cos(angle)
            const py = cy + ry * Math.sin(angle)
            const dist = Math.hypot(p.x - px, p.y - py)
            if (dist < minDist) minDist = dist
          }
          if (minDist <= threshold) return { action, index: i }
        }
        continue
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
    strokeCanvas = null
    strokeCtx = null
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
    findActionAt,
    removeAction,
    addTextAction,
    undo,
    redo,
    clearAll,
    redrawAll,
    requestRedraw,
    scheduleRender,
    beginDrag,
    endDrag,
    destroy,
  }
}
