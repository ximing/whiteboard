import type { Frame, Point, View } from './types';

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function screenToWorld(screen: Point, view: View): Point {
  return {
    x: (screen.x - view.panX) / view.zoom,
    y: (screen.y - view.panY) / view.zoom,
  };
}

export function worldToScreen(world: Point, view: View): Point {
  return {
    x: world.x * view.zoom + view.panX,
    y: world.y * view.zoom + view.panY,
  };
}

export function panView(view: View, dx: number, dy: number): View {
  return { ...view, panX: view.panX + dx, panY: view.panY + dy };
}

export function zoomView(view: View, screen: Point, factor: number, min = 0.15, max = 8): View {
  const zoom = clamp(view.zoom * factor, min, max);
  const world = screenToWorld(screen, view);
  return {
    zoom,
    panX: screen.x - world.x * zoom,
    panY: screen.y - world.y * zoom,
  };
}

/** Positive angle is clockwise in canvas y-down space. */
export function rotatePoint(point: Point, originX: number, originY: number, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - originX;
  const dy = point.y - originY;
  return {
    x: originX + dx * cos - dy * sin,
    y: originY + dx * sin + dy * cos,
  };
}

export function worldToLocal(point: Point, frame: Pick<Frame, 'cx' | 'cy' | 'rotation'>): Point {
  const rotated = rotatePoint(point, frame.cx, frame.cy, -frame.rotation);
  return { x: rotated.x - frame.cx, y: rotated.y - frame.cy };
}

export function localToWorld(point: Point, frame: Pick<Frame, 'cx' | 'cy' | 'rotation'>): Point {
  return rotatePoint({ x: frame.cx + point.x, y: frame.cy + point.y }, frame.cx, frame.cy, frame.rotation);
}

export function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(point, a);
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function properIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = cross(a2.x - a1.x, a2.y - a1.y, b1.x - a1.x, b1.y - a1.y);
  const d2 = cross(a2.x - a1.x, a2.y - a1.y, b2.x - a1.x, b2.y - a1.y);
  const d3 = cross(b2.x - b1.x, b2.y - b1.y, a1.x - b1.x, a1.y - b1.y);
  const d4 = cross(b2.x - b1.x, b2.y - b1.y, a2.x - b1.x, a2.y - b1.y);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function segmentDistance(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (properIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

export function polylineNear(path: Point[], other: Point[], maxDist: number): boolean {
  if (path.length === 0 || other.length === 0) return false;
  const a = path.length === 1 ? [path[0], path[0]] : path;
  const b = other.length === 1 ? [other[0], other[0]] : other;
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentDistance(a[i - 1], a[i], b[j - 1], b[j]) <= maxDist) return true;
    }
  }
  return false;
}

export function bboxOf(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function pointInTriangle(point: Point, a: Point, b: Point, c: Point): boolean {
  const sign = (p: Point, q: Point, r: Point) => (p.x - r.x) * (q.y - r.y) - (q.x - r.x) * (p.y - r.y);
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
