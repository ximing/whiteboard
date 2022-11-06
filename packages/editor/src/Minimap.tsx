import { boundsOf, frameOf, screenToWorld, type Document, type Point, type View } from '@plume/model';
import { useEffect, useRef } from 'react';

const WIDTH = 180;
const HEIGHT = 112;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function viewportBox(view: View, width: number, height: number): Box {
  const origin = screenToWorld({ x: 0, y: 0 }, view);
  const far = screenToWorld({ x: width, y: height }, view);
  return {
    minX: Math.min(origin.x, far.x),
    minY: Math.min(origin.y, far.y),
    maxX: Math.max(origin.x, far.x),
    maxY: Math.max(origin.y, far.y),
  };
}

function union(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function padBox(box: Box, pad: number): Box {
  return { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
}

/** World window covering the objects and the camera, mapped into the minimap. */
function layout(doc: Document, viewport: { width: number; height: number }) {
  const camera = viewportBox(doc.view, viewport.width, viewport.height);
  const content = boundsOf(doc);
  const span = content ? padBox(union(content, camera), 48) : padBox(camera, 48);
  const worldW = Math.max(1, span.maxX - span.minX);
  const worldH = Math.max(1, span.maxY - span.minY);
  const scale = Math.min((WIDTH - 8) / worldW, (HEIGHT - 8) / worldH);
  const ox = (WIDTH - worldW * scale) / 2 - span.minX * scale;
  const oy = (HEIGHT - worldH * scale) / 2 - span.minY * scale;
  const toMap = (point: Point) => ({ x: point.x * scale + ox, y: point.y * scale + oy });
  const toWorld = (x: number, y: number): Point => ({ x: (x - ox) / scale, y: (y - oy) / scale });
  return { toMap, toWorld, camera, scale };
}

export function Minimap({
  doc,
  viewport,
  onView,
}: {
  doc: Document;
  viewport: { width: number; height: number };
  onView: (view: View) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewport.width < 2 || viewport.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = getComputedStyle(canvas).getPropertyValue('--ink').trim() || '#26292f';
    const panel = getComputedStyle(canvas).getPropertyValue('--panel').trim() || '#fdfcf8';
    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#0e7a6d';
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const { toMap, scale, camera } = layout(doc, viewport);
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.55;
    for (const object of doc.objects) {
      if (object.type === 'connector' || object.type === 'comment') continue;
      const frame = frameOf(object);
      if (!frame) continue;
      const at = toMap({ x: frame.cx - frame.width / 2, y: frame.cy - frame.height / 2 });
      ctx.fillRect(at.x, at.y, Math.max(1.5, frame.width * scale), Math.max(1.5, frame.height * scale));
    }
    ctx.globalAlpha = 1;
    for (const object of doc.objects) {
      if (object.type !== 'comment') continue;
      const at = toMap({ x: object.cx, y: object.cy });
      ctx.beginPath();
      ctx.arc(at.x, at.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = object.color;
      ctx.fill();
    }
    const a = toMap({ x: camera.minX, y: camera.minY });
    const b = toMap({ x: camera.maxX, y: camera.maxY });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }, [doc, viewport]);

  function jump(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    const world = layout(doc, viewport).toWorld(x, y);
    onView({
      ...doc.view,
      panX: viewport.width / 2 - world.x * doc.view.zoom,
      panY: viewport.height / 2 - world.y * doc.view.zoom,
    });
  }

  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      data-testid="minimap"
      width={WIDTH}
      height={HEIGHT}
      aria-label="Minimap"
      onPointerDown={(event) => {
        drag.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        jump(event);
      }}
      onPointerMove={(event) => {
        if (drag.current) jump(event);
      }}
      onPointerUp={() => {
        drag.current = false;
      }}
    />
  );
}
