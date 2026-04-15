import { describe, it, expect } from 'vitest'
import type { DrawAction, Point } from './drawingTypes'
import {
  computeBbox,
  bboxesIntersect,
  cloneActionWithOffset,
  offsetAttachedErasers,
  updateShapeHitCache,
  distToSeg,
  distancePointToSegment,
  hitTestAction,
} from './drawingGeometry'

function makeAction(overrides: Partial<DrawAction> = {}): DrawAction {
  return {
    tool: 'pen',
    color: '#FF0000',
    lineWidth: 3,
    opacity: 1,
    points: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// computeBbox
// ---------------------------------------------------------------------------
describe('computeBbox', () => {
  it('returns undefined for empty points', () => {
    const action = makeAction({ points: [] })
    expect(computeBbox(action, 10)).toBeUndefined()
  })

  it('computes bbox for a single point with padding', () => {
    const action = makeAction({ points: [{ x: 50, y: 80 }] })
    const bbox = computeBbox(action, 5)
    expect(bbox).toEqual({ x1: 45, y1: 75, x2: 55, y2: 85 })
  })

  it('computes bbox for multiple points', () => {
    const action = makeAction({
      points: [
        { x: 10, y: 20 },
        { x: 40, y: 5 },
        { x: 25, y: 50 },
      ],
    })
    const bbox = computeBbox(action, 0)
    expect(bbox).toEqual({ x1: 10, y1: 5, x2: 40, y2: 50 })
  })

  it('applies padding symmetrically', () => {
    const action = makeAction({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
    })
    const bbox = computeBbox(action, 15)
    expect(bbox).toEqual({ x1: -15, y1: -15, x2: 115, y2: 115 })
  })

  it('handles negative coordinates', () => {
    const action = makeAction({
      points: [
        { x: -30, y: -10 },
        { x: 20, y: 40 },
      ],
    })
    const bbox = computeBbox(action, 0)
    expect(bbox).toEqual({ x1: -30, y1: -10, x2: 20, y2: 40 })
  })
})

// ---------------------------------------------------------------------------
// bboxesIntersect
// ---------------------------------------------------------------------------
describe('bboxesIntersect', () => {
  it('detects overlapping boxes', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    const b = { x1: 5, y1: 5, x2: 15, y2: 15 }
    expect(bboxesIntersect(a, b)).toBe(true)
  })

  it('detects non-overlapping boxes', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    const b = { x1: 20, y1: 20, x2: 30, y2: 30 }
    expect(bboxesIntersect(a, b)).toBe(false)
  })

  it('detects edge-touching boxes as intersecting', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    const b = { x1: 10, y1: 0, x2: 20, y2: 10 }
    expect(bboxesIntersect(a, b)).toBe(true)
  })

  it('detects containment', () => {
    const outer = { x1: 0, y1: 0, x2: 100, y2: 100 }
    const inner = { x1: 20, y1: 20, x2: 40, y2: 40 }
    expect(bboxesIntersect(outer, inner)).toBe(true)
    expect(bboxesIntersect(inner, outer)).toBe(true)
  })

  it('returns false when separated on Y axis only', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    const b = { x1: 0, y1: 11, x2: 10, y2: 20 }
    expect(bboxesIntersect(a, b)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// cloneActionWithOffset
// ---------------------------------------------------------------------------
describe('cloneActionWithOffset', () => {
  it('offsets points by (dx, dy)', () => {
    const action = makeAction({
      points: [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ],
    })
    const cloned = cloneActionWithOffset(action, 5, -3)
    expect(cloned.points).toEqual([
      { x: 15, y: 17 },
      { x: 35, y: 37 },
    ])
  })

  it('offsets bbox', () => {
    const action = makeAction({
      points: [{ x: 0, y: 0 }],
      bbox: { x1: 0, y1: 0, x2: 100, y2: 100 },
    })
    const cloned = cloneActionWithOffset(action, 10, 20)
    expect(cloned.bbox).toEqual({ x1: 10, y1: 20, x2: 110, y2: 120 })
  })

  it('offsets rectHit', () => {
    const action = makeAction({
      points: [{ x: 0, y: 0 }],
      rectHit: { x0: 0, y0: 0, x1: 50, y1: 50 },
    })
    const cloned = cloneActionWithOffset(action, -5, 10)
    expect(cloned.rectHit).toEqual({ x0: -5, y0: 10, x1: 45, y1: 60 })
  })

  it('offsets ellipseHit (cx/cy only, rx/ry unchanged)', () => {
    const action = makeAction({
      points: [{ x: 0, y: 0 }],
      ellipseHit: { cx: 50, cy: 50, rx: 30, ry: 20 },
    })
    const cloned = cloneActionWithOffset(action, 10, 10)
    expect(cloned.ellipseHit).toEqual({ cx: 60, cy: 60, rx: 30, ry: 20 })
  })

  it('preserves undefined optional fields', () => {
    const action = makeAction({ points: [{ x: 0, y: 0 }] })
    const cloned = cloneActionWithOffset(action, 1, 1)
    expect(cloned.bbox).toBeUndefined()
    expect(cloned.rectHit).toBeUndefined()
    expect(cloned.ellipseHit).toBeUndefined()
    expect(cloned.attachedErasers).toBeUndefined()
  })

  it('recursively offsets attachedErasers', () => {
    const eraser = makeAction({
      tool: 'eraser',
      points: [{ x: 5, y: 5 }],
      bbox: { x1: 0, y1: 0, x2: 10, y2: 10 },
    })
    const action = makeAction({
      points: [{ x: 20, y: 20 }],
      attachedErasers: [eraser],
    })
    const cloned = cloneActionWithOffset(action, 100, 200)
    expect(cloned.attachedErasers).toHaveLength(1)
    expect(cloned.attachedErasers![0].points[0]).toEqual({ x: 105, y: 205 })
    expect(cloned.attachedErasers![0].bbox).toEqual({ x1: 100, y1: 200, x2: 110, y2: 210 })
  })

  it('does not mutate the original action', () => {
    const action = makeAction({
      points: [{ x: 10, y: 20 }],
      bbox: { x1: 5, y1: 15, x2: 15, y2: 25 },
    })
    cloneActionWithOffset(action, 99, 99)
    expect(action.points[0]).toEqual({ x: 10, y: 20 })
    expect(action.bbox).toEqual({ x1: 5, y1: 15, x2: 15, y2: 25 })
  })
})

// ---------------------------------------------------------------------------
// offsetAttachedErasers
// ---------------------------------------------------------------------------
describe('offsetAttachedErasers', () => {
  it('does nothing when no attachedErasers', () => {
    const action = makeAction({ points: [{ x: 0, y: 0 }] })
    offsetAttachedErasers(action, 10, 10)
    expect(action.attachedErasers).toBeUndefined()
  })

  it('does nothing for empty attachedErasers array', () => {
    const action = makeAction({ points: [{ x: 0, y: 0 }], attachedErasers: [] })
    offsetAttachedErasers(action, 10, 10)
    expect(action.attachedErasers).toEqual([])
  })

  it('offsets each attached eraser in place', () => {
    const e1 = makeAction({ tool: 'eraser', points: [{ x: 10, y: 20 }] })
    const e2 = makeAction({ tool: 'eraser', points: [{ x: 30, y: 40 }] })
    const action = makeAction({ points: [{ x: 0, y: 0 }], attachedErasers: [e1, e2] })
    offsetAttachedErasers(action, 5, -5)
    expect(action.attachedErasers![0].points[0]).toEqual({ x: 15, y: 15 })
    expect(action.attachedErasers![1].points[0]).toEqual({ x: 35, y: 35 })
  })
})

// ---------------------------------------------------------------------------
// updateShapeHitCache
// ---------------------------------------------------------------------------
describe('updateShapeHitCache', () => {
  it('clears caches for fewer than 2 points', () => {
    const action = makeAction({
      tool: 'rect',
      points: [{ x: 0, y: 0 }],
      rectHit: { x0: 0, y0: 0, x1: 1, y1: 1 },
    })
    updateShapeHitCache(action)
    expect(action.rectHit).toBeUndefined()
    expect(action.ellipseHit).toBeUndefined()
  })

  it('computes rectHit for rect tool', () => {
    const action = makeAction({
      tool: 'rect',
      points: [
        { x: 30, y: 10 },
        { x: 10, y: 50 },
      ],
    })
    updateShapeHitCache(action)
    expect(action.rectHit).toEqual({ x0: 10, y0: 10, x1: 30, y1: 50 })
    expect(action.ellipseHit).toBeUndefined()
  })

  it('computes ellipseHit for ellipse tool', () => {
    const action = makeAction({
      tool: 'ellipse',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 60 },
      ],
    })
    updateShapeHitCache(action)
    expect(action.ellipseHit).toEqual({ cx: 50, cy: 30, rx: 50, ry: 30 })
    expect(action.rectHit).toBeUndefined()
  })

  it('does nothing for pen tool', () => {
    const action = makeAction({
      tool: 'pen',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    })
    updateShapeHitCache(action)
    expect(action.rectHit).toBeUndefined()
    expect(action.ellipseHit).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// distToSeg / distancePointToSegment
// ---------------------------------------------------------------------------
describe('distToSeg', () => {
  it('returns 0 when point is on the segment', () => {
    expect(distToSeg(5, 0, 0, 0, 10, 0)).toBe(0)
  })

  it('returns perpendicular distance to mid-segment', () => {
    expect(distToSeg(5, 3, 0, 0, 10, 0)).toBe(3)
  })

  it('returns distance to nearest endpoint when projection falls outside', () => {
    const d = distToSeg(15, 0, 0, 0, 10, 0)
    expect(d).toBe(5)
  })

  it('handles degenerate segment (single point)', () => {
    const d = distToSeg(3, 4, 0, 0, 0, 0)
    expect(d).toBe(5)
  })

  it('handles diagonal segment', () => {
    // perpendicular distance from (0,1) to segment (0,0)→(1,1) = 1/√2
    const d = distToSeg(0, 1, 0, 0, 1, 1)
    expect(d).toBeCloseTo(Math.SQRT1_2, 10)
  })
})

describe('distancePointToSegment', () => {
  it('delegates to distToSeg with Point objects', () => {
    const p: Point = { x: 5, y: 3 }
    const a: Point = { x: 0, y: 0 }
    const b: Point = { x: 10, y: 0 }
    expect(distancePointToSegment(p, a, b)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// hitTestAction
// ---------------------------------------------------------------------------
describe('hitTestAction', () => {
  describe('general', () => {
    it('returns false for empty points', () => {
      const action = makeAction({ points: [] })
      expect(hitTestAction(action, { x: 0, y: 0 })).toBe(false)
    })

    it('returns false when point is outside bbox', () => {
      const action = makeAction({
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        bbox: { x1: -5, y1: -5, x2: 15, y2: 15 },
      })
      expect(hitTestAction(action, { x: 100, y: 100 })).toBe(false)
    })
  })

  describe('pen tool', () => {
    it('hits a single-point pen stroke', () => {
      const action = makeAction({
        tool: 'pen',
        lineWidth: 3,
        points: [{ x: 50, y: 50 }],
        bbox: { x1: 40, y1: 40, x2: 60, y2: 60 },
      })
      expect(hitTestAction(action, { x: 50, y: 50 })).toBe(true)
    })

    it('hits near a pen segment', () => {
      const action = makeAction({
        tool: 'pen',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -15, x2: 115, y2: 15 },
      })
      expect(hitTestAction(action, { x: 50, y: 5 })).toBe(true)
    })

    it('misses far from a pen segment', () => {
      const action = makeAction({
        tool: 'pen',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -50, x2: 115, y2: 50 },
      })
      expect(hitTestAction(action, { x: 50, y: 40 })).toBe(false)
    })
  })

  describe('highlighter tool', () => {
    it('hits near a highlighter segment', () => {
      const action = makeAction({
        tool: 'highlighter',
        lineWidth: 20,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -25, y1: -25, x2: 125, y2: 25 },
      })
      expect(hitTestAction(action, { x: 50, y: 8 })).toBe(true)
    })
  })

  describe('line tool', () => {
    it('hits near a line', () => {
      const action = makeAction({
        tool: 'line',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -15, x2: 115, y2: 15 },
      })
      expect(hitTestAction(action, { x: 50, y: 5 })).toBe(true)
    })

    it('misses far from a line', () => {
      const action = makeAction({
        tool: 'line',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -50, x2: 115, y2: 50 },
      })
      expect(hitTestAction(action, { x: 50, y: 40 })).toBe(false)
    })

    it('returns false for line with fewer than 2 points', () => {
      const action = makeAction({
        tool: 'line',
        points: [{ x: 0, y: 0 }],
        bbox: { x1: -15, y1: -15, x2: 15, y2: 15 },
      })
      expect(hitTestAction(action, { x: 0, y: 0 })).toBe(false)
    })
  })

  describe('arrow tool', () => {
    it('hits near an arrow shaft', () => {
      const action = makeAction({
        tool: 'arrow',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -15, x2: 115, y2: 15 },
      })
      expect(hitTestAction(action, { x: 50, y: 5 })).toBe(true)
    })
  })

  describe('rect tool', () => {
    it('hits on the edge of a rectangle', () => {
      const action = makeAction({
        tool: 'rect',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 80 },
        ],
        bbox: { x1: -15, y1: -15, x2: 115, y2: 95 },
      })
      // point near top edge
      expect(hitTestAction(action, { x: 50, y: 2 })).toBe(true)
    })

    it('misses inside a rectangle (not filled)', () => {
      const action = makeAction({
        tool: 'rect',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 200 },
        ],
        bbox: { x1: -15, y1: -15, x2: 215, y2: 215 },
      })
      expect(hitTestAction(action, { x: 100, y: 100 })).toBe(false)
    })

    it('uses cached rectHit when available', () => {
      const action = makeAction({
        tool: 'rect',
        lineWidth: 3,
        points: [
          { x: 50, y: 50 },
          { x: 0, y: 0 },
        ],
        rectHit: { x0: 0, y0: 0, x1: 50, y1: 50 },
        bbox: { x1: -15, y1: -15, x2: 65, y2: 65 },
      })
      expect(hitTestAction(action, { x: 25, y: 1 })).toBe(true)
    })

    it('returns false for rect with fewer than 2 points', () => {
      const action = makeAction({
        tool: 'rect',
        points: [{ x: 0, y: 0 }],
        bbox: { x1: -15, y1: -15, x2: 15, y2: 15 },
      })
      expect(hitTestAction(action, { x: 0, y: 0 })).toBe(false)
    })
  })

  describe('ellipse tool', () => {
    it('hits on the perimeter of an ellipse', () => {
      const action = makeAction({
        tool: 'ellipse',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 60 },
        ],
        ellipseHit: { cx: 50, cy: 30, rx: 50, ry: 30 },
        bbox: { x1: -15, y1: -15, x2: 115, y2: 75 },
      })
      // rightmost point of ellipse
      expect(hitTestAction(action, { x: 100, y: 30 })).toBe(true)
    })

    it('misses inside a large ellipse', () => {
      const action = makeAction({
        tool: 'ellipse',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 200 },
        ],
        ellipseHit: { cx: 100, cy: 100, rx: 100, ry: 100 },
        bbox: { x1: -15, y1: -15, x2: 215, y2: 215 },
      })
      expect(hitTestAction(action, { x: 100, y: 100 })).toBe(false)
    })

    it('hits a degenerate (tiny) ellipse at its center', () => {
      const action = makeAction({
        tool: 'ellipse',
        lineWidth: 3,
        points: [
          { x: 50, y: 50 },
          { x: 50, y: 50 },
        ],
        ellipseHit: { cx: 50, cy: 50, rx: 0, ry: 0 },
        bbox: { x1: 35, y1: 35, x2: 65, y2: 65 },
      })
      expect(hitTestAction(action, { x: 50, y: 50 })).toBe(true)
    })

    it('returns false for ellipse with fewer than 2 points', () => {
      const action = makeAction({
        tool: 'ellipse',
        points: [{ x: 50, y: 50 }],
        bbox: { x1: 35, y1: 35, x2: 65, y2: 65 },
      })
      expect(hitTestAction(action, { x: 50, y: 50 })).toBe(false)
    })
  })

  describe('text tool', () => {
    it('hits inside the text bounding box', () => {
      const action = makeAction({
        tool: 'text',
        lineWidth: 3,
        points: [{ x: 100, y: 100 }],
        text: 'Hello',
        fontSize: 24,
        textWidth: 60,
        bbox: { x1: 85, y1: 75, x2: 170, y2: 140 },
      })
      expect(hitTestAction(action, { x: 110, y: 105 })).toBe(true)
    })

    it('misses outside the text bounding box', () => {
      const action = makeAction({
        tool: 'text',
        lineWidth: 3,
        points: [{ x: 100, y: 100 }],
        text: 'Hello',
        fontSize: 24,
        textWidth: 60,
        bbox: { x1: 85, y1: 75, x2: 170, y2: 140 },
      })
      expect(hitTestAction(action, { x: 300, y: 300 })).toBe(false)
    })

    it('accounts for multiline text height', () => {
      const action = makeAction({
        tool: 'text',
        lineWidth: 3,
        points: [{ x: 50, y: 50 }],
        text: 'Line1\nLine2\nLine3',
        fontSize: 20,
        textWidth: 80,
        bbox: { x1: 30, y1: 20, x2: 160, y2: 150 },
      })
      // within the multiline region
      const lh = Math.round(20 * 1.3)
      const boxY = 50 - lh / 2 - 10
      const boxBottom = boxY + 3 * lh + 20
      expect(hitTestAction(action, { x: 60, y: boxBottom - 5 })).toBe(true)
    })

    it('returns false for text without text content', () => {
      const action = makeAction({
        tool: 'text',
        points: [{ x: 50, y: 50 }],
        bbox: { x1: 35, y1: 35, x2: 65, y2: 65 },
      })
      // no text → falls through to generic path, no special text handling
      expect(hitTestAction(action, { x: 50, y: 50 })).toBe(false)
    })
  })
})
