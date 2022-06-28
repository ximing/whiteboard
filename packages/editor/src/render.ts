import {
  connectorEndpoints,
  frameOf,
  lineEndpoints,
  localToWorld,
  strokeOutline,
  themeColors,
  worldToScreen,
  type BoardObject,
  type Document,
  type Frame,
  type Point,
  type ShapeObj,
} from '@plume/model';

export type Draft =
  | { kind: 'stroke'; tool: 'pen' | 'highlighter'; color: string; size: number; points: { x: number; y: number; pressure?: number }[] }
  | { kind: 'eraser'; points: Point[]; radius: number }
  | { kind: 'shape'; shape: ShapeObj }
  | { kind: 'marquee'; a: Point; b: Point };

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
  },
): void {
  const { width, height, dpr, docView } = { ...options, docView: doc.view };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = themeColors[doc.theme].canvas;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, doc, width, height);

  ctx.setTransform(dpr * docView.zoom, 0, 0, dpr * docView.zoom, dpr * docView.panX, dpr * docView.panY);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const object of doc.objects) drawObject(ctx, object, doc, options.images);
  if (options.draft?.kind === 'stroke') {
    drawStroke(ctx, options.draft.points, options.draft.color, options.draft.size, options.draft.tool === 'highlighter');
  }
  if (options.draft?.kind === 'shape') drawShape(ctx, options.draft.shape);
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
  for (const id of options.selection) {
    const object = doc.objects.find((item) => item.id === id);
    if (!object) continue;
    drawSelection(ctx, object, doc, accent);
  }
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
    case 'image':
      drawImageObject(ctx, object, images.get(object.id));
      break;
    case 'connector':
      drawConnector(ctx, doc, object.id, object.color, object.strokeWidth);
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
  ctx.font = `${object.fontSize}px Figtree, sans-serif`;
  ctx.textBaseline = 'top';
  const lines = wrapText(ctx, object.text, object.width - 8);
  const lineHeight = object.fontSize * 1.25;
  lines.forEach((line, index) => {
    ctx.fillText(line, -object.width / 2 + 4, -object.height / 2 + 4 + index * lineHeight);
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

function drawConnector(ctx: CanvasRenderingContext2D, doc: Document, id: string, color: string, width: number): void {
  const ends = connectorEndpoints(doc, id);
  if (!ends) return;
  ctx.beginPath();
  ctx.moveTo(ends.from.x, ends.from.y);
  ctx.lineTo(ends.to.x, ends.to.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  for (const point of [ends.from, ends.to]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(3, width), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, object: BoardObject, doc: Document, accent: string): void {
  const handleFill = themeColors[doc.theme].panel;
  if (object.type === 'connector') {
    const ends = connectorEndpoints(doc, object.id);
    if (!ends) return;
    strokeScreenLine(ctx, worldToScreen(ends.from, doc.view), worldToScreen(ends.to, doc.view), accent);
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

export function selectionHandles(object: BoardObject, doc: Document): { kind: HandleHit; at: Point }[] {
  if (object.type === 'connector') return [];
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

