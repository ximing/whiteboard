import { bboxOf, dist, pointSegmentDistance } from './geometry';
import type { Point, ShapeObj, ShapeStyle } from './types';
import { createId } from './id';

export type RecognizedShape =
  | {
      kind: 'rect' | 'ellipse';
      cx: number;
      cy: number;
      width: number;
      height: number;
      rotation: number;
    }
  | {
      kind: 'triangle';
      cx: number;
      cy: number;
      width: number;
      height: number;
      rotation: number;
      localVertices: Point[];
    };

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (!prev || dist(prev, point) > 0.4) out.push(point);
  }
  return out;
}

function isClosed(points: Point[]): boolean {
  if (points.length < 4) return false;
  const box = bboxOf(points);
  const diagonal = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  if (diagonal < 12) return false;
  return dist(points[0], points[points.length - 1]) <= Math.max(10, diagonal * 0.08);
}

function openRing(points: Point[]): Point[] {
  const ring = points.slice();
  if (dist(ring[0], ring[ring.length - 1]) <= 0.4) ring.pop();
  return ring;
}

function pointLineDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return dist(point, a);
  return Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / len;
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  let maxDist = 0;
  let index = -1;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const distance = pointLineDistance(points[i], first, last);
    if (distance > maxDist) {
      maxDist = distance;
      index = i;
    }
  }
  if (maxDist > epsilon && index > 0) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function turnAngle(prev: Point, current: Point, next: Point): number {
  const a = Math.atan2(current.y - prev.y, current.x - prev.x);
  const b = Math.atan2(next.y - current.y, next.x - current.x);
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function cornersOf(simplified: Point[]): Point[] {
  if (simplified.length < 3) return [];
  const corners: Point[] = [];
  for (let i = 0; i < simplified.length; i++) {
    const prev = simplified[(i - 1 + simplified.length) % simplified.length];
    const next = simplified[(i + 1) % simplified.length];
    if (Math.abs(turnAngle(prev, simplified[i], next)) >= 0.8) corners.push(simplified[i]);
  }
  return corners;
}

function meanEdgeDistance(points: Point[], corners: Point[]): number {
  if (corners.length < 2) return Infinity;
  let sum = 0;
  for (const point of points) {
    let best = Infinity;
    for (let i = 0; i < corners.length; i++) {
      best = Math.min(best, pointSegmentDistance(point, corners[i], corners[(i + 1) % corners.length]));
    }
    sum += best;
  }
  return sum / points.length;
}

function polygonArea(corners: Point[]): number {
  let area = 0;
  for (let i = 0; i < corners.length; i++) {
    const next = corners[(i + 1) % corners.length];
    area += corners[i].x * next.y - next.x * corners[i].y;
  }
  return Math.abs(area) / 2;
}

function looksLikeRectangle(corners: Point[], points: Point[]): boolean {
  if (corners.length !== 4) return false;
  const sides = corners.map((corner, index) => dist(corner, corners[(index + 1) % 4]));
  if (sides.some((side) => side < 12)) return false;
  if (sides[0] / sides[2] > 1.35 || sides[2] / sides[0] > 1.35) return false;
  if (sides[1] / sides[3] > 1.35 || sides[3] / sides[1] > 1.35) return false;
  for (let i = 0; i < 4; i++) {
    const turn = Math.abs(turnAngle(corners[(i + 3) % 4], corners[i], corners[(i + 1) % 4]));
    if (turn < 1.05 || turn > 2.1) return false;
  }
  const box = bboxOf(points);
  const diagonal = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  return meanEdgeDistance(points, corners) <= Math.max(3, diagonal * 0.035);
}

function looksLikeTriangle(corners: Point[], points: Point[]): boolean {
  if (corners.length !== 3) return false;
  const sides = corners.map((corner, index) => dist(corner, corners[(index + 1) % 3]));
  if (sides.some((side) => side < 12)) return false;
  if (polygonArea(corners) < 80) return false;
  for (let i = 0; i < 3; i++) {
    const turn = Math.abs(turnAngle(corners[(i + 2) % 3], corners[i], corners[(i + 1) % 3]));
    if (turn < 0.35 || turn > 2.7) return false;
  }
  const box = bboxOf(points);
  const diagonal = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  return meanEdgeDistance(points, corners) <= Math.max(3, diagonal * 0.04);
}

function ellipseFit(points: Point[]): RecognizedShape | null {
  if (points.length < 16) return null;
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point.x;
    cy += point.y;
  }
  cx /= points.length;
  cy /= points.length;

  const angles = points.map((point) => Math.atan2(point.y - cy, point.x - cx)).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < angles.length; i++) maxGap = Math.max(maxGap, angles[i] - angles[i - 1]);
  maxGap = Math.max(maxGap, angles[0] + Math.PI * 2 - angles[angles.length - 1]);
  if (Math.PI * 2 - maxGap < 5.2) return null;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of points) {
    const x = point.x - cx;
    const y = point.y - cy;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  sxx /= points.length;
  syy /= points.length;
  sxy /= points.length;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let maxX = 0;
  let maxY = 0;
  const locals: Point[] = [];
  for (const point of points) {
    const x = point.x - cx;
    const y = point.y - cy;
    const lx = x * cos + y * sin;
    const ly = -x * sin + y * cos;
    locals.push({ x: lx, y: ly });
    maxX = Math.max(maxX, Math.abs(lx));
    maxY = Math.max(maxY, Math.abs(ly));
  }
  if (maxX < 12 || maxY < 12) return null;
  let error = 0;
  for (const local of locals) error += Math.abs(Math.hypot(local.x / maxX, local.y / maxY) - 1);
  error /= locals.length;
  if (error > 0.08) return null;
  return {
    kind: 'ellipse',
    cx,
    cy,
    width: maxX * 2,
    height: maxY * 2,
    rotation: angle,
  };
}

function rectFromCorners(corners: Point[]): RecognizedShape {
  const width = dist(corners[0], corners[1]);
  const height = dist(corners[1], corners[2]);
  return {
    kind: 'rect',
    cx: (corners[0].x + corners[2].x) / 2,
    cy: (corners[0].y + corners[2].y) / 2,
    width,
    height,
    rotation: Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x),
  };
}

function triangleFromCorners(corners: Point[]): RecognizedShape {
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    kind: 'triangle',
    cx,
    cy,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    rotation: 0,
    localVertices: corners.map((corner) => ({ x: corner.x - cx, y: corner.y - cy })),
  };
}

/** A clean rectangle, ellipse, or triangle polyline. Anything else, including a scribble, is null. */
export function recognizeShape(points: Point[]): RecognizedShape | null {
  const cleaned = dedupe(points);
  if (!isClosed(cleaned)) return null;
  const ring = openRing(cleaned);
  if (ring.length < 3) return null;
  const box = bboxOf(ring);
  const diagonal = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  const epsilon = Math.max(1.2, diagonal * 0.015);
  let simplified = rdp(ring, epsilon);
  if (simplified.length >= 2 && dist(simplified[0], simplified[simplified.length - 1]) < 0.4) {
    simplified = simplified.slice(0, -1);
  }
  const corners = cornersOf(simplified);
  if (looksLikeTriangle(corners, ring)) return triangleFromCorners(corners);
  if (looksLikeRectangle(corners, ring)) return rectFromCorners(corners);
  return ellipseFit(ring);
}

export function shapeFromRecognition(recognized: RecognizedShape, style: ShapeStyle): ShapeObj {
  return {
    id: createId(),
    z: 0,
    type: 'shape',
    kind: recognized.kind,
    cx: recognized.cx,
    cy: recognized.cy,
    width: recognized.width,
    height: recognized.height,
    rotation: recognized.rotation,
    stroke: style.stroke,
    fill: style.fill,
    strokeWidth: style.strokeWidth,
    localVertices: recognized.kind === 'triangle' ? recognized.localVertices : undefined,
  };
}
