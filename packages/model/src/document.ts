import { bboxOf, dist, localToWorld, pointInTriangle, pointSegmentDistance, polylineNear, worldToLocal } from './geometry';
import { createId } from './id';
import { recognizeShape, shapeFromRecognition } from './recognize';
import { diffSteps, invertStep, applyStep } from './step';
import type {
  BoardObject,
  CommentObj,
  ConnectorObj,
  Document,
  EditorState,
  Frame,
  ImageObj,
  InkStyle,
  Point,
  ShapeKind,
  ShapeObj,
  ShapeStyle,
  Step,
  StickyObj,
  StrokeObj,
  StrokePoint,
  TextObj,
  ThemeName,
  View,
} from './types';

const HISTORY_LIMIT = 80;

export function createDocument(): Document {
  return {
    version: 1,
    rev: 0,
    theme: 'light',
    view: { panX: 0, panY: 0, zoom: 1 },
    objects: [],
  };
}

export function createEditor(doc: Document = createDocument()): EditorState {
  return {
    doc,
    past: [],
    future: [],
    collab: { version: doc.rev, confirmed: doc, unconfirmed: [] },
  };
}

function applyTransaction(state: EditorState, steps: Step[], kind: 'edit' | 'undo' | 'redo'): EditorState {
  let doc = state.doc;
  const inverted: Step[] = [];
  const applied: Step[] = [];
  for (const step of steps) {
    const result = applyStep(doc, step);
    if (result.failed) continue;
    inverted.unshift(invertStep(step));
    applied.push(step);
    doc = result.doc;
  }
  if (applied.length === 0) return state;
  const event = { steps: inverted };
  const pastBase = kind === 'undo' ? state.past.slice(0, -1) : state.past;
  const futureBase = kind === 'redo' ? state.future.slice(1) : state.future;
  return {
    doc: { ...doc, view: state.doc.view, rev: state.doc.rev + 1 },
    past: kind === 'undo' ? pastBase : [...pastBase, event].slice(-HISTORY_LIMIT),
    future: kind === 'edit' ? [] : kind === 'undo' ? [event, ...futureBase] : futureBase,
    collab: { ...state.collab, unconfirmed: [...state.collab.unconfirmed, ...applied] },
  };
}

export function commit(state: EditorState, next: Document): EditorState {
  const steps = diffSteps(state.doc, next);
  if (steps.length === 0) {
    if (next.view.panX === state.doc.view.panX && next.view.panY === state.doc.view.panY && next.view.zoom === state.doc.view.zoom) {
      return state;
    }
    return { ...state, doc: { ...state.doc, view: next.view } };
  }
  const applied = applyTransaction(state, steps, 'edit');
  return { ...applied, doc: { ...applied.doc, view: next.view } };
}

export function undo(state: EditorState): EditorState {
  const event = state.past[state.past.length - 1];
  if (!event) return state;
  return applyTransaction(state, event.steps, 'undo');
}

export function redo(state: EditorState): EditorState {
  const event = state.future[0];
  if (!event) return state;
  return applyTransaction(state, event.steps, 'redo');
}

export function setTheme(doc: Document, theme: ThemeName): Document {
  return { ...doc, theme };
}

export function setView(doc: Document, view: View): Document {
  return { ...doc, view };
}

export function objectById(doc: Document, id: string): BoardObject | undefined {
  return doc.objects.find((object) => object.id === id);
}

function withObjects(doc: Document, objects: BoardObject[]): Document {
  return { ...doc, objects };
}

export function makeStroke(points: StrokePoint[], props: { tool: 'pen' | 'highlighter'; color: string; size: number; id?: string }): StrokeObj {
  return {
    id: props.id ?? createId(),
    z: 0,
    type: 'stroke',
    tool: props.tool,
    color: props.color,
    size: props.size,
    points: points.map((point) => ({
      x: point.x,
      y: point.y,
      ...(typeof point.pressure === 'number' ? { pressure: point.pressure } : {}),
    })),
  };
}

export function paintOrder(objects: BoardObject[]): BoardObject[] {
  return objects
    .map((object, index) => ({ object, index, z: Number.isFinite(object.z) ? object.z : index }))
    .sort((a, b) => a.z - b.z || a.index - b.index)
    .map((entry) => entry.object);
}

function nextZ(objects: BoardObject[]): number {
  let max = -1;
  for (const object of objects) {
    if (Number.isFinite(object.z) && object.z > max) max = object.z;
  }
  return max + 1;
}

export function addObject(doc: Document, object: BoardObject): Document {
  return withObjects(doc, [...doc.objects, { ...object, z: nextZ(doc.objects) }]);
}

export function commitFreehand(doc: Document, points: StrokePoint[], style: InkStyle & { tool: 'pen' | 'highlighter' }): Document {
  if (points.length === 0) return doc;
  const path = points.length === 1 ? [points[0], { ...points[0], x: points[0].x + 0.01 }] : points;
  if (style.tool === 'pen') {
    const recognized = recognizeShape(path);
    if (recognized) {
      const shape = shapeFromRecognition(recognized, {
        stroke: style.color,
        fill: 'transparent',
        strokeWidth: Math.max(2, style.size * 0.45),
      });
      return addObject(doc, shape);
    }
  }
  return addObject(doc, makeStroke(path, style));
}

function pointNearPath(point: Point, path: Point[], reach: number): boolean {
  return polylineNear([point], path, reach);
}

function spanRun(points: StrokePoint[]): StrokePoint[] {
  if (points.length !== 1) return points;
  const point = points[0];
  return [point, { ...point, x: point.x + 0.01 }];
}

function eraseStroke(object: StrokeObj, eraserPath: Point[], radius: number): StrokeObj[] | null {
  const points = object.points;
  if (points.length === 0) return null;
  const reach = object.size / 2 + radius;
  const erased = points.map((point) => pointNearPath(point, eraserPath, reach));
  const runs: StrokePoint[][] = [];
  let current: StrokePoint[] = [];
  let removed = false;
  let split = false;
  for (let index = 0; index < points.length; index++) {
    if (erased[index]) {
      removed = true;
      if (current.length > 0) {
        runs.push(current);
        current = [];
      }
      continue;
    }
    const previous = current[current.length - 1];
    if (previous && polylineNear([previous, points[index]], eraserPath, reach)) {
      split = true;
      runs.push(current);
      current = [points[index]];
      continue;
    }
    current.push(points[index]);
  }
  if (current.length > 0) runs.push(current);
  if (!removed && !split) return null;
  return runs.map((run, index) => {
    const nextPoints = spanRun(run);
    if (index === 0) return { ...object, points: nextPoints };
    const created = makeStroke(nextPoints, { tool: object.tool, color: object.color, size: object.size });
    return {
      ...created,
      z: object.z + index * 1e-3,
      ...(object.locked ? { locked: object.locked } : {}),
      ...(object.groupId ? { groupId: object.groupId } : {}),
    };
  });
}

function segmentHitsAabb(a: Point, b: Point, minX: number, minY: number, maxX: number, maxY: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: Array<[number, number]> = [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dy, a.y - minY],
    [dy, maxY - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else if (t < t0) {
      return false;
    } else if (t < t1) {
      t1 = t;
    }
  }
  return t0 <= t1;
}

function segmentHitsFrame(a: Point, b: Point, frame: Frame, pad: number): boolean {
  const start = worldToLocal(a, frame);
  const end = worldToLocal(b, frame);
  return segmentHitsAabb(start, end, -frame.width / 2 - pad, -frame.height / 2 - pad, frame.width / 2 + pad, frame.height / 2 + pad);
}

function segmentHitsEllipse(a: Point, b: Point, frame: Frame, pad: number): boolean {
  const start = worldToLocal(a, frame);
  const end = worldToLocal(b, frame);
  const rx = Math.max(frame.width / 2 + pad, 1e-6);
  const ry = Math.max(frame.height / 2 + pad, 1e-6);
  return pointSegmentDistance({ x: 0, y: 0 }, { x: start.x / rx, y: start.y / ry }, { x: end.x / rx, y: end.y / ry }) <= 1;
}

function segmentHitsObject(object: BoardObject, a: Point, b: Point, radius: number, doc: Document): boolean {
  if (object.type === 'connector') {
    const path = connectorPath(doc, object.id);
    if (!path) return false;
    return polylineNear(path, [a, b], object.strokeWidth / 2 + radius);
  }
  if (object.type === 'shape' && (object.kind === 'line' || object.kind === 'arrow')) {
    const [start, end] = lineEndpoints(object);
    return polylineNear([start, end], [a, b], object.strokeWidth / 2 + radius + 4);
  }
  if (object.type === 'shape' && object.kind === 'triangle') {
    const [p, q, r] = triangleVertices(object);
    return polylineNear([p, q, r, p], [a, b], object.strokeWidth / 2 + radius);
  }
  const frame = frameOf(object);
  if (!frame) return false;
  if (object.type === 'shape' && object.kind === 'ellipse') return segmentHitsEllipse(a, b, frame, radius);
  return segmentHitsFrame(a, b, frame, radius);
}

function eraserHits(object: BoardObject, eraserPath: Point[], radius: number, doc: Document): boolean {
  for (let index = 0; index < eraserPath.length; index++) {
    if (hitsObject(object, eraserPath[index], radius, doc)) return true;
    if (index > 0 && segmentHitsObject(object, eraserPath[index - 1], eraserPath[index], radius, doc)) return true;
  }
  return false;
}

export function applyEraser(doc: Document, eraserPath: Point[], radius: number): Document {
  if (eraserPath.length === 0) return doc;
  const objects: BoardObject[] = [];
  let changed = false;
  for (const object of doc.objects) {
    if (object.locked) {
      objects.push(object);
      continue;
    }
    if (object.type === 'stroke') {
      const pieces = eraseStroke(object, eraserPath, radius);
      if (!pieces) objects.push(object);
      else {
        changed = true;
        objects.push(...pieces);
      }
      continue;
    }
    if (eraserHits(object, eraserPath, radius, doc)) {
      changed = true;
      continue;
    }
    objects.push(object);
  }
  return changed ? followAnchors(doc, withObjects(doc, objects)) : doc;
}

export function shapeFromBox(kind: 'rect' | 'ellipse' | 'triangle', a: Point, b: Point, style: ShapeStyle, id = createId()): ShapeObj {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const shape: ShapeObj = {
    id,
    z: 0,
    type: 'shape',
    kind,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width,
    height,
    rotation: 0,
    stroke: style.stroke,
    fill: style.fill,
    strokeWidth: style.strokeWidth,
  };
  if (kind === 'triangle') {
    shape.localVertices = [
      { x: 0, y: -height / 2 },
      { x: width / 2, y: height / 2 },
      { x: -width / 2, y: height / 2 },
    ];
  }
  return shape;
}

export function lineFromPoints(a: Point, b: Point, kind: 'line' | 'arrow', style: ShapeStyle, id = createId()): ShapeObj {
  const width = Math.max(1, dist(a, b));
  return {
    id,
    z: 0,
    type: 'shape',
    kind,
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    width,
    height: 0,
    rotation: Math.atan2(b.y - a.y, b.x - a.x),
    stroke: style.stroke,
    fill: style.fill,
    strokeWidth: style.strokeWidth,
  };
}

export function makeText(props: {
  cx: number;
  cy: number;
  width?: number;
  height?: number;
  text?: string;
  color: string;
  fontSize?: number;
  id?: string;
}): TextObj {
  return {
    id: props.id ?? createId(),
    z: 0,
    type: 'text',
    cx: props.cx,
    cy: props.cy,
    width: props.width ?? 200,
    height: props.height ?? 72,
    rotation: 0,
    text: props.text ?? 'Text',
    color: props.color,
    fontSize: props.fontSize ?? 22,
  };
}

export function makeImage(props: {
  cx: number;
  cy: number;
  width: number;
  height: number;
  mime: string;
  src: string;
  id?: string;
}): ImageObj {
  return {
    id: props.id ?? createId(),
    z: 0,
    type: 'image',
    cx: props.cx,
    cy: props.cy,
    width: props.width,
    height: props.height,
    rotation: 0,
    mime: props.mime,
    src: props.src,
  };
}

export function makeSticky(props: {
  cx: number;
  cy: number;
  width?: number;
  height?: number;
  text?: string;
  fill?: string;
  color?: string;
  fontSize?: number;
  id?: string;
}): StickyObj {
  return {
    id: props.id ?? createId(),
    z: 0,
    type: 'sticky',
    cx: props.cx,
    cy: props.cy,
    width: props.width ?? 200,
    height: props.height ?? 160,
    rotation: 0,
    text: props.text ?? 'Note',
    fill: props.fill ?? '#efe3b0',
    color: props.color ?? '#17324a',
    fontSize: props.fontSize ?? 18,
  };
}

export function makeComment(props: {
  cx: number;
  cy: number;
  color?: string;
  targetId?: string;
  id?: string;
}): CommentObj {
  return {
    id: props.id ?? createId(),
    z: 0,
    type: 'comment',
    cx: props.cx,
    cy: props.cy,
    color: props.color ?? '#c47b16',
    ...(props.targetId ? { targetId: props.targetId } : {}),
    messages: [],
  };
}

export function updateText(doc: Document, id: string, text: string): Document {
  return withObjects(
    doc,
    doc.objects.map((object) =>
      object.id === id && (object.type === 'text' || object.type === 'sticky') ? { ...object, text } : object,
    ),
  );
}

export function appendComment(doc: Document, id: string, message: { text: string; author?: string; at?: number }): Document {
  const text = message.text.trim();
  if (!text) return doc;
  let changed = false;
  const objects = doc.objects.map((object) => {
    if (object.id !== id || object.type !== 'comment' || object.locked) return object;
    changed = true;
    return {
      ...object,
      messages: [
        ...object.messages,
        { id: createId(), text, author: message.author ?? '', at: message.at ?? Date.now() },
      ],
    };
  });
  return changed ? withObjects(doc, objects) : doc;
}

export function setCommentResolved(doc: Document, id: string, resolved: boolean): Document {
  let changed = false;
  const objects = doc.objects.map((object) => {
    if (object.id !== id || object.type !== 'comment' || object.locked || !!object.resolved === resolved) return object;
    changed = true;
    return { ...object, resolved };
  });
  return changed ? withObjects(doc, objects) : doc;
}

export function addConnector(doc: Document, fromId: string, toId: string, style: { color: string; strokeWidth: number }): Document {
  if (fromId === toId) return doc;
  const from = objectById(doc, fromId);
  const to = objectById(doc, toId);
  if (!from || !to || from.type === 'connector' || to.type === 'connector') return doc;
  const connector: ConnectorObj = {
    id: createId(),
    z: 0,
    type: 'connector',
    fromId,
    toId,
    color: style.color,
    strokeWidth: style.strokeWidth,
  };
  return addObject(doc, connector);
}

export function centerOf(object: BoardObject): Point | null {
  if (object.type === 'connector') return null;
  if (object.type === 'stroke') {
    if (object.points.length === 0) return null;
    const box = bboxOf(object.points);
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  }
  return { x: object.cx, y: object.cy };
}

export function frameOf(object: BoardObject): Frame | null {
  if (object.type === 'connector') return null;
  if (object.type === 'comment') {
    return { cx: object.cx, cy: object.cy, width: 28, height: 28, rotation: 0 };
  }
  if (object.type === 'stroke') {
    if (object.points.length === 0) return null;
    const box = bboxOf(object.points);
    const spanX = Math.max(0, box.maxX - box.minX);
    const spanY = Math.max(0, box.maxY - box.minY);
    return {
      cx: (box.minX + box.maxX) / 2,
      cy: (box.minY + box.maxY) / 2,
      width: Math.max(object.size, spanX + object.size),
      height: Math.max(object.size, spanY + object.size),
      rotation: 0,
    };
  }
  return {
    cx: object.cx,
    cy: object.cy,
    width: object.width,
    height: object.height,
    rotation: object.rotation,
  };
}

export function lineEndpoints(shape: ShapeObj): [Point, Point] {
  return [
    localToWorld({ x: -shape.width / 2, y: 0 }, shape),
    localToWorld({ x: shape.width / 2, y: 0 }, shape),
  ];
}

export function triangleVertices(shape: ShapeObj): Point[] {
  const local =
    shape.localVertices && shape.localVertices.length === 3
      ? shape.localVertices
      : [
          { x: 0, y: -shape.height / 2 },
          { x: shape.width / 2, y: shape.height / 2 },
          { x: -shape.width / 2, y: shape.height / 2 },
        ];
  return local.map((point) => localToWorld(point, shape));
}

function borderPoint(frame: Frame, toward: Point, elliptical: boolean): Point {
  const local = worldToLocal(toward, frame);
  const hw = Math.max(frame.width, 1) / 2;
  const hh = Math.max(frame.height, 1) / 2;
  if (Math.abs(local.x) < 1e-6 && Math.abs(local.y) < 1e-6) {
    return localToWorld({ x: hw, y: 0 }, frame);
  }
  let scale: number;
  if (elliptical) {
    scale = 1 / Math.hypot(local.x / hw, local.y / hh);
  } else {
    scale = Math.min(hw / Math.abs(local.x), hh / Math.abs(local.y));
  }
  return localToWorld({ x: local.x * scale, y: local.y * scale }, frame);
}

/** Point where a connector meets an object, on the side facing `toward`. */
export function anchorPoint(object: BoardObject, toward: Point): Point {
  if (object.type === 'shape' && (object.kind === 'line' || object.kind === 'arrow')) {
    const [start, end] = lineEndpoints(object);
    return dist(start, toward) <= dist(end, toward) ? start : end;
  }
  const frame = frameOf(object);
  const center = centerOf(object);
  if (!frame || !center) return toward;
  const elliptical = object.type === 'shape' && object.kind === 'ellipse';
  return borderPoint(frame, toward, elliptical);
}

function pinnedSide(object: BoardObject, side: 'top' | 'right' | 'bottom' | 'left'): Point {
  if (object.type === 'shape' && (object.kind === 'line' || object.kind === 'arrow')) {
    const [start, end] = lineEndpoints(object);
    if (side === 'left') return start;
    if (side === 'right') return end;
    if (side === 'top') return start.y <= end.y ? start : end;
    return end.y >= start.y ? end : start;
  }
  const frame = frameOf(object);
  if (!frame) return centerOf(object) ?? { x: 0, y: 0 };
  const hx = frame.width / 2;
  const hy = frame.height / 2;
  const local =
    side === 'left' ? { x: -hx, y: 0 } : side === 'right' ? { x: hx, y: 0 } : side === 'top' ? { x: 0, y: -hy } : { x: 0, y: hy };
  return localToWorld(local, frame);
}

function anchorOn(object: BoardObject, toward: Point, side: ConnectorObj['fromSide']): Point {
  if (!side || side === 'auto') return anchorPoint(object, toward);
  return pinnedSide(object, side);
}

export function connectorEndpoints(doc: Document, connectorId: string): { from: Point; to: Point } | null {
  const connector = objectById(doc, connectorId);
  if (!connector || connector.type !== 'connector') return null;
  const from = objectById(doc, connector.fromId);
  const to = objectById(doc, connector.toId);
  if (!from || !to) return null;
  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
  if (!fromCenter || !toCenter) return null;
  return {
    from: anchorOn(from, toCenter, connector.fromSide),
    to: anchorOn(to, fromCenter, connector.toSide),
  };
}

function dedupePoints(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    out.push(point);
  }
  return out;
}

function elbowPoints(from: Point, to: Point): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = (from.x + to.x) / 2;
    return dedupePoints([from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]);
  }
  const midY = (from.y + to.y) / 2;
  return dedupePoints([from, { x: from.x, y: midY }, { x: to.x, y: midY }, to]);
}

function curvePoints(from: Point, to: Point): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const push = Math.min(80, length * 0.2);
  if (length === 0) return [from, mid, to];
  return [from, { x: mid.x - (dy / length) * push, y: mid.y + (dx / length) * push }, to];
}

/** Routed geometry. Hit testing, erasing, and export use this, not the straight chord. */
export function connectorPath(doc: Document, connectorId: string): Point[] | null {
  const connector = objectById(doc, connectorId);
  if (!connector || connector.type !== 'connector') return null;
  const ends = connectorEndpoints(doc, connectorId);
  if (!ends) return null;
  const route = connector.route ?? 'straight';
  if (route === 'elbow') return elbowPoints(ends.from, ends.to);
  if (route === 'curve') return curvePoints(ends.from, ends.to);
  return [ends.from, ends.to];
}

function sameFrame(a: Frame, b: Frame): boolean {
  return a.cx === b.cx && a.cy === b.cy && a.width === b.width && a.height === b.height && a.rotation === b.rotation;
}

/**
 * A pin keeps its place on the target through moves, resizes, rotations, and scales.
 * A pin that was transformed itself, or whose target is a connector, stays put.
 */
export function followAnchors(before: Document, after: Document): Document {
  let changed = false;
  const objects = after.objects.map((object) => {
    if (object.type !== 'comment' || object.locked || !object.targetId) return object;
    const previous = objectById(before, object.id);
    if (previous?.type === 'comment' && (previous.cx !== object.cx || previous.cy !== object.cy)) return object;
    const prevTarget = objectById(before, object.targetId);
    const nextTarget = objectById(after, object.targetId);
    if (!prevTarget || !nextTarget || nextTarget.type === 'connector') return object;
    const oldFrame = frameOf(prevTarget);
    const newFrame = frameOf(nextTarget);
    if (!oldFrame || !newFrame || sameFrame(oldFrame, newFrame)) return object;
    const local = worldToLocal({ x: object.cx, y: object.cy }, oldFrame);
    const sx = oldFrame.width === 0 ? 1 : newFrame.width / oldFrame.width;
    const sy = oldFrame.height === 0 ? 1 : newFrame.height / oldFrame.height;
    const world = localToWorld({ x: local.x * sx, y: local.y * sy }, newFrame);
    if (world.x === object.cx && world.y === object.cy) return object;
    changed = true;
    return { ...object, cx: world.x, cy: world.y };
  });
  return changed ? { ...after, objects } : after;
}

function mapSelected(doc: Document, ids: string[], mapper: (object: BoardObject) => BoardObject): Document {
  const selected = new Set(ids);
  return followAnchors(
    doc,
    withObjects(
      doc,
      doc.objects.map((object) => (selected.has(object.id) && !object.locked ? mapper(object) : object)),
    ),
  );
}

function translateObject(object: BoardObject, dx: number, dy: number): BoardObject {
  if (object.type === 'connector') return object;
  if (object.type === 'stroke') {
    return {
      ...object,
      points: object.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
    };
  }
  return { ...object, cx: object.cx + dx, cy: object.cy + dy };
}

export function moveSelection(doc: Document, ids: string[], dx: number, dy: number): Document {
  if (dx === 0 && dy === 0) return doc;
  return mapSelected(doc, ids, (object) => translateObject(object, dx, dy));
}

export function resizeSelection(doc: Document, ids: string[], width: number, height: number): Document {
  return mapSelected(doc, ids, (object) => resizeObject(object, width, height));
}

function pointsShare(points: StrokePoint[], axis: 'x' | 'y'): boolean {
  const first = points[0];
  if (!first) return false;
  return points.every((point) => point[axis] === first[axis]);
}

function resizedStroke(object: StrokeObj, prev: Frame, next: Frame): StrokeObj {
  const sx = prev.width === 0 ? 1 : next.width / prev.width;
  const sy = prev.height === 0 ? 1 : next.height / prev.height;
  const flatX = pointsShare(object.points, 'x');
  const flatY = pointsShare(object.points, 'y');
  let size = object.size;
  if (flatX && flatY) size *= Math.max(sx, sy);
  else if (flatY) size *= sy;
  else if (flatX) size *= sx;
  return {
    ...object,
    size,
    points: object.points.map((point) => ({
      ...point,
      x: next.cx + (point.x - prev.cx) * sx,
      y: next.cy + (point.y - prev.cy) * sy,
    })),
  };
}

function resizeObject(object: BoardObject, width: number, height: number): BoardObject {
  if (object.type === 'connector' || object.type === 'comment') return object;
  const frame = frameOf(object);
  if (!frame) return object;
  const nextWidth = Math.max(1, width);
  const nextHeight = Math.max(object.type === 'shape' && (object.kind === 'line' || object.kind === 'arrow') ? 0 : 1, height);
  if (object.type === 'stroke') {
    return resizedStroke(object, frame, { ...frame, width: nextWidth, height: nextHeight });
  }
  if (object.type === 'shape') {
    const sx = frame.width === 0 ? 1 : nextWidth / frame.width;
    const sy = frame.height === 0 ? 1 : nextHeight / frame.height;
    return {
      ...object,
      width: nextWidth,
      height: nextHeight,
      localVertices: object.localVertices?.map((point) => ({ x: point.x * sx, y: point.y * sy })),
    };
  }
  if (object.type === 'text' || object.type === 'sticky') {
    return { ...object, width: nextWidth, height: nextHeight };
  }
  return { ...object, width: nextWidth, height: nextHeight };
}

export function scaleSelection(doc: Document, ids: string[], factor: number, origin?: Point): Document {
  const selected = doc.objects.filter((object) => ids.includes(object.id) && !object.locked);
  const frames = selected.map(frameOf).filter((frame): frame is Frame => frame !== null);
  const pivot =
    origin ??
    (frames.length
      ? {
          x: frames.reduce((sum, frame) => sum + frame.cx, 0) / frames.length,
          y: frames.reduce((sum, frame) => sum + frame.cy, 0) / frames.length,
        }
      : { x: 0, y: 0 });
  return mapSelected(doc, ids, (object) => scaleObject(object, factor, pivot));
}

function scaleObject(object: BoardObject, factor: number, origin: Point): BoardObject {
  if (object.type === 'connector') return object;
  if (object.type === 'comment') {
    return {
      ...object,
      cx: origin.x + (object.cx - origin.x) * factor,
      cy: origin.y + (object.cy - origin.y) * factor,
    };
  }
  if (object.type === 'stroke') {
    return {
      ...object,
      size: object.size * factor,
      points: object.points.map((point) => ({
        ...point,
        x: origin.x + (point.x - origin.x) * factor,
        y: origin.y + (point.y - origin.y) * factor,
      })),
    };
  }
  const cx = origin.x + (object.cx - origin.x) * factor;
  const cy = origin.y + (object.cy - origin.y) * factor;
  const width = object.width * factor;
  const height = object.height * factor;
  if (object.type === 'shape') {
    return {
      ...object,
      cx,
      cy,
      width,
      height,
      localVertices: object.localVertices?.map((point) => ({ x: point.x * factor, y: point.y * factor })),
    };
  }
  if (object.type === 'text' || object.type === 'sticky') {
    return { ...object, cx, cy, width, height, fontSize: object.fontSize * factor };
  }
  return { ...object, cx, cy, width, height };
}

export function rotateSelection(doc: Document, ids: string[], angle: number, origin?: Point): Document {
  return mapSelected(doc, ids, (object) => {
    const frame = frameOf(object);
    const pivot = origin ?? (frame ? { x: frame.cx, y: frame.cy } : { x: 0, y: 0 });
    return rotateObject(object, angle, pivot);
  });
}

function rotateObject(object: BoardObject, angle: number, origin: Point): BoardObject {
  if (object.type === 'connector') return object;
  if (object.type === 'comment') {
    const dx = object.cx - origin.x;
    const dy = object.cy - origin.y;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { ...object, cx: origin.x + dx * cos - dy * sin, cy: origin.y + dx * sin + dy * cos };
  }
  if (object.type === 'stroke') {
    return {
      ...object,
      points: object.points.map((point) => {
        const dx = point.x - origin.x;
        const dy = point.y - origin.y;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return { ...point, x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
      }),
    };
  }
  const dx = object.cx - origin.x;
  const dy = object.cy - origin.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    ...object,
    cx: origin.x + dx * cos - dy * sin,
    cy: origin.y + dx * sin + dy * cos,
    rotation: object.rotation + angle,
  };
}

export function deleteSelection(doc: Document, ids: string[]): Document {
  const selected = new Set(ids);
  const removed = new Set(doc.objects.filter((object) => selected.has(object.id) && !object.locked).map((object) => object.id));
  if (removed.size === 0) return doc;
  let changed = false;
  const objects: BoardObject[] = [];
  for (const object of doc.objects) {
    if (removed.has(object.id)) {
      changed = true;
      continue;
    }
    if (
      object.type === 'connector' &&
      !object.locked &&
      (removed.has(object.fromId) || removed.has(object.toId))
    ) {
      changed = true;
      continue;
    }
    if (object.type === 'comment' && object.targetId && removed.has(object.targetId)) {
      changed = true;
      const next = { ...object };
      delete next.targetId;
      objects.push(next);
      continue;
    }
    objects.push(object);
  }
  return changed ? withObjects(doc, objects) : doc;
}

export function setLineEndpoint(shape: ShapeObj, which: 'start' | 'end', world: Point): ShapeObj {
  const [start, end] = lineEndpoints(shape);
  const a = which === 'start' ? world : start;
  const b = which === 'end' ? world : end;
  return {
    ...shape,
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    width: Math.max(1, dist(a, b)),
    rotation: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

const HANDLE_SIGNS = {
  nw: [-1, -1],
  ne: [1, -1],
  se: [1, 1],
  sw: [-1, 1],
} as const;

export type BoxHandle = keyof typeof HANDLE_SIGNS;

export function dragHandle(object: BoardObject, handle: BoxHandle, world: Point): BoardObject {
  if (object.locked || object.type === 'connector' || object.type === 'comment') return object;
  const frame = frameOf(object);
  if (!frame) return object;
  const [sx, sy] = HANDLE_SIGNS[handle];
  const fixedLocal = { x: -sx * frame.width / 2, y: -sy * frame.height / 2 };
  const moving = worldToLocal(world, frame);
  const width = Math.max(8, Math.abs(moving.x - fixedLocal.x));
  const height = Math.max(8, Math.abs(moving.y - fixedLocal.y));
  const centerLocal = {
    x: fixedLocal.x + Math.sign(moving.x - fixedLocal.x || sx) * width / 2,
    y: fixedLocal.y + Math.sign(moving.y - fixedLocal.y || sy) * height / 2,
  };
  const center = localToWorld(centerLocal, frame);
  return placeResized(object, frame, { ...frame, cx: center.x, cy: center.y, width, height });
}

function placeResized(object: BoardObject, prev: Frame, next: Frame): BoardObject {
  if (object.type === 'connector') return object;
  const sx = prev.width === 0 ? 1 : next.width / prev.width;
  const sy = prev.height === 0 ? 1 : next.height / prev.height;
  if (object.type === 'stroke') return resizedStroke(object, prev, next);
  if (object.type === 'shape') {
    return {
      ...object,
      cx: next.cx,
      cy: next.cy,
      width: next.width,
      height: next.height,
      rotation: next.rotation,
      localVertices: object.localVertices?.map((point) => ({ x: point.x * sx, y: point.y * sy })),
    };
  }
  if (object.type === 'text' || object.type === 'sticky') {
    return {
      ...object,
      cx: next.cx,
      cy: next.cy,
      width: next.width,
      height: next.height,
      rotation: next.rotation,
    };
  }
  if (object.type === 'comment') return object;
  return {
    ...object,
    cx: next.cx,
    cy: next.cy,
    width: next.width,
    height: next.height,
    rotation: next.rotation,
  };
}

function hitsObject(object: BoardObject, world: Point, pad: number, doc: Document): boolean {
  if (object.type === 'connector') {
    const path = connectorPath(doc, object.id);
    if (!path) return false;
    return polylineNear(path, [world], object.strokeWidth / 2 + pad);
  }
  if (object.type === 'stroke') {
    return polylineNear(object.points, [world], object.size / 2 + pad);
  }
  if (object.type === 'shape' && (object.kind === 'line' || object.kind === 'arrow')) {
    const [start, end] = lineEndpoints(object);
    return polylineNear([start, end], [world], object.strokeWidth / 2 + pad + 4);
  }
  const frame = frameOf(object);
  if (!frame) return false;
  const local = worldToLocal(world, frame);
  if (object.type === 'shape' && object.kind === 'ellipse') {
    const rx = frame.width / 2 + pad;
    const ry = frame.height / 2 + pad;
    return (local.x * local.x) / (rx * rx) + (local.y * local.y) / (ry * ry) <= 1;
  }
  if (object.type === 'shape' && object.kind === 'triangle') {
    const [a, b, c] = triangleVertices(object);
    if (pointInTriangle(world, a, b, c)) return true;
    return polylineNear([a, b, c, a], [world], object.strokeWidth / 2 + pad);
  }
  return Math.abs(local.x) <= frame.width / 2 + pad && Math.abs(local.y) <= frame.height / 2 + pad;
}

export function hitTest(doc: Document, world: Point, pad = 6): BoardObject | null {
  const ordered = paintOrder(doc.objects);
  for (let index = ordered.length - 1; index >= 0; index--) {
    const object = ordered[index];
    if (hitsObject(object, world, pad, doc)) return object;
  }
  return null;
}

export function objectsInRect(doc: Document, a: Point, b: Point): string[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return doc.objects
    .filter((object) => {
      const center = centerOf(object);
      if (center) return center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY;
      if (object.type === 'connector') {
        const path = connectorPath(doc, object.id);
        if (!path) return false;
        return path.some((point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY);
      }
      return false;
    })
    .map((object) => object.id);
}

export function shapeKindForTool(tool: string): ShapeKind | null {
  if (tool === 'rect' || tool === 'ellipse' || tool === 'triangle' || tool === 'line' || tool === 'arrow') return tool;
  return null;
}
