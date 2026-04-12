import type { DrawAction, Point } from './drawingTypes'

export function computeBbox(action: DrawAction, pad: number): DrawAction['bbox'] {
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

export function bboxesIntersect(
  a: NonNullable<DrawAction['bbox']>,
  b: NonNullable<DrawAction['bbox']>
) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1
}

export function cloneActionWithOffset(action: DrawAction, dx: number, dy: number): DrawAction {
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

export function offsetAttachedErasers(action: DrawAction, dx: number, dy: number) {
  if (!action.attachedErasers?.length) return
  for (let i = 0; i < action.attachedErasers.length; i++) {
    action.attachedErasers[i] = cloneActionWithOffset(action.attachedErasers[i], dx, dy)
  }
}

export function updateShapeHitCache(action: DrawAction) {
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

export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function distancePointToSegment(p: Point, a: Point, b: Point): number {
  return distToSeg(p.x, p.y, a.x, a.y, b.x, b.y)
}

export function hitTestAction(action: DrawAction, p: Point): boolean {
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
