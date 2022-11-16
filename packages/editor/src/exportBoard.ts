import { boundsOf, connectorPath, fitView, paintOrder, strokeOutline, type BoardObject, type Document } from '@plume/model';
import { renderBoard } from './render';

function download(filename: string, href: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

async function loadImages(doc: Document): Promise<Map<string, HTMLImageElement>> {
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    doc.objects.map(async (object) => {
      if (object.type !== 'image' || !object.src) return;
      const image = new Image();
      if (!object.src.startsWith('data:')) image.crossOrigin = 'anonymous';
      image.src = object.src;
      await image.decode().catch(() => undefined);
      if (image.complete && image.naturalWidth > 0) images.set(object.id, image);
    }),
  );
  return images;
}

/** PNG of the whole board, fitted with a margin. Remote images need CORS or they are left as frames. */
export async function downloadBoardPng(doc: Document, showGrid = true): Promise<void> {
  const width = 1600;
  const height = 1000;
  const bounds = boundsOf(doc);
  const view = bounds ? fitView({ width, height }, bounds, 72) : doc.view;
  const fitted: Document = { ...doc, view };
  const images = await loadImages(fitted);
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  renderBoard(ctx, fitted, { width, height, dpr: 2, selection: [], draft: null, images, showGrid });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'));
  if (!blob) return;
  download('plume.png', URL.createObjectURL(blob));
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function subset(doc: Document, ids?: string[]): Document {
  if (!ids?.length) return doc;
  const picked = new Set(ids);
  return {
    ...doc,
    objects: doc.objects.filter((object) => {
      if (picked.has(object.id)) return true;
      return object.type === 'connector' && picked.has(object.fromId) && picked.has(object.toId);
    }),
  };
}

function wrapLines(text: string, fontSize: number, bold: boolean, maxWidth: number): string[] {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.font = `${bold ? '600 ' : ''}${fontSize}px Figtree, sans-serif`;
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
      const width = ctx ? ctx.measureText(trial).width : trial.length * fontSize * 0.5;
      if (width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = trial;
    }
    lines.push(line);
  }
  return lines;
}

function textBlock(text: string, x: number, y: number, fontSize: number, bold: boolean, fill: string, anchor: string, maxWidth: number): string {
  const lines = wrapLines(text, fontSize, bold, maxWidth);
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : fontSize * 1.25}">${escapeXml(line) || ' '}</tspan>`)
    .join('');
  return `<text x="${x}" y="${y}" fill="${escapeXml(fill)}" font-size="${fontSize}" font-weight="${bold ? 600 : 400}" text-anchor="${anchor}" font-family="Figtree, sans-serif">${tspans}</text>`;
}

function rotation(cx: number, cy: number, angle: number): string {
  if (!angle) return '';
  return ` transform="rotate(${(angle * 180) / Math.PI} ${cx} ${cy})"`;
}

function objectSvg(object: BoardObject, doc: Document): string {
  if (object.type === 'stroke') {
    const outline = strokeOutline(object.points, object.size);
    if (outline.length < 3) return '';
    const points = outline.map((point) => `${point[0]},${point[1]}`).join(' ');
    const opacity = object.tool === 'highlighter' ? 0.42 : 1;
    return `<polygon points="${points}" fill="${escapeXml(object.color)}" opacity="${opacity}"/>`;
  }
  if (object.type === 'text') {
    const align = object.align ?? 'left';
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const x = align === 'center' ? object.cx : align === 'right' ? object.cx + object.width / 2 - 4 : object.cx - object.width / 2 + 4;
    const y = object.cy - object.height / 2 + object.fontSize;
    return `<g${rotation(object.cx, object.cy, object.rotation)}>${textBlock(object.text, x, y, object.fontSize, !!object.bold, object.color, anchor, object.width - 8)}</g>`;
  }
  if (object.type === 'sticky') {
    const x = object.cx - object.width / 2;
    const y = object.cy - object.height / 2;
    const body = textBlock(object.text, x + 10, y + object.fontSize + 4, object.fontSize, false, object.color, 'start', object.width - 20);
    return `<g${rotation(object.cx, object.cy, object.rotation)}><rect x="${x}" y="${y}" width="${object.width}" height="${object.height}" rx="12" fill="${escapeXml(object.fill)}"/>${body}</g>`;
  }
  if (object.type === 'image') {
    const x = object.cx - object.width / 2;
    const y = object.cy - object.height / 2;
    return `<image href="${escapeXml(object.src)}" x="${x}" y="${y}" width="${object.width}" height="${object.height}"${rotation(object.cx, object.cy, object.rotation)}/>`;
  }
  if (object.type === 'comment') {
    const count = paintOrder(doc.objects).filter((item) => item.type === 'comment').findIndex((item) => item.id === object.id) + 1;
    const opacity = object.resolved ? 0.4 : 1;
    const note = object.messages[0]?.text;
    const label = note ? textBlock(note, object.cx + 18, object.cy + 4, 13, false, object.color, 'start', 180) : '';
    return `<g opacity="${opacity}"><circle cx="${object.cx}" cy="${object.cy}" r="12" fill="${escapeXml(object.color)}"/><text x="${object.cx}" y="${object.cy + 4}" fill="#ffffff" font-size="12" text-anchor="middle" font-family="Figtree, sans-serif">${count}</text>${label}</g>`;
  }
  if (object.type === 'connector') {
    const path = connectorPath(doc, object.id);
    if (!path || path.length < 2) return '';
    const route = object.route ?? 'straight';
    const d =
      route === 'curve' && path.length >= 3
        ? `M ${path[0].x} ${path[0].y} Q ${path[1].x} ${path[1].y} ${path[2].x} ${path[2].y}`
        : `M ${path.map((point) => `${point.x} ${point.y}`).join(' L ')}`;
    const arrow = object.arrow ?? 'end';
    const marker =
      arrow === 'both' ? ' marker-start="url(#arrow)" marker-end="url(#arrow)"' : arrow === 'end' ? ' marker-end="url(#arrow)"' : '';
    const mid = path[Math.floor(path.length / 2)];
    const label = object.label
      ? `<text x="${mid.x}" y="${mid.y - 6}" fill="${escapeXml(object.color)}" font-size="14" text-anchor="middle" font-family="Figtree, sans-serif">${escapeXml(object.label)}</text>`
      : '';
    return `<path d="${d}" fill="none" stroke="${escapeXml(object.color)}" stroke-width="${object.strokeWidth}"${marker}/>${label}`;
  }
  if (object.kind === 'line' || object.kind === 'arrow') {
    const x1 = object.cx - Math.cos(object.rotation) * object.width / 2;
    const y1 = object.cy - Math.sin(object.rotation) * object.width / 2;
    const x2 = object.cx + Math.cos(object.rotation) * object.width / 2;
    const y2 = object.cy + Math.sin(object.rotation) * object.width / 2;
    const marker = object.kind === 'arrow' ? ' marker-end="url(#arrow)"' : '';
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeXml(object.stroke)}" stroke-width="${object.strokeWidth}"${marker}/>`;
  }
  const x = object.cx - object.width / 2;
  const y = object.cy - object.height / 2;
  const transform = rotation(object.cx, object.cy, object.rotation);
  const fill = object.fill === 'transparent' ? 'none' : object.fill;
  if (object.kind === 'ellipse') {
    return `<ellipse cx="${object.cx}" cy="${object.cy}" rx="${object.width / 2}" ry="${object.height / 2}" fill="${escapeXml(fill)}" stroke="${escapeXml(object.stroke)}" stroke-width="${object.strokeWidth}"${transform}/>`;
  }
  if (object.kind === 'triangle') {
    const local = object.localVertices ?? [
      { x: 0, y: -object.height / 2 },
      { x: object.width / 2, y: object.height / 2 },
      { x: -object.width / 2, y: object.height / 2 },
    ];
    const poly = local.map((point) => `${object.cx + point.x},${object.cy + point.y}`).join(' ');
    return `<polygon points="${poly}" fill="${escapeXml(fill)}" stroke="${escapeXml(object.stroke)}" stroke-width="${object.strokeWidth}"${transform}/>`;
  }
  return `<rect x="${x}" y="${y}" width="${object.width}" height="${object.height}" fill="${escapeXml(fill)}" stroke="${escapeXml(object.stroke)}" stroke-width="${object.strokeWidth}"${transform}/>`;
}

/** Vector snapshot. Pass ids to export that selection, including connectors between them. */
export function downloadBoardSvg(doc: Document, ids?: string[]): void {
  const board = subset(doc, ids);
  const bounds = boundsOf(board) ?? { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  const pad = 32;
  const minX = bounds.minX - pad;
  const minY = bounds.minY - pad;
  const width = Math.max(1, bounds.maxX - bounds.minX + pad * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + pad * 2);
  const ordered = paintOrder(board.objects);
  const body = [...ordered.filter((object) => object.type !== 'comment'), ...ordered.filter((object) => object.type === 'comment')]
    .map((object) => objectSvg(object, board))
    .join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6" fill="context-stroke"/></marker></defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${doc.theme === 'dark' ? '#1b1d20' : '#f6f4ee'}"/>${body}</svg>`;
  download(ids?.length ? 'plume-selection.svg' : 'plume.svg', URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
}
