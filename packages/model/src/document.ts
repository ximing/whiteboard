import { bboxOf, dist, localToWorld, pointInTriangle, polylineNear, worldToLocal } from './geometry';
import { createId } from './id';
import { recognizeShape, shapeFromRecognition } from './recognize';
import { diffSteps, invertStep, applyStep } from './step';
import type {
  BoardObject,
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

export function addObject(doc: Document, object: BoardObject): Document {
  return withObjects(doc, [...doc.objects, object]);
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

export function applyEraser(doc: Document, eraserPath: Point[], radius: number): Document {
  if (eraserPath.length === 0) return doc;
  const objects = doc.objects.filter((object) => {
    if (object.type !== 'stroke') return true;
    const reach = object.size / 2 + radius;
    return !polylineNear(object.points, eraserPath, reach);
  });
  return objects.length === doc.objects.length ? doc : withObjects(doc, objects);
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
  dataUrl: string;
  id?: string;
}): ImageObj {
  return {
    id: props.id ?? createId(),
    type: 'image',
    cx: props.cx,
    cy: props.cy,
    width: props.width,
    height: props.height,
    rotation: 0,
    mime: props.mime,
    dataUrl: props.dataUrl,
  };
}

export function updateText(doc: Document, id: string, text: string): Document {
  return withObjects(
    doc,
    doc.objects.map((object) => (object.id === id && object.type === 'text' ? { ...object, text } : object)),
  );
}

export function addConnector(doc: Document, fromId: string, toId: string, style: { color: string; strokeWidth: number }): Document {
  if (fromId === toId) return doc;
  const from = objectById(doc, fromId);
  const to = objectById(doc, toId);
  if (!from || !to || from.type === 'connector' || to.type === 'connector') return doc;
  const connector: ConnectorObj = {
    id: createId(),
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
    from: anchorPoint(from, toCenter),
    to: anchorPoint(to, fromCenter),
  };
}

function mapSelected(doc: Document, ids: string[], mapper: (object: BoardObject) => BoardObject): Document {
  const selected = new Set(ids);
  return withObjects(
    doc,
    doc.objects.map((object) => (selected.has(object.id) ? mapper(object) : object)),
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
  if (object.type === 'connector') return object;
  const frame = frameOf(object);
  if (!frame) return object;
  const nextWidth = Math.max(1, width);
  const nextHeight = Math.max(object.type === 'shape' && (object.kind === 'line' || object.kind === 'arrow') ? 0 : 1, height);
  if (object.type === 'stroke') {
    return resizedStroke(object, frame, { ...frame, width: nextWidth, height: nextHeight });
  }
  const sx = frame.width === 0 ? 1 : nextWidth / frame.width;
  const sy = frame.height === 0 ? 1 : nextHeight / frame.height;
  if (object.type === 'shape') {
    return {
      ...object,
      width: nextWidth,
      height: nextHeight,
      localVertices: object.localVertices?.map((point) => ({ x: point.x * sx, y: point.y * sy })),
    };
  }
  if (object.type === 'text') {
    return { ...object, width: nextWidth, height: nextHeight, fontSize: object.fontSize * sy };
  }
  return { ...object, width: nextWidth, height: nextHeight };
}

export function scaleSelection(doc: Document, ids: string[], factor: number, origin?: Point): Document {
  const selected = doc.objects.filter((object) => ids.includes(object.id));
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
  if (object.type === 'text') return { ...object, cx, cy, width, height, fontSize: object.fontSize * factor };
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
  return withObjects(
    doc,
    doc.objects.filter((object) => {
      if (selected.has(object.id)) return false;
      if (object.type === 'connector' && (selected.has(object.fromId) || selected.has(object.toId))) return false;
      return true;
    }),
  );
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
  if (object.type === 'connector') return object;
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
  if (object.type === 'text') {
    return {
      ...object,
      cx: next.cx,
      cy: next.cy,
      width: next.width,
      height: next.height,
      rotation: next.rotation,
      fontSize: Math.max(8, object.fontSize * sy),
    };
  }
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
    const ends = connectorEndpoints(doc, object.id);
    if (!ends) return false;
    return polylineNear([ends.from, ends.to], [world], object.strokeWidth / 2 + pad);
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
  for (let index = doc.objects.length - 1; index >= 0; index--) {
    const object = doc.objects[index];
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
        const ends = connectorEndpoints(doc, object.id);
        if (!ends) return false;
        return [ends.from, ends.to].some((point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY);
      }
      return false;
    })
    .map((object) => object.id);
}

export function shapeKindForTool(tool: string): ShapeKind | null {
  if (tool === 'rect' || tool === 'ellipse' || tool === 'triangle' || tool === 'line' || tool === 'arrow') return tool;
  return null;
}
