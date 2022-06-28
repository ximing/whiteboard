import {
  addConnector,
  addObject,
  applyEraser,
  centerOf,
  commitFreehand,
  createId,
  dist,
  dragHandle,
  hitTest,
  lineFromPoints,
  makeText,
  moveSelection,
  normalizePointerType,
  objectById,
  objectsInRect,
  panView,
  rotateSelection,
  routePointer,
  screenToWorld,
  setLineEndpoint,
  setView,
  shapeFromBox,
  shapeKindForTool,
  zoomView,
  type BoardObject,
  type BoxHandle,
  type Document,
  type Point,
  type ShapeKind,
  type StrokePoint,
  type Tool,
  type View,
} from '@plume/model';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hitHandle, renderBoard, type Draft } from './render';

type ChangeMode = 'transient' | 'commit' | 'view';

type PointerSample = { x: number; y: number; type: 'pen' | 'mouse' | 'touch' };

type Gesture =
  | { type: 'draw'; tool: 'pen' | 'highlighter'; points: StrokePoint[] }
  | { type: 'erase'; points: Point[]; base: Document }
  | { type: 'pan'; x: number; y: number }
  | { type: 'pinch'; dist: number; mid: Point; view: View }
  | { type: 'shape'; kind: ShapeKind; origin: Point }
  | { type: 'move'; ids: string[]; origin: Point; base: Document }
  | { type: 'marquee'; origin: Point; baseIds: string[]; additive: boolean }
  | { type: 'resize'; id: string; handle: BoxHandle; base: Document }
  | { type: 'endpoint'; id: string; which: 'start' | 'end'; base: Document }
  | { type: 'rotate'; id: string; center: Point; start: number; base: Document }
  | { type: 'text'; world: Point }
  | { type: 'edit-text'; id: string };

export function Board({
  doc,
  selection,
  tool,
  color,
  size,
  eraserSize,
  onChange,
  onSelection,
  onEditText,
}: {
  doc: Document;
  selection: string[];
  tool: Tool;
  color: string;
  size: number;
  eraserSize: number;
  onChange: (doc: Document, mode: ChangeMode, base?: Document) => void;
  onSelection: (ids: string[]) => void;
  onEditText: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef(doc);
  const selectionRef = useRef(selection);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  const eraserRef = useRef(eraserSize);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, PointerSample>());
  const connectorFrom = useRef<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const [imageRev, setImageRev] = useState(0);
  const [viewport, setViewport] = useState(() => readViewport());

  docRef.current = doc;
  selectionRef.current = selection;
  toolRef.current = tool;
  colorRef.current = color;
  sizeRef.current = size;
  eraserRef.current = eraserSize;
  draftRef.current = draft;

  useEffect(() => {
    let pending = false;
    for (const object of doc.objects) {
      if (object.type !== 'image' || !object.dataUrl || images.current.has(object.id)) continue;
      const image = new Image();
      image.onload = () => setImageRev((value) => value + 1);
      image.src = object.dataUrl;
      images.current.set(object.id, image);
      pending = true;
    }
    if (pending) setImageRev((value) => value + 1);
  }, [doc]);

  useEffect(() => {
    const sync = () => {
      const parent = canvasRef.current?.parentElement;
      const next = {
        w: parent && parent.clientWidth > 2 ? parent.clientWidth : document.documentElement.clientWidth,
        h: parent && parent.clientHeight > 2 ? parent.clientHeight : document.documentElement.clientHeight,
        dpr: window.devicePixelRatio || 1,
      };
      setViewport((prev) => (prev.w === next.w && prev.h === next.h && prev.dpr === next.dpr ? prev : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    const parent = canvasRef.current?.parentElement;
    if (parent) observer.observe(parent);
    window.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('resize', sync);
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewport.w < 2 || viewport.h < 2) return;
    canvas.width = Math.round(viewport.w * viewport.dpr);
    canvas.height = Math.round(viewport.h * viewport.dpr);
    canvas.style.width = `${viewport.w}px`;
    canvas.style.height = `${viewport.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderBoard(ctx, doc, {
      width: viewport.w,
      height: viewport.h,
      dpr: viewport.dpr,
      selection,
      draft,
      images: images.current,
    });
    canvas.dataset.ready = 'true';
  }, [doc, draft, imageRev, selection, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const screen = localPoint(canvas, event.clientX, event.clientY);
      const current = docRef.current;
      const zooming = event.ctrlKey || event.metaKey;
      const view = zooming
        ? zoomView(current.view, screen, Math.exp(-event.deltaY * 0.002))
        : panView(current.view, -event.deltaX, -event.deltaY);
      onChange(setView(current, view), 'view');
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onChange]);

  function publish(next: Document, mode: ChangeMode, base?: Document) {
    docRef.current = next;
    onChange(next, mode, base);
  }

  function screenFromClient(clientX: number, clientY: number): Point {
    const canvas = canvasRef.current!;
    return localPoint(canvas, clientX, clientY);
  }

  function worldFromClient(clientX: number, clientY: number): Point {
    return screenToWorld(screenFromClient(clientX, clientY), docRef.current.view);
  }

  function begin(mode: Gesture) {
    gesture.current = mode;
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerType = normalizePointerType(event.pointerType);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY, type: pointerType });
    const touches = [...pointers.current.values()].filter((pointer) => pointer.type === 'touch');
    if (touches.length >= 2) {
      startPinch(touches);
      return;
    }
    const action = routePointer({
      pointerType,
      tool: toolRef.current,
      pointerCount: pointers.current.size,
      button: event.button,
    });
    if (action === 'pan') {
      begin({ type: 'pan', x: event.clientX, y: event.clientY });
      return;
    }
    const world = worldFromClient(event.clientX, event.clientY);
    const screen = screenFromClient(event.clientX, event.clientY);
    if (action === 'draw') {
      const toolName = toolRef.current === 'highlighter' ? 'highlighter' : 'pen';
      const point = readPoint(event.nativeEvent);
      begin({ type: 'draw', tool: toolName, points: [point] });
      setDraft({ kind: 'stroke', tool: toolName, color: colorRef.current, size: sizeRef.current, points: [point] });
      return;
    }
    if (action === 'erase') {
      begin({ type: 'erase', points: [world], base: docRef.current });
      setDraft({ kind: 'eraser', points: [world], radius: eraserRef.current });
      return;
    }
    if (action === 'shape') {
      const kind = shapeKindForTool(toolRef.current);
      if (!kind) return;
      begin({ type: 'shape', kind, origin: world });
      return;
    }
    if (action === 'text') {
      const hit = hitTest(docRef.current, world);
      if (hit?.type === 'text') begin({ type: 'edit-text', id: hit.id });
      else begin({ type: 'text', world });
      return;
    }
    if (action === 'connector') {
      const hit = hitTest(docRef.current, world);
      if (!hit || hit.type === 'connector') {
        connectorFrom.current = null;
        return;
      }
      if (!connectorFrom.current) {
        connectorFrom.current = hit.id;
        onSelection([hit.id]);
        return;
      }
      if (connectorFrom.current !== hit.id) {
        publish(
          addConnector(docRef.current, connectorFrom.current, hit.id, { color: colorRef.current, strokeWidth: 2.5 }),
          'commit',
        );
      }
      connectorFrom.current = null;
      return;
    }
    if (action === 'select') {
      if (selectionRef.current.length === 1) {
        const selected = objectById(docRef.current, selectionRef.current[0]);
        const handle = selected ? hitHandle(selected, docRef.current, screen) : null;
        if (!selected || !handle) {
          /* Fall through to object hit testing. */
        } else if (handle === 'rotate') {
          const center = centerOf(selected) ?? world;
          begin({
            type: 'rotate',
            id: selected.id,
            center,
            start: Math.atan2(world.y - center.y, world.x - center.x),
            base: docRef.current,
          });
          return;
        } else if (handle === 'start' || handle === 'end') {
          begin({ type: 'endpoint', id: selected.id, which: handle, base: docRef.current });
          return;
        } else {
          begin({ type: 'resize', id: selected.id, handle, base: docRef.current });
          return;
        }
      }
      const hit = hitTest(docRef.current, world);
      if (hit?.type === 'text' && event.detail === 2) {
        onSelection([hit.id]);
        begin({ type: 'edit-text', id: hit.id });
        return;
      }
      if (hit) {
        const already = selectionRef.current.includes(hit.id);
        const ids = event.shiftKey
          ? already
            ? selectionRef.current.filter((id) => id !== hit.id)
            : [...selectionRef.current, hit.id]
          : already
            ? selectionRef.current
            : [hit.id];
        onSelection(ids);
        begin({ type: 'move', ids, origin: world, base: docRef.current });
        return;
      }
      const baseIds = event.shiftKey ? selectionRef.current : [];
      if (!event.shiftKey) onSelection([]);
      begin({ type: 'marquee', origin: world, baseIds, additive: event.shiftKey });
      setDraft({ kind: 'marquee', a: world, b: world });
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const pointerType = normalizePointerType(event.pointerType);
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY, type: pointerType });
    }
    const touches = [...pointers.current.values()].filter((pointer) => pointer.type === 'touch');
    if (touches.length >= 2) {
      if (gesture.current?.type !== 'pinch') startPinch(touches);
      applyPinch(touches);
      return;
    }
    const current = gesture.current;
    if (!current) return;
    if (current.type === 'pan') {
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      current.x = event.clientX;
      current.y = event.clientY;
      publish(setView(docRef.current, panView(docRef.current.view, dx, dy)), 'view');
      return;
    }
    if (current.type === 'draw') {
      for (const sample of event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]) {
        current.points.push(readPoint(sample));
      }
      setDraft({
        kind: 'stroke',
        tool: current.tool,
        color: colorRef.current,
        size: sizeRef.current,
        points: current.points,
      });
      return;
    }
    if (current.type === 'erase') {
      current.points.push(worldFromClient(event.clientX, event.clientY));
      setDraft({ kind: 'eraser', points: current.points, radius: eraserRef.current });
      publish(applyEraser(current.base, current.points, eraserRef.current), 'transient');
      return;
    }
    const world = worldFromClient(event.clientX, event.clientY);
    if (current.type === 'shape') {
      setDraft({ kind: 'shape', shape: previewShape(current.kind, current.origin, world) });
      return;
    }
    if (current.type === 'move') {
      publish(moveSelection(current.base, current.ids, world.x - current.origin.x, world.y - current.origin.y), 'transient');
      return;
    }
    if (current.type === 'marquee') {
      setDraft({ kind: 'marquee', a: current.origin, b: world });
      const hits = objectsInRect(docRef.current, current.origin, world);
      onSelection(current.additive ? [...new Set([...current.baseIds, ...hits])] : hits);
      return;
    }
    if (current.type === 'resize') {
      publish(replaceObject(current.base, current.id, (object) => dragHandle(object, current.handle, world)), 'transient');
      return;
    }
    if (current.type === 'endpoint') {
      publish(
        replaceObject(current.base, current.id, (object) =>
          object.type === 'shape' ? setLineEndpoint(object, current.which, world) : object,
        ),
        'transient',
      );
      return;
    }
    if (current.type === 'rotate') {
      const angle = Math.atan2(world.y - current.center.y, world.x - current.center.x);
      publish(rotateSelection(current.base, [current.id], angle - current.start, current.center), 'transient');
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (pointers.current.size > 0 && (current?.type === 'pinch' || current?.type === 'pan')) {
      const touches = [...pointers.current.values()].filter((pointer) => pointer.type === 'touch');
      if (touches.length >= 2) startPinch(touches);
      else if (touches.length === 1) begin({ type: 'pan', x: touches[0].x, y: touches[0].y });
      return;
    }
    gesture.current = null;
    if (!current) return;
    if (current.type === 'draw') {
      const points = current.points.length ? current.points : [readPoint(event.nativeEvent)];
      publish(
        commitFreehand(docRef.current, points, { tool: current.tool, color: colorRef.current, size: sizeRef.current }),
        'commit',
      );
      setDraft(null);
      return;
    }
    if (current.type === 'erase') {
      publish(applyEraser(current.base, current.points, eraserRef.current), 'commit', current.base);
      setDraft(null);
      return;
    }
    if (current.type === 'shape') {
      const world = worldFromClient(event.clientX, event.clientY);
      if (dist(current.origin, world) >= 4) {
        const shape = { ...previewShape(current.kind, current.origin, world), id: createId() };
        publish(addObject(docRef.current, shape), 'commit');
        onSelection([shape.id]);
      }
      setDraft(null);
      return;
    }
    if (current.type === 'move' || current.type === 'resize' || current.type === 'endpoint' || current.type === 'rotate') {
      publish(docRef.current, 'commit', current.base);
      return;
    }
    if (current.type === 'text') {
      const text = makeText({
        cx: current.world.x + 100,
        cy: current.world.y + 32,
        color: colorRef.current,
      });
      publish(addObject(docRef.current, text), 'commit');
      onSelection([text.id]);
      onEditText(text.id);
      return;
    }
    if (current.type === 'edit-text') {
      onEditText(current.id);
      return;
    }
    if (current.type === 'marquee') setDraft(null);
  }

  function startPinch(touches: PointerSample[]) {
    const [a, b] = touches;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    begin({ type: 'pinch', dist: Math.max(1, dist(a, b)), mid, view: docRef.current.view });
    setDraft(null);
  }

  function applyPinch(touches: PointerSample[]) {
    const pinch = gesture.current;
    if (pinch?.type !== 'pinch') return;
    const [a, b] = touches;
    const mid = screenFromClient((a.x + b.x) / 2, (a.y + b.y) / 2);
    const startMid = screenFromClient(pinch.mid.x, pinch.mid.y);
    const zoomed = zoomView(pinch.view, startMid, Math.max(1, dist(a, b)) / pinch.dist);
    publish(setView(docRef.current, panView(zoomed, mid.x - startMid.x, mid.y - startMid.y)), 'view');
  }

  function previewShape(kind: ShapeKind, origin: Point, world: Point) {
    const style = { stroke: colorRef.current, fill: 'transparent', strokeWidth: 2.5 };
    if (kind === 'line' || kind === 'arrow') return lineFromPoints(origin, world, kind, style, 'draft');
    return shapeFromBox(kind, origin, world, style, 'draft');
  }

  function readPoint(event: PointerEvent): StrokePoint {
    const world = worldFromClient(event.clientX, event.clientY);
    if (event.pointerType === 'pen' && event.pressure > 0) return { ...world, pressure: event.pressure };
    return world;
  }

  return (
    <canvas
      ref={canvasRef}
      className="board"
      data-testid="board"
      data-tool={tool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

function readViewport() {
  return {
    w: document.documentElement.clientWidth,
    h: document.documentElement.clientHeight,
    dpr: window.devicePixelRatio || 1,
  };
}

function localPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function replaceObject(doc: Document, id: string, mapper: (object: BoardObject) => BoardObject): Document {
  return { ...doc, objects: doc.objects.map((object) => (object.id === id ? mapper(object) : object)) };
}
