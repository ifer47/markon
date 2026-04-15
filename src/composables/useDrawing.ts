import { ref, shallowRef, type Ref } from 'vue'
import { computeBbox, bboxesIntersect, offsetAttachedErasers, updateShapeHitCache, hitTestAction } from './drawingGeometry'
import { drawActionDirect } from './drawingRender'

export type { Tool, Point, DrawAction } from './drawingTypes'
export type { InputPointLike } from './drawingTypes'

import type { Tool, Point, DrawAction, InputPointLike } from './drawingTypes'

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

export function useDrawing(
  historyCanvasRef: Ref<HTMLCanvasElement | null>,
  previewCanvasRef: Ref<HTMLCanvasElement | null>,
) {
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
  let historyCtx: CanvasRenderingContext2D | null = null
  let previewCtx: CanvasRenderingContext2D | null = null
  let cacheValid = false
  let rafId: number | null = null
  let historyDirty = true
  let previewDirty = true

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
    const canvas = previewCanvasRef.value ?? historyCanvasRef.value
    if (!canvas) return window.devicePixelRatio || 1
    if (canvas.width === cachedDprCanvasW && cachedDpr > 0) return cachedDpr
    const cssW = parseFloat(canvas.style.width)
    cachedDpr = cssW > 0 ? canvas.width / cssW : (window.devicePixelRatio || 1)
    cachedDprCanvasW = canvas.width
    return cachedDpr
  }

  function getHistoryCtx(): CanvasRenderingContext2D | null {
    const canvas = historyCanvasRef.value
    if (!canvas) {
      historyCtx = null
      return null
    }
    if (!historyCtx) {
      historyCtx = canvas.getContext('2d', { alpha: true, desynchronized: true })
    }
    return historyCtx
  }

  function getPreviewCtx(): CanvasRenderingContext2D | null {
    const canvas = previewCanvasRef.value
    if (!canvas) {
      previewCtx = null
      return null
    }
    if (!previewCtx) {
      previewCtx = canvas.getContext('2d', { alpha: true, desynchronized: true })
    }
    return previewCtx
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
    const canvas = historyCanvasRef.value
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
    historyDirty = true
  }

  function initStrokeCanvas() {
    const canvas = previewCanvasRef.value
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

  function renderHistoryFrame() {
    const ctx = getHistoryCtx()
    const canvas = historyCanvasRef.value
    if (!ctx || !canvas) return

    ensureCache()

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (cacheCanvas) ctx.drawImage(cacheCanvas, 0, 0)

    const action = currentAction.value
    if (action && action.tool === 'eraser' && action.points.length > 0) {
      const dpr = getEffectiveDpr()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawActionDirect(ctx, action, pathCache)
    }

    ctx.restore()
    historyDirty = false
  }

  function renderPreviewFrame() {
    const ctx = getPreviewCtx()
    const canvas = previewCanvasRef.value
    if (!ctx || !canvas) return

    const action = currentAction.value
    const preview = previewAction.value
    const dpr = getEffectiveDpr()

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (preview && useDragCanvas && dragCanvas) {
      const drawX = Math.round((dragBboxX + dragOffsetX) * dpr)
      const drawY = Math.round((dragBboxY + dragOffsetY) * dpr)
      ctx.drawImage(dragCanvas, drawX, drawY)
      ctx.restore()
      previewDirty = false
      return
    }

    if (action && action.tool !== 'eraser') {
      if (action.tool === 'pen' && strokeCanvas && action.points.length > 3) {
        ctx.drawImage(strokeCanvas, 0, 0)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawFreehandTail(ctx, action)
      } else {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawActionOn(ctx, action)
      }
    }

    if (preview) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (dragOffsetX !== 0 || dragOffsetY !== 0) {
        ctx.save()
        ctx.translate(dragOffsetX, dragOffsetY)
        drawActionOn(ctx, preview)
        ctx.restore()
      } else {
        drawActionOn(ctx, preview)
      }
    }

    ctx.restore()
    previewDirty = false
  }

  function renderFrame() {
    if (historyDirty) renderHistoryFrame()
    if (previewDirty) renderPreviewFrame()
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

    const ctx = getPreviewCtx()
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
    historyDirty = true
    previewDirty = true
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
    previewDirty = true
    if (currentTool.value === 'eraser') historyDirty = true
    scheduleRender()
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

    previewDirty = true
    if (action.tool === 'eraser') historyDirty = true
    scheduleRender()
  }

  function endDraw() {
    if (!isDrawing.value) return
    const action = currentAction.value
    if (!action) return
    isDrawing.value = false

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
      historyDirty = true
    }

    currentAction.value = null
    previewDirty = true
    flushRender()
  }

  function drawActionOn(ctx: CanvasRenderingContext2D, action: DrawAction) {
    if (action.tool !== 'eraser' && action.attachedErasers?.length) {
      const bbox = action.bbox
      if (!bbox) { drawActionDirect(ctx, action, pathCache); return }

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
      if (!tctx) { drawActionDirect(ctx, action, pathCache); return }

      tctx.setTransform(1, 0, 0, 1, 0, 0)
      tctx.clearRect(0, 0, pw, ph)
      tctx.scale(dpr, dpr)
      tctx.translate(-bbox.x1, -bbox.y1)

      drawActionDirect(tctx, action, pathCache)
      for (let i = 0; i < action.attachedErasers.length; i++) {
        drawActionDirect(tctx, action.attachedErasers[i], pathCache)
      }

      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.drawImage(tempCanvas, 0, 0, pw, ph, bbox.x1, bbox.y1, w, h)
      ctx.restore()
      return
    }
    drawActionDirect(ctx, action, pathCache)
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

  function redrawAll() {
    invalidateCache()
    previewDirty = true
    flushRender()
  }

  function beginDrag(action: DrawAction) {
    previewAction.value = action
    invalidateCache()
    ensureCache()

    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0

    const canvas = previewCanvasRef.value
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

    previewDirty = true
    scheduleRender()
  }

  function updateDragOffset(dx: number, dy: number) {
    dragOffsetX = dx
    dragOffsetY = dy
    previewDirty = true
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
    invalidateCache()
    previewDirty = true
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
    currentAction.value = null
    previewAction.value = null
    previewDirty = true
    flushRender()
  }

  function hardReset() {
    historyIndexDirty = true
    history.length = 0
    undoStack.length = 0
    redoStack.length = 0
    clearHitGridState()
    hitGridDirty = false
    invalidateCache()
    currentAction.value = null
    previewAction.value = null
    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0
    clearStrokeCanvas()
    previewDirty = true
    flushRender()
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
    historyCtx = null
    previewCtx = null
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
    beginDrag,
    updateDragOffset,
    endDrag,
    destroy,
  }
}
