import {
  boundsOf,
  connectorEndpoints,
  connectorPath,
  frameOf,
  lineEndpoints,
  localToWorld,
  paintOrder,
  strokeOutline,
  themeColors,
  worldToScreen,
  type BoardObject,
  type Document,
  type Frame,
  type Point,
  type ShapeObj,
  type View,
} from '@plume/model';

export type Draft =
  | { kind: 'stroke'; tool: 'pen' | 'highlighter'; color: string; size: number; points: { x: number; y: number; pressure?: number }[] }
  | { kind: 'eraser'; points: Point[]; radius: number }
  | { kind: 'shape'; shape: ShapeObj }
  | { kind: 'marquee'; a: Point; b: Point }
  | { kind: 'connector'; from: Point; to: Point; color: string };

export const LASER_LIFE = 1100;

export type LaserPoint = Point & { t: number };

export type RemoteCursor = {
  id: string;
  x: number;
  y: number;
  color: string;
  name?: string;
  trail?: Point[];
  trailAt?: number;
  presenting?: boolean;
  view?: View;
};

const HANDLES = ['nw', 'ne', 'se', 'sw'] as const;

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  options: {
    width: number;
    height: number;
    dpr: number;
    selection: string[];
    draft: Draft | null;
    images: Map<string, HTMLImageElement>;
    cursors?: RemoteCursor[];
    showGrid?: boolean;
    laser?: { points: LaserPoint[]; color: string };
    now?: number;
  },
): void {
  const { width, height, dpr, docView } = { ...options, docView: doc.view };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = themeColors[doc.theme].canvas;
  ctx.fillRect(0, 0, width, height);
  if (options.showGrid !== false) drawGrid(ctx, doc, width, height);

  ctx.setTransform(dpr * docView.zoom, 0, 0, dpr * docView.zoom, dpr * docView.panX, dpr * docView.panY);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const ordered = paintOrder(doc.objects);
  for (const object of ordered) {
    if (object.type !== 'comment') drawObject(ctx, object, doc, options.images);
  }
  for (const object of ordered) {
    if (object.type === 'comment') drawObject(ctx, object, doc, options.images);
  }
  if (options.draft?.kind === 'stroke') {
    drawStroke(ctx, options.draft.points, options.draft.color, options.draft.size, options.draft.tool === 'highlighter');
  }
  if (options.draft?.kind === 'shape') drawShape(ctx, options.draft.shape);
  if (options.draft?.kind === 'connector') {
    ctx.beginPath();
    ctx.moveTo(options.draft.from.x, options.draft.from.y);
    ctx.lineTo(options.draft.to.x, options.draft.to.y);
    ctx.strokeStyle = options.draft.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  if (options.draft?.kind === 'eraser' && options.draft.points.length) {
    const last = options.draft.points[options.draft.points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, options.draft.radius, 0, Math.PI * 2);
    ctx.strokeStyle = themeColors[doc.theme].ink;
    ctx.lineWidth = 1 / docView.zoom;
    ctx.stroke();
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const accent = themeColors[doc.theme].accent;
  if (options.selection.length > 1) drawGroupSelection(ctx, doc, options.selection, accent);
  else {
    for (const id of options.selection) {
      const object = doc.objects.find((item) => item.id === id);
      if (!object) continue;
      drawSelection(ctx, object, doc, accent);
    }
  }
  const now = options.now && options.now > 0 ? options.now : performance.now();
  if (options.laser) drawLaser(ctx, options.laser.points, options.laser.color, now, doc.view);
  for (const cursor of options.cursors ?? []) {
    if (!cursor.trail?.length) continue;
    const at = cursor.trailAt ?? now;
    const points = cursor.trail.map((point, index) => ({
      x: point.x,
      y: point.y,
      t: at - (cursor.trail!.length - 1 - index) * 16,
    }));
    drawLaser(ctx, points, cursor.color, now, doc.view);
  }
  for (const cursor of options.cursors ?? []) drawCursor(ctx, cursor, doc, now);
  if (options.draft?.kind === 'marquee') {
    const a = worldToScreen(options.draft.a, doc.view);
    const b = worldToScreen(options.draft.b, doc.view);
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.restore();
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, doc: Document, width: number, height: number): void {
  const step = 32 * doc.view.zoom;
  if (step < 18) return;
  const ox = ((doc.view.panX % step) + step) % step;
  const oy = ((doc.view.panY % step) + step) % step;
  ctx.beginPath();
  for (let x = ox; x <= width; x += step) {
    for (let y = oy; y <= height; y += step) {
      ctx.moveTo(x + 1, y);
      ctx.arc(x, y, 1, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = themeColors[doc.theme].grid;
  ctx.fill();
}

function drawObject(ctx: CanvasRenderingContext2D, object: BoardObject, doc: Document, images: Map<string, HTMLImageElement>): void {
  switch (object.type) {
    case 'stroke':
      drawStroke(ctx, object.points, object.color, object.size, object.tool === 'highlighter');
      break;
    case 'shape':
      drawShape(ctx, object);
      break;
    case 'text':
      drawText(ctx, object);
      break;
    case 'sticky':
      drawSticky(ctx, object);
      break;
    case 'image':
      drawImageObject(ctx, object, images.get(object.id));
      break;
    case 'connector':
      drawConnector(ctx, doc, object);
      break;
    case 'comment':
      drawComment(ctx, doc, object);
      break;
    default:
      break;
  }
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number; pressure?: number }[],
  color: string,
  size: number,
  highlighter: boolean,
): void {
  const outline = strokeOutline(points, size);
  if (outline.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
  ctx.closePath();
  ctx.fillStyle = highlighter ? hexWithAlpha(color, 0.42) : color;
  ctx.fill();
}

function drawShape(ctx: CanvasRenderingContext2D, shape: ShapeObj): void {
  ctx.save();
  ctx.translate(shape.cx, shape.cy);
  ctx.rotate(shape.rotation);
  ctx.lineWidth = shape.strokeWidth;
  ctx.strokeStyle = shape.stroke;
  ctx.fillStyle = shape.fill;
  if (shape.kind === 'rect') {
    ctx.beginPath();
    ctx.rect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
    paintShape(ctx, shape.fill);
  } else if (shape.kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(0.5, shape.width / 2), Math.max(0.5, shape.height / 2), 0, 0, Math.PI * 2);
    paintShape(ctx, shape.fill);
  } else if (shape.kind === 'triangle') {
    const local = shape.localVertices ?? [
      { x: 0, y: -shape.height / 2 },
      { x: shape.width / 2, y: shape.height / 2 },
      { x: -shape.width / 2, y: shape.height / 2 },
    ];
    ctx.beginPath();
    ctx.moveTo(local[0].x, local[0].y);
    ctx.lineTo(local[1].x, local[1].y);
    ctx.lineTo(local[2].x, local[2].y);
    ctx.closePath();
    paintShape(ctx, shape.fill);
  } else {
    ctx.beginPath();
    ctx.moveTo(-shape.width / 2, 0);
    ctx.lineTo(shape.width / 2, 0);
    ctx.stroke();
    if (shape.kind === 'arrow') {
      const head = Math.max(12, shape.strokeWidth * 4);
      ctx.beginPath();
      ctx.moveTo(shape.width / 2, 0);
      ctx.lineTo(shape.width / 2 - head, head * 0.38);
      ctx.lineTo(shape.width / 2 - head, -head * 0.38);
      ctx.closePath();
      ctx.fillStyle = shape.stroke;
      ctx.fill();
    }
  }
  ctx.restore();
}

function paintShape(ctx: CanvasRenderingContext2D, fill: string): void {
  if (fill !== 'transparent') ctx.fill();
  ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, object: Extract<BoardObject, { type: 'text' }>): void {
  ctx.save();
  ctx.translate(object.cx, object.cy);
  ctx.rotate(object.rotation);
  ctx.beginPath();
  ctx.rect(-object.width / 2, -object.height / 2, object.width, object.height);
  ctx.clip();
  ctx.fillStyle = object.color;
  ctx.font = `${object.bold ? '600 ' : ''}${object.fontSize}px Figtree, sans-serif`;
  ctx.textBaseline = 'top';
  const align = object.align ?? 'left';
  ctx.textAlign = align;
  const lines = wrapText(ctx, object.text, object.width - 8);
  const lineHeight = object.fontSize * 1.25;
  const textX = align === 'center' ? 0 : align === 'right' ? object.width / 2 - 4 : -object.width / 2 + 4;
  lines.forEach((line, index) => {
    ctx.fillText(line, textX, -object.height / 2 + 4 + index * lineHeight);
  });
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const trial = `${line} ${word}`;
      if (ctx.measureText(trial).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawSticky(ctx: CanvasRenderingContext2D, object: Extract<BoardObject, { type: 'sticky' }>): void {
  ctx.save();
  ctx.translate(object.cx, object.cy);
  ctx.rotate(object.rotation);
  roundRect(ctx, -object.width / 2, -object.height / 2, object.width, object.height, 12);
  ctx.fillStyle = object.fill;
  ctx.fill();
  ctx.fillStyle = object.color;
  ctx.font = `${object.fontSize}px Figtree, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const lines = wrapText(ctx, object.text, object.width - 20);
  const lineHeight = object.fontSize * 1.25;
  lines.forEach((line, index) => {
    ctx.fillText(line, -object.width / 2 + 10, -object.height / 2 + 10 + index * lineHeight);
  });
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function commentNumber(doc: Document, id: string): number {
  let count = 0;
  for (const object of paintOrder(doc.objects)) {
    if (object.type !== 'comment') continue;
    count += 1;
    if (object.id === id) return count;
  }
  return count;
}

function drawComment(ctx: CanvasRenderingContext2D, doc: Document, object: Extract<BoardObject, { type: 'comment' }>): void {
  ctx.beginPath();
  ctx.arc(object.cx, object.cy, 12, 0, Math.PI * 2);
  ctx.fillStyle = object.resolved ? hexWithAlpha(object.color, 0.4) : object.color;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '12px Figtree, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(commentNumber(doc, object.id)), object.cx, object.cy + 0.5);
}

function drawImageObject(ctx: CanvasRenderingContext2D, object: Extract<BoardObject, { type: 'image' }>, image: HTMLImageElement | undefined): void {
  ctx.save();
  ctx.translate(object.cx, object.cy);
  ctx.rotate(object.rotation);
  if (image && image.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, -object.width / 2, -object.height / 2, object.width, object.height);
  } else {
    ctx.strokeStyle = '#8ea3b0';
    ctx.strokeRect(-object.width / 2, -object.height / 2, object.width, object.height);
  }
  ctx.restore();
}

function connectorPoints(doc: Document, object: Extract<BoardObject, { type: 'connector' }>): Point[] {
  const routed = connectorPath(doc, object.id);
  if (routed && routed.length >= 2) return routed;
  const ends = connectorEndpoints(doc, object.id);
  return ends ? [ends.from, ends.to] : [];
}

function drawArrowHead(ctx: CanvasRenderingContext2D, from: Point, to: Point, width: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(10, width * 4);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - 0.4), to.y - head * Math.sin(angle - 0.4));
  ctx.lineTo(to.x - head * Math.cos(angle + 0.4), to.y - head * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

function drawConnector(ctx: CanvasRenderingContext2D, doc: Document, object: Extract<BoardObject, { type: 'connector' }>): void {
  const path = connectorPoints(doc, object);
  if (path.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  if ((object.route ?? 'straight') === 'curve' && path.length >= 3) {
    ctx.quadraticCurveTo(path[1].x, path[1].y, path[2].x, path[2].y);
  } else {
    for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
  }
  ctx.strokeStyle = object.color;
  ctx.lineWidth = object.strokeWidth;
  ctx.stroke();
  ctx.fillStyle = object.color;
  const arrow = object.arrow ?? 'end';
  const last = path[path.length - 1];
  const before = path[path.length - 2];
  if (arrow === 'end' || arrow === 'both') drawArrowHead(ctx, before, last, object.strokeWidth);
  if (arrow === 'both') drawArrowHead(ctx, path[1], path[0], object.strokeWidth);
  if (object.label) {
    const mid = path[Math.floor(path.length / 2)];
    ctx.font = '14px Figtree, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(object.label, mid.x, mid.y - 6);
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, object: BoardObject, doc: Document, accent: string): void {
  const handleFill = themeColors[doc.theme].panel;
  if (object.type === 'connector') {
    const path = connectorPoints(doc, object).map((point) => worldToScreen(point, doc.view));
    if (path.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    if ((object.route ?? 'straight') === 'curve' && path.length >= 3) {
      ctx.quadraticCurveTo(path[1].x, path[1].y, path[2].x, path[2].y);
    } else {
      for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    handleSquare(ctx, path[0], accent, handleFill);
    handleSquare(ctx, path[path.length - 1], accent, handleFill);
    return;
  }
  if (object.type === 'comment') {
    const at = worldToScreen({ x: object.cx, y: object.cy }, doc.view);
    ctx.beginPath();
    ctx.arc(at.x, at.y, 16, 0, Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return;
  }
  if (object.type === 'shape' && (object.kind === 'line' || object.kind === 'arrow')) {
    const [start, end] = lineEndpoints(object);
    const a = worldToScreen(start, doc.view);
    const b = worldToScreen(end, doc.view);
    strokeScreenLine(ctx, a, b, accent);
    handleSquare(ctx, a, accent, handleFill);
    handleSquare(ctx, b, accent, handleFill);
    return;
  }
  const handles = selectionHandles(object, doc);
  const corners = handles.filter((handle) => handle.kind !== 'rotate');
  const rotateAt = handles.find((handle) => handle.kind === 'rotate')?.at;
  if (corners.length < 4 || !rotateAt) return;
  ctx.beginPath();
  ctx.moveTo(corners[0].at.x, corners[0].at.y);
  for (const corner of corners.slice(1)) ctx.lineTo(corner.at.x, corner.at.y);
  ctx.closePath();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.stroke();
  for (const corner of corners) handleSquare(ctx, corner.at, accent, handleFill);
  const top = midpoint(corners[0].at, corners[1].at);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(rotateAt.x, rotateAt.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rotateAt.x, rotateAt.y, 5, 0, Math.PI * 2);
  ctx.stroke();
}

function strokeScreenLine(ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function handleSquare(ctx: CanvasRenderingContext2D, point: Point, color: string, fill = '#fdfcf8'): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.fillRect(point.x - 4, point.y - 4, 8, 8);
  ctx.strokeRect(point.x - 4, point.y - 4, 8, 8);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function frameCorners(frame: Frame): Point[] {
  const hw = frame.width / 2;
  const hh = frame.height / 2;
  return [
    localToWorld({ x: -hw, y: -hh }, frame),
    localToWorld({ x: hw, y: -hh }, frame),
    localToWorld({ x: hw, y: hh }, frame),
    localToWorld({ x: -hw, y: hh }, frame),
  ];
}

export type HandleHit = 'nw' | 'ne' | 'se' | 'sw' | 'rotate' | 'start' | 'end';

export function frameHandles(frame: Frame, doc: Document): { kind: HandleHit; at: Point }[] {
  const corners = frameCorners(frame).map((point) => worldToScreen(point, doc.view));
  const top = midpoint(corners[0], corners[1]);
  return [
    ...HANDLES.map((kind, index) => ({ kind, at: corners[index] })),
    { kind: 'rotate' as const, at: { x: top.x, y: top.y - 22 } },
  ];
}

export function hitFrameHandle(frame: Frame, doc: Document, screen: Point, radius = 8): HandleHit | null {
  for (const handle of frameHandles(frame, doc)) {
    const limit = handle.kind === 'rotate' ? radius + 2 : radius;
    if (Math.hypot(screen.x - handle.at.x, screen.y - handle.at.y) <= limit) return handle.kind;
  }
  return null;
}

function drawGroupSelection(ctx: CanvasRenderingContext2D, doc: Document, ids: string[], accent: string): void {
  const box = boundsOf(doc, ids);
  if (!box) return;
  const frame: Frame = {
    cx: (box.minX + box.maxX) / 2,
    cy: (box.minY + box.maxY) / 2,
    width: Math.max(1, box.maxX - box.minX),
    height: Math.max(1, box.maxY - box.minY),
    rotation: 0,
  };
  const handles = frameHandles(frame, doc);
  const corners = handles.filter((handle) => handle.kind !== 'rotate');
  const rotateAt = handles.find((handle) => handle.kind === 'rotate')?.at;
  if (corners.length < 4 || !rotateAt) return;
  ctx.beginPath();
  ctx.moveTo(corners[0].at.x, corners[0].at.y);
  for (const corner of corners.slice(1)) ctx.lineTo(corner.at.x, corner.at.y);
  ctx.closePath();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.stroke();
  for (const corner of corners) handleSquare(ctx, corner.at, accent, themeColors[doc.theme].panel);
  const top = midpoint(corners[0].at, corners[1].at);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(rotateAt.x, rotateAt.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rotateAt.x, rotateAt.y, 5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawLaser(ctx: CanvasRenderingContext2D, points: LaserPoint[], color: string, now: number, view: View): void {
  const alive = points.filter((point) => now - point.t < LASER_LIFE && now - point.t >= 0);
  if (!alive.length) return;
  const screen = alive.map((point) => ({ ...worldToScreen(point, view), t: point.t }));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let index = 1; index < screen.length; index += 1) {
    const age = now - screen[index].t;
    const alpha = Math.max(0, 1 - age / LASER_LIFE);
    ctx.beginPath();
    ctx.moveTo(screen[index - 1].x, screen[index - 1].y);
    ctx.lineTo(screen[index].x, screen[index].y);
    ctx.strokeStyle = hexWithAlpha(color, 0.28 * alpha);
    ctx.lineWidth = 14 * alpha + 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(screen[index - 1].x, screen[index - 1].y);
    ctx.lineTo(screen[index].x, screen[index].y);
    ctx.strokeStyle = hexWithAlpha(color, 0.95 * alpha);
    ctx.lineWidth = 2.5 * alpha + 1;
    ctx.stroke();
  }
  const head = screen[screen.length - 1];
  const headAlpha = Math.max(0, 1 - (now - head.t) / LASER_LIFE);
  ctx.beginPath();
  ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = hexWithAlpha(color, headAlpha);
  ctx.fill();
  ctx.restore();
}

function drawCursor(ctx: CanvasRenderingContext2D, cursor: RemoteCursor, doc: Document, now: number): void {
  const trailAt = cursor.trailAt ?? now;
  const laserOn = !!(cursor.trail && cursor.trail.length > 1 && now - trailAt < LASER_LIFE);
  const at = worldToScreen(cursor, doc.view);
  if (!laserOn) {
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4.5, 12.5);
    ctx.lineTo(8, 18);
    ctx.lineTo(10.5, 17);
    ctx.lineTo(7, 11.5);
    ctx.lineTo(12, 11);
    ctx.closePath();
    ctx.fillStyle = cursor.color;
    ctx.fill();
    ctx.restore();
  }
  if (!cursor.name) return;
  ctx.save();
  ctx.font = '12px Figtree, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const width = ctx.measureText(cursor.name).width + 12;
  ctx.fillStyle = cursor.color;
  ctx.fillRect(at.x + 14, at.y + 16, width, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(cursor.name, at.x + 20, at.y + 19);
  ctx.restore();
}

export function selectionHandles(object: BoardObject, doc: Document): { kind: HandleHit; at: Point }[] {
  if (object.type === 'comment') return [];
  if (object.type === 'connector') {
    const path = connectorPoints(doc, object);
    if (path.length < 2) return [];
    return [
      { kind: 'start', at: worldToScreen(path[0], doc.view) },
      { kind: 'end', at: worldToScreen(path[path.length - 1], doc.view) },
    ];
  }
  if (object.type === 'shape' && (object.kind === 'line' || object.kind === 'arrow')) {
    const [start, end] = lineEndpoints(object).map((point) => worldToScreen(point, doc.view));
    return [
      { kind: 'start', at: start },
      { kind: 'end', at: end },
    ];
  }
  const frame = frameOf(object);
  if (!frame) return [];
  const corners = frameCorners(frame).map((point) => worldToScreen(point, doc.view));
  const top = midpoint(corners[0], corners[1]);
  return [
    ...HANDLES.map((kind, index) => ({ kind, at: corners[index] })),
    { kind: 'rotate' as const, at: { x: top.x, y: top.y - 22 } },
  ];
}

export function hitHandle(object: BoardObject, doc: Document, screen: Point, radius = 8): HandleHit | null {
  for (const handle of selectionHandles(object, doc)) {
    const limit = handle.kind === 'rotate' ? radius + 2 : radius;
    if (Math.hypot(screen.x - handle.at.x, screen.y - handle.at.y) <= limit) return handle.kind;
  }
  return null;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

