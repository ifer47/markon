import { ref, shallowRef, type Ref } from 'vue'

export type Tool = 'pen' | 'highlighter' | 'arrow' | 'rect' | 'ellipse' | 'line' | 'eraser' | 'text'

export interface Point {
  x: number
  y: number
}

interface InputPointLike {
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

const HIT_GRID_SIZE = 192

// Adaptive point sampling: large CSS viewports (e.g. 4K@150%) generate far more
// pointer events per physical pen-movement than small ones (e.g. 2880×1800@200%).
// Scale the minimum squared-distance threshold proportionally so the point density
// stays consistent regardless of viewport size.
const BASE_VIEWPORT_AREA = 1440 * 900
const BASE_MIN_DIST_SQ = 4
let cachedMinDistSq = BASE_MIN_DIST_SQ
let cachedViewportArea = 0

function getMinDistSq(): number {
  const area = window.innerWidth * window.innerHeight
  if (area !== cachedViewportArea) {
    cachedViewportArea = area
    const scale = area / BASE_VIEWPORT_AREA
    cachedMinDistSq = scale > 1.5
      ? Math.round(BASE_MIN_DIST_SQ * Math.min(scale, 4))
      : BASE_MIN_DIST_SQ
  }
  return cachedMinDistSq
}

export function useDrawing(canvasRef: Ref<HTMLCanvasElement | null>) {
  const currentTool = ref<Tool>('pen')
  const currentColor = ref('#FF0000')
  const lineWidth = ref(3)
  const isDrawing = ref(false)

  interface DragSnapshot {
    points: Point[]
    index: number
    attachedErasers: DrawAction['attachedErasers']
    bbox: DrawAction['bbox']
    rectHit: DrawAction['rectHit']
    ellipseHit: DrawAction['ellipseHit']
  }

  type UndoEntry =
    | { type: 'add', action: DrawAction }
    | { type: 'remove', action: DrawAction, index: number }
    | { type: 'drag', action: DrawAction, from: DragSnapshot, to: DragSnapshot }
    | { type: 'erase', targets: { action: DrawAction, before: DrawAction['attachedErasers'], after: DrawAction['attachedErasers'] }[] }
    | { type: 'clear', actions: DrawAction[], prevUndoStack: UndoEntry[] }

  function takeDragSnapshot(action: DrawAction, index: number): DragSnapshot {
    return {
      points: action.points.map(p => ({ x: p.x, y: p.y })),
      index,
      attachedErasers: action.attachedErasers ? [...action.attachedErasers] : undefined,
      bbox: action.bbox ? { ...action.bbox } : undefined,
      rectHit: action.rectHit ? { ...action.rectHit } : undefined,
      ellipseHit: action.ellipseHit ? { ...action.ellipseHit } : undefined,
    }
  }

  function restoreDragSnapshot(action: DrawAction, snap: DragSnapshot) {
    action.points = snap.points.map(p => ({ x: p.x, y: p.y }))
    action.attachedErasers = snap.attachedErasers ? [...snap.attachedErasers] : undefined
    action.bbox = snap.bbox ? { ...snap.bbox } : undefined
    action.rectHit = snap.rectHit ? { ...snap.rectHit } : undefined
    action.ellipseHit = snap.ellipseHit ? { ...snap.ellipseHit } : undefined
    pathCache.delete(action)
  }

  const history: DrawAction[] = []
  const undoStack: UndoEntry[] = []
  const redoStack: UndoEntry[] = []
  const currentAction = shallowRef<DrawAction | null>(null)
  const previewAction = shallowRef<DrawAction | null>(null)

  let cacheCanvas: HTMLCanvasElement | null = null
  let cacheCtx: CanvasRenderingContext2D | null = null
  let mainCtx: CanvasRenderingContext2D | null = null
  let cacheValid = false
  let rafId: number | null = null

  // Incremental stroke cache for pen only.
  let strokeCanvas: HTMLCanvasElement | null = null
  let strokeCtx: CanvasRenderingContext2D | null = null
  let lastBakedPtIdx = 0

  // Pre-rendered drag element canvas (avoids per-frame path reconstruction)
  let dragCanvas: HTMLCanvasElement | null = null
  let dragCtx: CanvasRenderingContext2D | null = null
  let dragOffsetX = 0
  let dragOffsetY = 0
  let dragBboxX = 0
  let dragBboxY = 0
  let useDragCanvas = false
  let tempCanvas: HTMLCanvasElement | null = null
  let tempCtx: CanvasRenderingContext2D | null = null
  let prevDragScreenX = NaN
  let prevDragScreenY = NaN
  let prevStrokeRect: { x: number, y: number, w: number, h: number } | null = null
  let prevShapeRect: { x: number, y: number, w: number, h: number } | null = null
  const pathCache = new WeakMap<DrawAction, Path2D>()

  // O(1) action→history-index lookup (replaces O(n) lastIndexOf in findActionAt).
  // Lazily rebuilt when splice operations invalidate it.
  const historyIndexMap = new WeakMap<DrawAction, number>()
  let historyIndexDirty = true

  function ensureHistoryIndex() {
    if (!historyIndexDirty) return
    for (let i = 0; i < history.length; i++) {
      historyIndexMap.set(history[i], i)
    }
    historyIndexDirty = false
  }

  function trackHistoryPush(action: DrawAction) {
    historyIndexMap.set(action, history.length - 1)
  }

  let hitGridDirty = true
  const hitGrid = new Map<string, DrawAction[]>()
  let hitGridOverflow: DrawAction[] = []
  const hitGridCells = new WeakMap<DrawAction, string[] | null>()
  const hitGridOrder = new WeakMap<DrawAction, number>()
  let nextHitGridOrder = 1

  // Effective DPR cached to avoid repeated parseFloat(canvas.style.width)
  // inside renderFrame (called 3-5× per frame). Invalidated automatically
  // when canvas.width changes (i.e. after resizeCanvas).
  let cachedDpr = 0
  let cachedDprCanvasW = 0

  function getEffectiveDpr(): number {
    const canvas = canvasRef.value
    if (!canvas) return window.devicePixelRatio || 1
    if (canvas.width === cachedDprCanvasW && cachedDpr > 0) return cachedDpr
    const cssW = parseFloat(canvas.style.width)
    cachedDpr = cssW > 0 ? canvas.width / cssW : (window.devicePixelRatio || 1)
    cachedDprCanvasW = canvas.width
    return cachedDpr
  }

  function getCtx(): CanvasRenderingContext2D | null {
    const canvas = canvasRef.value
    if (!canvas) {
      mainCtx = null
      return null
    }
    if (!mainCtx) {
      mainCtx = canvas.getContext('2d', { alpha: true, desynchronized: true })
    }
    return mainCtx
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

  function computePointsBbox(points: Point[], startIdx: number, endIdx: number, pad: number) {
    if (points.length === 0 || startIdx > endIdx) return null
    let x1 = points[startIdx].x
    let y1 = points[startIdx].y
    let x2 = x1
    let y2 = y1
    for (let i = startIdx + 1; i <= endIdx; i++) {
      if (points[i].x < x1) x1 = points[i].x
      if (points[i].y < y1) y1 = points[i].y
      if (points[i].x > x2) x2 = points[i].x
      if (points[i].y > y2) y2 = points[i].y
    }
    return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad }
  }

  function bboxesIntersect(
    a: NonNullable<DrawAction['bbox']>,
    b: NonNullable<DrawAction['bbox']>
  ) {
    return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1
  }

  function cloneActionWithOffset(action: DrawAction, dx: number, dy: number): DrawAction {
    return {
      ...action,
      points: action.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
      bbox: action.bbox
        ? {
            x1: action.bbox.x1 + dx,
            y1: action.bbox.y1 + dy,
            x2: action.bbox.x2 + dx,
            y2: action.bbox.y2 + dy,
          }
        : undefined,
      rectHit: action.rectHit
        ? {
            x0: action.rectHit.x0 + dx,
            y0: action.rectHit.y0 + dy,
            x1: action.rectHit.x1 + dx,
            y1: action.rectHit.y1 + dy,
          }
        : undefined,
      ellipseHit: action.ellipseHit
        ? {
            cx: action.ellipseHit.cx + dx,
            cy: action.ellipseHit.cy + dy,
            rx: action.ellipseHit.rx,
            ry: action.ellipseHit.ry,
          }
        : undefined,
      attachedErasers: action.attachedErasers?.map((ae) => cloneActionWithOffset(ae, dx, dy)),
    }
  }

  function offsetAttachedErasers(action: DrawAction, dx: number, dy: number) {
    if (!action.attachedErasers?.length) return
    for (let i = 0; i < action.attachedErasers.length; i++) {
      action.attachedErasers[i] = cloneActionWithOffset(action.attachedErasers[i], dx, dy)
    }
  }

  function updateShapeHitCache(action: DrawAction) {
    action.rectHit = undefined
    action.ellipseHit = undefined

    if (action.points.length < 2) return

    if (action.tool === 'rect') {
      action.rectHit = {
        x0: Math.min(action.points[0].x, action.points[1].x),
        y0: Math.min(action.points[0].y, action.points[1].y),
        x1: Math.max(action.points[0].x, action.points[1].x),
        y1: Math.max(action.points[0].y, action.points[1].y),
      }
      return
    }

    if (action.tool === 'ellipse') {
      action.ellipseHit = {
        cx: (action.points[0].x + action.points[1].x) / 2,
        cy: (action.points[0].y + action.points[1].y) / 2,
        rx: Math.abs(action.points[1].x - action.points[0].x) / 2,
        ry: Math.abs(action.points[1].y - action.points[0].y) / 2,
      }
    }
  }

  function clearHitGridState() {
    hitGrid.clear()
    hitGridOverflow = []
    nextHitGridOrder = 1
  }

  function getHitGridCells(action: DrawAction): string[] | null {
    const bbox = action.bbox
    if (!bbox) return null

    const startCellX = Math.floor(bbox.x1 / HIT_GRID_SIZE)
    const endCellX = Math.floor(bbox.x2 / HIT_GRID_SIZE)
    const startCellY = Math.floor(bbox.y1 / HIT_GRID_SIZE)
    const endCellY = Math.floor(bbox.y2 / HIT_GRID_SIZE)
    const cellCount = (endCellX - startCellX + 1) * (endCellY - startCellY + 1)

    if (cellCount > 64) return null

    const cells: string[] = []
    for (let cy = startCellY; cy <= endCellY; cy++) {
      for (let cx = startCellX; cx <= endCellX; cx++) {
        cells.push(`${cx},${cy}`)
      }
    }
    return cells
  }

  function removeActionRef(list: DrawAction[], action: DrawAction) {
    const idx = list.lastIndexOf(action)
    if (idx !== -1) list.splice(idx, 1)
  }

  function addActionToHitGrid(action: DrawAction, order = nextHitGridOrder++) {
    const cells = getHitGridCells(action)
    hitGridCells.set(action, cells)
    hitGridOrder.set(action, order)

    if (!cells) {
      hitGridOverflow.push(action)
      return
    }

    for (let i = 0; i < cells.length; i++) {
      const key = cells[i]
      let bucket = hitGrid.get(key)
      if (!bucket) {
        bucket = []
        hitGrid.set(key, bucket)
      }
      bucket.push(action)
    }
  }

  function removeActionFromHitGrid(action: DrawAction) {
    const cells = hitGridCells.get(action)
    if (cells === undefined) return

    if (cells === null) {
      removeActionRef(hitGridOverflow, action)
    } else {
      for (let i = 0; i < cells.length; i++) {
        const key = cells[i]
        const bucket = hitGrid.get(key)
        if (!bucket) continue
        removeActionRef(bucket, action)
        if (bucket.length === 0) hitGrid.delete(key)
      }
    }

    hitGridCells.delete(action)
    hitGridOrder.delete(action)
  }

  function appendActionToHitGrid(action: DrawAction) {
    if (hitGridDirty) return
    addActionToHitGrid(action)
  }

  function deleteActionFromHitGrid(action: DrawAction) {
    if (hitGridDirty) return
    removeActionFromHitGrid(action)
  }

  function refreshActionInHitGrid(action: DrawAction, moveToTop = false) {
    if (hitGridDirty) return
    const prevOrder = hitGridOrder.get(action)
    removeActionFromHitGrid(action)
    addActionToHitGrid(action, moveToTop || prevOrder == null ? nextHitGridOrder++ : prevOrder)
  }

  function ensureHitGrid() {
    if (!hitGridDirty) return

    clearHitGridState()

    for (let i = 0; i < history.length; i++) {
      addActionToHitGrid(history[i])
    }

    hitGridDirty = false
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
      const dpr = getEffectiveDpr()
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
    const dpr = getEffectiveDpr()
    if (strokeCtx) strokeCtx.scale(dpr, dpr)
    lastBakedPtIdx = 0
  }

  function clearStrokeCanvas() {
    if (strokeCtx && strokeCanvas) {
      strokeCtx.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height)
    }
    lastBakedPtIdx = 0
  }

  function bakeIncrementalStroke(action: DrawAction) {
    if (!strokeCtx) return
    const pts = action.points
    const targetIdx = pts.length - 3
    if (targetIdx <= lastBakedPtIdx || targetIdx < 1) return

    strokeCtx.save()
    strokeCtx.globalCompositeOperation = 'source-over'
    strokeCtx.globalAlpha = action.opacity
    strokeCtx.strokeStyle = action.color
    strokeCtx.lineWidth = action.lineWidth
    strokeCtx.lineCap = 'round'
    strokeCtx.lineJoin = 'round'

    strokeCtx.beginPath()

    if (lastBakedPtIdx === 0) {
      strokeCtx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i <= targetIdx; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2
        const midY = (pts[i].y + pts[i + 1].y) / 2
        strokeCtx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)
      }
    } else {
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

    const preview = previewAction.value

    if (preview && useDragCanvas && dragCanvas) {
      prevStrokeRect = null
      prevShapeRect = null
      ensureCache()

      const dpr = getEffectiveDpr()
      const newX = Math.round((dragBboxX + dragOffsetX) * dpr)
      const newY = Math.round((dragBboxY + dragOffsetY) * dpr)
      const dw = dragCanvas.width
      const dh = dragCanvas.height

      if (newX === prevDragScreenX && newY === prevDragScreenY) return

      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)

      if (!isNaN(prevDragScreenX)) {
        const ux = Math.max(0, Math.min(prevDragScreenX, newX))
        const uy = Math.max(0, Math.min(prevDragScreenY, newY))
        const ur = Math.min(canvas.width, Math.max(prevDragScreenX + dw, newX + dw))
        const ub = Math.min(canvas.height, Math.max(prevDragScreenY + dh, newY + dh))

        if (ur > ux && ub > uy) {
          const uw = ur - ux, uh = ub - uy
          ctx.clearRect(ux, uy, uw, uh)
          if (cacheCanvas) ctx.drawImage(cacheCanvas, ux, uy, uw, uh, ux, uy, uw, uh)
        }
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (cacheCanvas) ctx.drawImage(cacheCanvas, 0, 0)
      }

      ctx.drawImage(dragCanvas, newX, newY)
      ctx.restore()

      prevDragScreenX = newX
      prevDragScreenY = newY
      return
    }

    prevDragScreenX = NaN
    prevDragScreenY = NaN

    const action = currentAction.value
    const activeStrokeCanvas = strokeCanvas
    const isFreehandDirtyRect =
      !preview &&
      action &&
      activeStrokeCanvas &&
      action.tool === 'pen' &&
      action.points.length > 3

    ensureCache()

    if (isFreehandDirtyRect) {
      const dpr = getEffectiveDpr()
      const pts = action.points
      const pad = Math.max(20, action.lineWidth / 2 + 12)
      const bbox = computePointsBbox(pts, Math.max(0, lastBakedPtIdx - 1), pts.length - 1, pad)

      if (bbox) {
        const nextRect = {
          x: Math.max(0, Math.floor(bbox.x1 * dpr)),
          y: Math.max(0, Math.floor(bbox.y1 * dpr)),
          w: Math.min(canvas.width, Math.ceil(bbox.x2 * dpr)) - Math.max(0, Math.floor(bbox.x1 * dpr)),
          h: Math.min(canvas.height, Math.ceil(bbox.y2 * dpr)) - Math.max(0, Math.floor(bbox.y1 * dpr)),
        }

        const ux = prevStrokeRect ? Math.min(prevStrokeRect.x, nextRect.x) : nextRect.x
        const uy = prevStrokeRect ? Math.min(prevStrokeRect.y, nextRect.y) : nextRect.y
        const ur = prevStrokeRect ? Math.max(prevStrokeRect.x + prevStrokeRect.w, nextRect.x + nextRect.w) : nextRect.x + nextRect.w
        const ub = prevStrokeRect ? Math.max(prevStrokeRect.y + prevStrokeRect.h, nextRect.y + nextRect.h) : nextRect.y + nextRect.h
        const uw = ur - ux
        const uh = ub - uy

        if (uw > 0 && uh > 0) {
          ctx.save()
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.clearRect(ux, uy, uw, uh)
          if (cacheCanvas) ctx.drawImage(cacheCanvas, ux, uy, uw, uh, ux, uy, uw, uh)
          ctx.drawImage(activeStrokeCanvas, ux, uy, uw, uh, ux, uy, uw, uh)
          ctx.restore()

          ctx.save()
          ctx.beginPath()
          ctx.rect(ux / dpr, uy / dpr, uw / dpr, uh / dpr)
          ctx.clip()
          drawFreehandTail(ctx, action)
          ctx.restore()
        }

        prevStrokeRect = nextRect
        return
      }
    }

    prevStrokeRect = null

    // For active shapes / early freehand strokes / freehand fallback, use a local
    // dirty rect instead of the full-canvas clear+blit to avoid copying millions
    // of unchanged pixels on large canvases.
    if (action && !preview && action.points.length >= 1) {
      const usesIncrementalStroke = action.tool === 'pen'

      // Freehand > 3 fallback (isFreehandDirtyRect bbox was null): use full-stroke
      // bbox for a localized blit instead of full-canvas.
      if (usesIncrementalStroke && activeStrokeCanvas && action.points.length > 3) {
        const dpr = getEffectiveDpr()
        const pad = Math.max(20, action.lineWidth / 2 + 12)
        const strokeBbox = computeBbox(action, pad)
        if (strokeBbox) {
          const sx = Math.max(0, Math.floor(strokeBbox.x1 * dpr))
          const sy = Math.max(0, Math.floor(strokeBbox.y1 * dpr))
          const sr = Math.min(canvas.width, Math.ceil(strokeBbox.x2 * dpr))
          const sb = Math.min(canvas.height, Math.ceil(strokeBbox.y2 * dpr))
          const sw = sr - sx
          const sh = sb - sy
          if (sw > 0 && sh > 0 && sw * sh < canvas.width * canvas.height * 0.5) {
            ctx.save()
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(sx, sy, sw, sh)
            if (cacheCanvas) ctx.drawImage(cacheCanvas, sx, sy, sw, sh, sx, sy, sw, sh)
            ctx.drawImage(activeStrokeCanvas, sx, sy, sw, sh, sx, sy, sw, sh)
            ctx.restore()
            ctx.save()
            ctx.beginPath()
            ctx.rect(sx / dpr, sy / dpr, sw / dpr, sh / dpr)
            ctx.clip()
            drawFreehandTail(ctx, action)
            ctx.restore()
            return
          }
        }
        // Full-canvas fallback for very long strokes
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (cacheCanvas) ctx.drawImage(cacheCanvas, 0, 0)
        ctx.drawImage(activeStrokeCanvas, 0, 0)
        ctx.restore()
        drawFreehandTail(ctx, action)
        return
      }

      const dpr = getEffectiveDpr()
      const pad = Math.max(24, action.lineWidth / 2 + 16)
      const curBbox = computeBbox(action, pad)
      if (curBbox) {
        const nx = Math.max(0, Math.floor(curBbox.x1 * dpr))
        const ny = Math.max(0, Math.floor(curBbox.y1 * dpr))
        const nr = Math.min(canvas.width, Math.ceil(curBbox.x2 * dpr))
        const nb = Math.min(canvas.height, Math.ceil(curBbox.y2 * dpr))

        const ux = prevShapeRect ? Math.min(prevShapeRect.x, nx) : nx
        const uy = prevShapeRect ? Math.min(prevShapeRect.y, ny) : ny
        const ur = prevShapeRect ? Math.max(prevShapeRect.x + prevShapeRect.w, nr) : nr
        const ub = prevShapeRect ? Math.max(prevShapeRect.y + prevShapeRect.h, nb) : nb
        const uw = ur - ux
        const uh = ub - uy

        if (uw > 0 && uh > 0 && uw * uh < canvas.width * canvas.height * 0.5) {
          ctx.save()
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.clearRect(ux, uy, uw, uh)
          if (cacheCanvas) ctx.drawImage(cacheCanvas, ux, uy, uw, uh, ux, uy, uw, uh)
          ctx.restore()
          drawActionOn(ctx, action)
          prevShapeRect = { x: nx, y: ny, w: nr - nx, h: nb - ny }
          return
        }
      }
    }

    prevShapeRect = null

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (cacheCanvas) {
      ctx.drawImage(cacheCanvas, 0, 0)
    }
    ctx.restore()

    if (action) {
      drawActionOn(ctx, action)
    }

    if (preview) {
      if (dragOffsetX !== 0 || dragOffsetY !== 0) {
        ctx.save()
        ctx.translate(dragOffsetX, dragOffsetY)
        drawActionOn(ctx, preview)
        ctx.restore()
      } else {
        drawActionOn(ctx, preview)
      }
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
    trackHistoryPush(action)
    undoStack.push({ type: 'add', action })
    appendActionToHitGrid(action)
    flushRender()
  }

  function startDraw(point: Point) {
    if (currentTool.value === 'text') return
    isDrawing.value = true
    redoStack.length = 0

    const useIncrementalStroke = currentTool.value === 'pen'
    if (useIncrementalStroke) initStrokeCanvas()

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
    drawBatch([point], isPerfect)
  }

  function drawBatch(points: ArrayLike<InputPointLike>, isPerfect = false) {
    if (!isDrawing.value) return
    const action = currentAction.value
    if (!action || points.length === 0) return

    const pts = action.points
    const isFreehand = action.tool === 'pen' || action.tool === 'highlighter' || action.tool === 'eraser'

    if (isFreehand) {
      let last = pts[pts.length - 1]
      let appended = false
      const minDist = getMinDistSq()

      for (let i = 0; i < points.length; i++) {
        const point = points[i]
        const x = point.x ?? point.clientX
        const y = point.y ?? point.clientY
        if (x == null || y == null) continue

        const dx = x - last.x
        const dy = y - last.y
        if (dx * dx + dy * dy < minDist) continue
        const nextPoint: Point = { x, y }
        pts.push(nextPoint)
        last = nextPoint
        appended = true
      }

      if (!appended) return
      if (action.tool === 'pen') {
        bakeIncrementalStroke(action)
      }
    } else {
      const point = points[points.length - 1]
      const x = point.x ?? point.clientX
      const y = point.y ?? point.clientY
      if (x == null || y == null) return

      let finalPoint = { x, y }
      if (isPerfect && pts.length > 0 && (action.tool === 'rect' || action.tool === 'ellipse')) {
        const start = pts[0]
        const dx = x - start.x
        const dy = y - start.y
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
    prevShapeRect = null

    const pad = Math.max(20, action.lineWidth / 2 + 10)
    action.bbox = computeBbox(action, pad)
    updateShapeHitCache(action)

    clearStrokeCanvas()

    if (action.tool === 'eraser') {
      if (action.bbox) {
        const eraseTargets: { action: DrawAction, before: DrawAction['attachedErasers'], after: DrawAction['attachedErasers'] }[] = []

        for (let i = 0; i < history.length; i++) {
          const target = history[i]
          if (!target.bbox || !bboxesIntersect(target.bbox, action.bbox!)) continue

          const before = target.attachedErasers ? [...target.attachedErasers] : undefined
          if (!target.attachedErasers) target.attachedErasers = []
          target.attachedErasers.push(action)
          const after = [...target.attachedErasers]
          eraseTargets.push({ action: target, before, after })
          pathCache.delete(target)
        }

        if (eraseTargets.length > 0) {
          undoStack.push({ type: 'erase', targets: eraseTargets })
          redoStack.length = 0
        }
      }
      invalidateCache()
    } else {
      ensureCache()
      if (cacheCtx) drawActionOn(cacheCtx, action)
      history.push(action)
      trackHistoryPush(action)
      undoStack.push({ type: 'add', action })
      appendActionToHitGrid(action)
    }

    currentAction.value = null
    flushRender()
  }

  function drawActionOn(ctx: CanvasRenderingContext2D, action: DrawAction) {
    if (action.tool !== 'eraser' && action.attachedErasers?.length) {
      const bbox = action.bbox
      if (!bbox) { drawActionDirect(ctx, action); return }

      const dpr = getEffectiveDpr()
      const w = bbox.x2 - bbox.x1
      const h = bbox.y2 - bbox.y1
      const pw = Math.ceil(w * dpr)
      const ph = Math.ceil(h * dpr)
      if (pw <= 0 || ph <= 0) return

      if (!tempCanvas) {
        tempCanvas = document.createElement('canvas')
        tempCtx = null
      }
      // Round up to 256px multiples to avoid frequent GPU texture reallocation
      // when many erased strokes of varying sizes trigger cache rebuilds.
      const alignedW = (pw + 255) & ~255
      const alignedH = (ph + 255) & ~255
      if (tempCanvas.width < pw || tempCanvas.height < ph) {
        tempCanvas.width = Math.max(tempCanvas.width || 0, alignedW)
        tempCanvas.height = Math.max(tempCanvas.height || 0, alignedH)
        tempCtx = null
      }
      if (!tempCtx) tempCtx = tempCanvas.getContext('2d')
      const tctx = tempCtx
      if (!tctx) { drawActionDirect(ctx, action); return }

      tctx.setTransform(1, 0, 0, 1, 0, 0)
      tctx.clearRect(0, 0, pw, ph)
      tctx.scale(dpr, dpr)
      tctx.translate(-bbox.x1, -bbox.y1)

      drawActionDirect(tctx, action)
      for (let i = 0; i < action.attachedErasers.length; i++) {
        drawActionDirect(tctx, action.attachedErasers[i])
      }

      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.drawImage(tempCanvas, 0, 0, pw, ph, bbox.x1, bbox.y1, w, h)
      ctx.restore()
      return
    }
    drawActionDirect(ctx, action)
  }

  function drawActionDirect(ctx: CanvasRenderingContext2D, action: DrawAction) {
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
      // Match CSS line-height centering: use font-level metrics (constant across all glyphs)
      // rather than per-glyph actualBoundingBox which drifts from CSS's content-area center.
      ctx.textBaseline = 'alphabetic'
      const lines = (action.text ?? '').split('\n')
      const x = action.points[0].x + 2
      const lh = Math.round(fs * 1.3)
      const m = ctx.measureText('Mg')
      let ascent = m.fontBoundingBoxAscent
      let descent = m.fontBoundingBoxDescent
      if (
        ascent === undefined ||
        descent === undefined ||
        !Number.isFinite(ascent) ||
        !Number.isFinite(descent) ||
        (ascent === 0 && descent === 0)
      ) {
        ascent = fs * 0.9
        descent = fs * 0.3
      }
      const baselineOffset = (ascent - descent) / 2
      for (let i = 0; i < lines.length; i++) {
        const lineCenterY = action.points[0].y + i * lh
        ctx.fillText(lines[i], x, lineCenterY + baselineOffset)
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
      case 'eraser': {
        let path = pathCache.get(action)
        if (!path && action.bbox) {
          path = new Path2D()
          path.moveTo(pts[0].x, pts[0].y)
          if (pts.length === 2) {
            path.lineTo(pts[1].x, pts[1].y)
          } else {
            for (let k = 1; k < pts.length - 1; k++) {
              const midX = (pts[k].x + pts[k + 1].x) / 2
              const midY = (pts[k].y + pts[k + 1].y) / 2
              path.quadraticCurveTo(pts[k].x, pts[k].y, midX, midY)
            }
            path.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
          }
          pathCache.set(action, path)
        }
        if (path) {
          ctx.stroke(path)
        } else {
          drawFreehand(ctx, pts)
        }
        break
      }
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
    ensureCache()

    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0
    prevDragScreenX = NaN
    prevDragScreenY = NaN

    const canvas = canvasRef.value
    if (canvas) {
      const dpr = getEffectiveDpr()
      const pad = Math.max(20, action.lineWidth / 2 + 10) + 2
      const bbox = computeBbox(action, pad)
      if (bbox) {
        const bw = Math.ceil((bbox.x2 - bbox.x1) * dpr)
        const bh = Math.ceil((bbox.y2 - bbox.y1) * dpr)
        if (bw > 0 && bh > 0) {
          dragBboxX = bbox.x1
          dragBboxY = bbox.y1
          if (!dragCanvas) dragCanvas = document.createElement('canvas')
          dragCanvas.width = bw
          dragCanvas.height = bh
          dragCtx = dragCanvas.getContext('2d')
          if (dragCtx) {
            dragCtx.setTransform(1, 0, 0, 1, 0, 0)
            dragCtx.clearRect(0, 0, bw, bh)
            dragCtx.scale(dpr, dpr)
            dragCtx.translate(-bbox.x1, -bbox.y1)
            drawActionOn(dragCtx, action)
            useDragCanvas = true
          }
        }
      }
    }

    scheduleRender()
  }

  function updateDragOffset(dx: number, dy: number) {
    dragOffsetX = dx
    dragOffsetY = dy
    scheduleRender()
  }

  function endDrag() {
    if (previewAction.value) {
      const action = previewAction.value
      const hasMoved = dragOffsetX !== 0 || dragOffsetY !== 0

      const beforeIdx = history.indexOf(action)
      const beforeSnap = hasMoved ? takeDragSnapshot(action, beforeIdx) : null

      if (hasMoved) {
        for (const pt of action.points) {
          pt.x += dragOffsetX
          pt.y += dragOffsetY
        }
        offsetAttachedErasers(action, dragOffsetX, dragOffsetY)
        pathCache.delete(action)
      }

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
      updateShapeHitCache(action)

      const idx = history.indexOf(action)
      const movedToTop = idx !== -1 && idx !== history.length - 1
      if (idx !== -1 && idx !== history.length - 1) {
        history.splice(idx, 1)
        history.push(action)
        historyIndexDirty = true
      }
      refreshActionInHitGrid(action, movedToTop)

      if (hasMoved && beforeSnap) {
        const afterSnap = takeDragSnapshot(action, history.indexOf(action))
        undoStack.push({ type: 'drag', action, from: beforeSnap, to: afterSnap })
        redoStack.length = 0
      }
    }
    previewAction.value = null
    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0
    prevDragScreenX = NaN
    prevDragScreenY = NaN
    invalidateCache()
    flushRender()
  }

  function undo() {
    if (undoStack.length === 0) return
    historyIndexDirty = true
    const entry = undoStack.pop()!

    if (entry.type === 'add') {
      const idx = history.lastIndexOf(entry.action)
      if (idx !== -1) {
        history.splice(idx, 1)
        deleteActionFromHitGrid(entry.action)
      }
    } else if (entry.type === 'remove') {
      const target = Math.min(entry.index, history.length)
      history.splice(target, 0, entry.action)
      appendActionToHitGrid(entry.action)
    } else if (entry.type === 'drag') {
      restoreDragSnapshot(entry.action, entry.from)
      const cur = history.indexOf(entry.action)
      if (cur !== -1) {
        history.splice(cur, 1)
        const target = Math.min(entry.from.index, history.length)
        history.splice(target, 0, entry.action)
      }
      refreshActionInHitGrid(entry.action, true)
    } else if (entry.type === 'erase') {
      for (const t of entry.targets) {
        t.action.attachedErasers = t.before ? [...t.before] : undefined
        pathCache.delete(t.action)
      }
    } else if (entry.type === 'clear') {
      history.push(...entry.actions)
      undoStack.push(...entry.prevUndoStack)
      hitGridDirty = true
    }

    redoStack.push(entry)
    invalidateCache()
    flushRender()
  }

  function redo() {
    if (redoStack.length === 0) return
    historyIndexDirty = true
    const entry = redoStack.pop()!

    if (entry.type === 'add') {
      history.push(entry.action)
      appendActionToHitGrid(entry.action)
    } else if (entry.type === 'remove') {
      const idx = history.indexOf(entry.action)
      if (idx !== -1) {
        history.splice(idx, 1)
        deleteActionFromHitGrid(entry.action)
      }
    } else if (entry.type === 'drag') {
      restoreDragSnapshot(entry.action, entry.to)
      const cur = history.indexOf(entry.action)
      if (cur !== -1) {
        history.splice(cur, 1)
        const target = Math.min(entry.to.index, history.length)
        history.splice(target, 0, entry.action)
      }
      refreshActionInHitGrid(entry.action, true)
    } else if (entry.type === 'erase') {
      for (const t of entry.targets) {
        t.action.attachedErasers = t.after ? [...t.after] : undefined
        pathCache.delete(t.action)
      }
    } else if (entry.type === 'clear') {
      entry.actions = [...history]
      entry.prevUndoStack = [...undoStack]
      history.length = 0
      undoStack.length = 0
      clearHitGridState()
      hitGridDirty = false
    }

    undoStack.push(entry)
    invalidateCache()
    flushRender()
  }

  function clearAll() {
    if (history.length === 0) return
    historyIndexDirty = true

    const entry: UndoEntry = {
      type: 'clear',
      actions: [...history],
      prevUndoStack: [...undoStack],
    }

    history.length = 0
    undoStack.length = 0
    redoStack.length = 0
    clearHitGridState()
    hitGridDirty = false

    undoStack.push(entry)

    invalidateCache()
    const ctx = getCtx()
    const canvas = canvasRef.value
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  function hardReset() {
    historyIndexDirty = true
    history.length = 0
    undoStack.length = 0
    redoStack.length = 0
    clearHitGridState()
    hitGridDirty = false
    invalidateCache()
    const ctx = getCtx()
    const canvas = canvasRef.value
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    if (l2 === 0) return Math.hypot(px - ax, py - ay)
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
  }

  function distancePointToSegment(p: Point, a: Point, b: Point): number {
    return distToSeg(p.x, p.y, a.x, a.y, b.x, b.y)
  }

  function hitTestAction(action: DrawAction, p: Point): boolean {
    const pts = action.points
    if (pts.length === 0) return false

    const bbox = action.bbox
    if (bbox && (p.x < bbox.x1 || p.x > bbox.x2 || p.y < bbox.y1 || p.y > bbox.y2)) return false

    const threshold = Math.max(10, (action.lineWidth || 2) / 2 + 5)

    if (action.tool === 'text' && action.text) {
      const fs = action.fontSize ?? 24
      const lh = Math.round(fs * 1.3)
      const textWidth = action.textWidth ?? 200
      const lines = action.text.split('\n')
      const boxX = pts[0].x - 10
      const boxY = pts[0].y - lh / 2 - 10
      return p.x >= boxX && p.x <= boxX + textWidth + 20 && p.y >= boxY && p.y <= boxY + lines.length * lh + 20
    }

    if (action.tool === 'pen' || action.tool === 'highlighter') {
      if (pts.length === 1) {
        if (Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= threshold) return true
      } else {
        for (let j = 0, end = pts.length - 1; j < end; j++) {
          if (distToSeg(p.x, p.y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) <= threshold) return true
        }
      }
      return false
    }

    if (action.tool === 'line' || action.tool === 'arrow') {
      if (pts.length >= 2) {
        if (distancePointToSegment(p, pts[0], pts[1]) <= threshold) return true
      }
      return false
    }

    if (action.tool === 'rect') {
      if (pts.length >= 2) {
        const rect = action.rectHit ?? {
          x0: Math.min(pts[0].x, pts[1].x),
          y0: Math.min(pts[0].y, pts[1].y),
          x1: Math.max(pts[0].x, pts[1].x),
          y1: Math.max(pts[0].y, pts[1].y),
        }

        const d1 = distToSeg(p.x, p.y, rect.x0, rect.y0, rect.x1, rect.y0)
        const d2 = distToSeg(p.x, p.y, rect.x1, rect.y0, rect.x1, rect.y1)
        const d3 = distToSeg(p.x, p.y, rect.x1, rect.y1, rect.x0, rect.y1)
        const d4 = distToSeg(p.x, p.y, rect.x0, rect.y1, rect.x0, rect.y0)

        if (Math.min(d1, d2, d3, d4) <= threshold) return true
      }
      return false
    }

    if (action.tool === 'ellipse') {
      if (pts.length >= 2) {
        const ellipse = action.ellipseHit ?? {
          cx: (pts[0].x + pts[1].x) / 2,
          cy: (pts[0].y + pts[1].y) / 2,
          rx: Math.abs(pts[1].x - pts[0].x) / 2,
          ry: Math.abs(pts[1].y - pts[0].y) / 2,
        }

        if (ellipse.rx < 1 || ellipse.ry < 1) {
          return Math.hypot(p.x - ellipse.cx, p.y - ellipse.cy) <= threshold
        }

        if (p.x < ellipse.cx - ellipse.rx - threshold || p.x > ellipse.cx + ellipse.rx + threshold ||
            p.y < ellipse.cy - ellipse.ry - threshold || p.y > ellipse.cy + ellipse.ry + threshold) return false

        let minDist = Infinity
        for (let j = 0; j < 32; j++) {
          const angle = (j / 32) * Math.PI * 2
          const px = ellipse.cx + ellipse.rx * Math.cos(angle)
          const py = ellipse.cy + ellipse.ry * Math.sin(angle)
          const dist = Math.hypot(p.x - px, p.y - py)
          if (dist < minDist) minDist = dist
        }
        return minDist <= threshold
      }
    }

    return false
  }

  function findActionAt(p: Point): { action: DrawAction, index: number } | null {
    ensureHitGrid()
    ensureHistoryIndex()

    const bucket = hitGrid.get(`${Math.floor(p.x / HIT_GRID_SIZE)},${Math.floor(p.y / HIT_GRID_SIZE)}`)
    let bucketPos = bucket ? bucket.length - 1 : -1
    let overflowPos = hitGridOverflow.length - 1

    while (bucketPos >= 0 || overflowPos >= 0) {
      let action: DrawAction
      if (overflowPos < 0) {
        action = bucket![bucketPos--]
      } else if (bucketPos < 0) {
        action = hitGridOverflow[overflowPos--]
      } else {
        const bucketAction = bucket![bucketPos]
        const overflowAction = hitGridOverflow[overflowPos]
        if ((hitGridOrder.get(bucketAction) ?? 0) >= (hitGridOrder.get(overflowAction) ?? 0)) {
          action = bucket![bucketPos--]
        } else {
          action = hitGridOverflow[overflowPos--]
        }
      }

      if (hitTestAction(action, p)) {
        const index = historyIndexMap.get(action)
        if (index !== undefined && index < history.length && history[index] === action) {
          return { action, index }
        }
      }
    }

    return null
  }

  function removeAction(index: number) {
    if (index >= 0 && index < history.length) {
      const action = history[index]
      history.splice(index, 1)
      historyIndexDirty = true
      deleteActionFromHitGrid(action)
      undoStack.push({ type: 'remove', action, index })
      redoStack.length = 0
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
    mainCtx = null
    strokeCanvas = null
    strokeCtx = null
    dragCanvas = null
    dragCtx = null
    tempCanvas = null
    tempCtx = null
  }

  return {
    currentTool,
    currentColor,
    lineWidth,
    isDrawing,
    history,
    startDraw,
    draw,
    drawBatch,
    endDraw,
    findActionAt,
    removeAction,
    addTextAction,
    undo,
    redo,
    clearAll,
    hardReset,
    redrawAll,
    requestRedraw,
    scheduleRender,
    beginDrag,
    updateDragOffset,
    endDrag,
    destroy,
  }
}
