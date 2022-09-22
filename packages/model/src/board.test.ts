import { describe, expect, it } from 'vitest';
import {
  addConnector,
  addObject,
  applyEraser,
  centerOf,
  commit,
  commitFreehand,
  connectorEndpoints,
  createDocument,
  createEditor,
  deleteSelection,
  deserialize,
  frameOf,
  makeImage,
  makeStroke,
  moveSelection,
  objectById,
  recognizeShape,
  redo,
  resizeSelection,
  rotateSelection,
  routePointer,
  screenToWorld,
  serialize,
  setTheme,
  strokeOutline,
  undo,
  worldToScreen,
  type Point,
  type ShapeObj,
} from './index';

function sameBoard(a: { rev: number }, b: { rev: number }): boolean {
  return JSON.stringify({ ...a, rev: 0 }) === JSON.stringify({ ...b, rev: 0 });
}

function polygonArea(outline: number[][]): number {
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function horizontalSliceWidths(outline: number[][]): number[] {
  const xs = outline.map((point) => point[0]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const span = maxX - minX;
  const widths: number[] = [];
  for (let i = 0; i < 5; i++) {
    const x = minX + span * (0.3 + 0.1 * i);
    const band = outline.filter((point) => Math.abs(point[0] - x) <= span * 0.025);
    if (band.length < 2) continue;
    const ys = band.map((point) => point[1]);
    widths.push(Math.max(...ys) - Math.min(...ys));
  }
  return widths;
}

function straightPath(y: number, pressure?: number): Point[] & { pressure?: number }[] {
  return Array.from({ length: 24 }, (_, index) => ({
    x: index * 12,
    y,
    ...(pressure === undefined ? {} : { pressure }),
  }));
}

function edgePolyline(vertices: Point[], perEdge: number): Point[] {
  const points: Point[] = [];
  const ring = [...vertices, vertices[0]];
  for (let edge = 0; edge < ring.length - 1; edge++) {
    for (let step = 0; step < perEdge; step++) {
      const t = step / perEdge;
      points.push({
        x: ring[edge].x + (ring[edge + 1].x - ring[edge].x) * t,
        y: ring[edge].y + (ring[edge + 1].y - ring[edge].y) * t,
      });
    }
  }
  points.push({ ...vertices[0] });
  return points;
}

function ellipsePolyline(cx: number, cy: number, rx: number, ry: number): Point[] {
  const points: Point[] = [];
  const count = 64;
  for (let i = 0; i <= count; i++) {
    const t = (i / count) * Math.PI * 2;
    points.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return points;
}

describe('board model', () => {
  it('higher-pressure sample of the same path yields a strictly wider outline than a lower-pressure sample', () => {
    const low = strokeOutline(straightPath(0, 0.12), 28);
    const high = strokeOutline(straightPath(0, 0.95), 28);
    const lowArea = polygonArea(low);
    const highArea = polygonArea(high);
    const lowWidth = Math.min(...horizontalSliceWidths(low));
    const highWidth = Math.min(...horizontalSliceWidths(high));
    console.log(
      `higher-pressure sample of the same path yields a strictly wider outline than a lower-pressure sample: high width ${highWidth} > low width ${lowWidth}; high area ${highArea} > low area ${lowArea}`,
    );
    expect(highWidth).toBeGreaterThan(lowWidth);
    expect(highArea).toBeGreaterThan(lowArea);
  });

  it('a no-pressure sample does not invent width variation', () => {
    const outline = strokeOutline(straightPath(40), 18);
    const widths = horizontalSliceWidths(outline);
    const min = Math.min(...widths);
    const max = Math.max(...widths);
    console.log(
      `a no-pressure sample does not invent width variation: station widths ${widths.map((width) => width.toFixed(3)).join(', ')}; spread ${max - min}`,
    );
    expect(widths.length).toBeGreaterThanOrEqual(4);
    expect(max - min).toBeLessThan(0.75);
  });

  it('screen-to-world and world-to-screen round-trip a point', () => {
    const view = { panX: 37.5, panY: -18, zoom: 1.75 };
    const point = { x: 123.25, y: -40.5 };
    const screen = worldToScreen(point, view);
    const world = screenToWorld(screen, view);
    console.log(
      `screen-to-world and world-to-screen round-trip a point: (${point.x}, ${point.y}) -> (${screen.x}, ${screen.y}) -> (${world.x}, ${world.y})`,
    );
    expect(world.x).toBeCloseTo(point.x, 8);
    expect(world.y).toBeCloseTo(point.y, 8);
  });

  it('routing given pen or mouse plus the pen tool is a draw, and touch is a pan and not a draw', () => {
    const pen = routePointer({ pointerType: 'pen', tool: 'pen' });
    const mouse = routePointer({ pointerType: 'mouse', tool: 'pen' });
    const touch = routePointer({ pointerType: 'touch', tool: 'pen' });
    const pinch = routePointer({ pointerType: 'touch', tool: 'pen', pointerCount: 2 });
    const stylusOnPan = routePointer({ pointerType: 'pen', tool: 'pan' });
    console.log(
      `routing given pen or mouse plus the pen tool is a draw, and touch is a pan and not a draw: pen=${pen} mouse=${mouse} touch=${touch} pinch=${pinch} pen+panTool=${stylusOnPan}`,
    );
    expect(pen).toBe('draw');
    expect(mouse).toBe('draw');
    expect(touch).toBe('pan');
    expect(touch).not.toBe('draw');
    expect(pinch).toBe('pinch');
    expect(stylusOnPan).toBe('draw');
    expect(routePointer({ pointerType: 'mouse', tool: 'pan' })).toBe('pan');
    expect(routePointer({ pointerType: 'mouse', tool: 'eraser' })).toBe('erase');
    expect(routePointer({ pointerType: 'mouse', tool: 'laser' })).toBe('laser');
    expect(routePointer({ pointerType: 'pen', tool: 'laser' })).toBe('laser');
    expect(routePointer({ pointerType: 'touch', tool: 'laser' })).toBe('pan');
  });

  it('an eraser path drops only intersecting strokes', () => {
    let doc = createDocument();
    const hit = makeStroke(straightPath(0), { tool: 'pen', color: '#1d4e89', size: 8, id: 'hit' });
    const miss = makeStroke(straightPath(160), { tool: 'pen', color: '#1d4e89', size: 8, id: 'miss' });
    const shape: ShapeObj = {
      id: 'box',
      z: 0,
      type: 'shape',
      kind: 'rect',
      cx: 40,
      cy: 160,
      width: 30,
      height: 20,
      rotation: 0,
      stroke: '#1d4e89',
      fill: 'transparent',
      strokeWidth: 2,
    };
    doc = addObject(addObject(addObject(doc, hit), miss), shape);
    const erased = applyEraser(
      doc,
      [
        { x: -20, y: 0 },
        { x: 300, y: 0 },
      ],
      6,
    );
    const strokeIds = erased.objects.filter((object) => object.type === 'stroke').map((object) => object.id);
    console.log(`an eraser path drops only intersecting strokes: remaining strokes ${strokeIds.join(', ') || '(none)'}`);
    expect(strokeIds).toEqual(['miss']);
    expect(objectById(erased, 'box')?.type).toBe('shape');
    expect(objectById(erased, 'hit')).toBeUndefined();
  });

  it('undo then redo restores document equality with the post-edit state', () => {
    let state = createEditor(createDocument());
    const stroke = makeStroke(straightPath(0), { tool: 'pen', color: '#1d4e89', size: 6 });
    state = commit(state, addObject(state.doc, stroke));
    const after = state.doc;
    const undone = undo(state);
    const redone = redo(undone);
    const same = sameBoard(redone.doc, after);
    console.log(
      `undo then redo restores document equality with the post-edit state: undone objects ${undone.doc.objects.length}, redone equals post-edit ${same}`,
    );
    expect(undone.doc.objects).toHaveLength(0);
    expect(undone.doc.rev).toBeGreaterThan(after.rev);
    expect(redone.doc.rev).toBeGreaterThan(undone.doc.rev);
    expect(same).toBe(true);
  });

  it('a clean rectangle, ellipse, and triangle polyline each become that shape, and a zigzag scribble does not', () => {
    const rectangle = edgePolyline(
      [
        { x: 0, y: 0 },
        { x: 180, y: 0 },
        { x: 180, y: 110 },
        { x: 0, y: 110 },
      ],
      8,
    );
    const triangle = edgePolyline(
      [
        { x: 0, y: 0 },
        { x: 170, y: 8 },
        { x: 60, y: 140 },
      ],
      8,
    );
    const ellipse = ellipsePolyline(0, 0, 90, 55);
    const zigzag: Point[] = [];
    for (let i = 0; i < 14; i++) zigzag.push({ x: i * 16, y: i % 2 === 0 ? 0 : 42 });

    const rectKind = recognizeShape(rectangle)?.kind ?? null;
    const ellipseKind = recognizeShape(ellipse)?.kind ?? null;
    const triangleKind = recognizeShape(triangle)?.kind ?? null;
    const scribbleKind = recognizeShape(zigzag);

    let doc = createDocument();
    doc = commitFreehand(doc, rectangle, { tool: 'pen', color: '#1d4e89', size: 4 });
    doc = commitFreehand(doc, ellipse, { tool: 'pen', color: '#1d4e89', size: 4 });
    doc = commitFreehand(doc, triangle, { tool: 'pen', color: '#1d4e89', size: 4 });
    doc = commitFreehand(doc, zigzag, { tool: 'pen', color: '#1d4e89', size: 4 });
    const kinds = doc.objects.map((object) => (object.type === 'shape' ? object.kind : object.type));
    console.log(
      `a clean rectangle, ellipse, and triangle polyline each become that shape, and a zigzag scribble does not: ${kinds.join(', ')}; recognize ${rectKind}, ${ellipseKind}, ${triangleKind}, scribble ${scribbleKind}`,
    );
    expect(rectKind).toBe('rect');
    expect(ellipseKind).toBe('ellipse');
    expect(triangleKind).toBe('triangle');
    expect(scribbleKind).toBeNull();
    expect(kinds).toEqual(['rect', 'ellipse', 'triangle', 'stroke']);
  });

  it('moving a connected object changes connector endpoints to that object’s new anchors', () => {
    const left: ShapeObj = {
      id: 'left',
      z: 0,
      type: 'shape',
      kind: 'rect',
      cx: 0,
      cy: 0,
      width: 80,
      height: 40,
      rotation: 0,
      stroke: '#1d4e89',
      fill: 'transparent',
      strokeWidth: 2,
    };
    const right: ShapeObj = {
      id: 'right',
      z: 0,
      type: 'shape',
      kind: 'rect',
      cx: 240,
      cy: 0,
      width: 80,
      height: 40,
      rotation: 0,
      stroke: '#1d4e89',
      fill: 'transparent',
      strokeWidth: 2,
    };
    let doc = addObject(addObject(createDocument(), left), right);
    doc = addConnector(doc, 'left', 'right', { color: '#1d4e89', strokeWidth: 2 });
    const connector = doc.objects.find((object) => object.type === 'connector');
    expect(connector).toBeTruthy();
    const before = connectorEndpoints(doc, connector!.id)!;
    const moved = moveSelection(doc, ['left'], 50, 0);
    const after = connectorEndpoints(moved, connector!.id)!;
    console.log(
      `moving a connected object changes connector endpoints to that object’s new anchors: from (${before.from.x}, ${before.from.y}) -> (${after.from.x}, ${after.from.y}); to stays (${after.to.x}, ${after.to.y})`,
    );
    expect(after.from.x).toBeCloseTo(before.from.x + 50, 6);
    expect(after.from.y).toBeCloseTo(before.from.y, 6);
    expect(after.to.x).toBeCloseTo(before.to.x, 6);
    expect(after.to.y).toBeCloseTo(before.to.y, 6);
    expect(after.from).not.toEqual(before.from);

    let state = createEditor(doc);
    state = commit(state, moved);
    const afterMove = state.doc;
    state = redo(undo(state));
    expect(sameBoard(state.doc, afterMove)).toBe(true);
    expect(state.doc.rev).toBeGreaterThan(afterMove.rev);
  });

  it('selection move, resize, rotate, and delete match the same model’s geometry', () => {
    const shape: ShapeObj = {
      id: 'card',
      z: 0,
      type: 'shape',
      kind: 'rect',
      cx: 100,
      cy: 80,
      width: 120,
      height: 50,
      rotation: 0.2,
      stroke: '#1d4e89',
      fill: 'transparent',
      strokeWidth: 2,
    };
    const doc = addObject(createDocument(), shape);
    const before = frameOf(objectById(doc, 'card')!)!;
    const moved = moveSelection(doc, ['card'], 15, -7);
    const movedFrame = frameOf(objectById(moved, 'card')!)!;
    const resized = resizeSelection(doc, ['card'], before.width * 2, before.height * 0.5);
    const resizedFrame = frameOf(objectById(resized, 'card')!)!;
    const rotated = rotateSelection(doc, ['card'], Math.PI / 2);
    const rotatedObject = objectById(rotated, 'card');
    const rotatedFrame = frameOf(rotatedObject!)!;
    const deleted = deleteSelection(doc, ['card']);
    console.log(
      `selection move, resize, rotate, and delete match the same model’s geometry: move center (${movedFrame.cx}, ${movedFrame.cy}); resize ${resizedFrame.width}x${resizedFrame.height}; rotate ${rotatedObject && rotatedObject.type === 'shape' ? rotatedObject.rotation : 'missing'}; deleted ${objectById(deleted, 'card') === undefined}`,
    );
    expect(movedFrame.cx).toBeCloseTo(before.cx + 15, 6);
    expect(movedFrame.cy).toBeCloseTo(before.cy - 7, 6);
    expect(movedFrame.width).toBeCloseTo(before.width, 6);
    expect(resizedFrame.width).toBeCloseTo(before.width * 2, 6);
    expect(resizedFrame.height).toBeCloseTo(before.height * 0.5, 6);
    expect(resizedFrame.cx).toBeCloseTo(before.cx, 6);
    expect(resizedFrame.cy).toBeCloseTo(before.cy, 6);
    expect(rotatedObject?.type).toBe('shape');
    if (rotatedObject?.type === 'shape') {
      expect(rotatedObject.rotation).toBeCloseTo(shape.rotation + Math.PI / 2, 6);
    }
    expect(rotatedFrame.cx).toBeCloseTo(before.cx, 6);
    expect(rotatedFrame.cy).toBeCloseTo(before.cy, 6);
    expect(centerOf(rotatedObject!)).toEqual({ x: rotatedFrame.cx, y: rotatedFrame.cy });
    expect(objectById(deleted, 'card')).toBeUndefined();
  });

  it('serialize then deserialize deep-equals the document, including image payload and theme', () => {
    const payload = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    let doc = createDocument();
    doc = addObject(
      doc,
      makeImage({
        cx: 12,
        cy: 18,
        width: 10,
        height: 10,
        mime: 'image/png',
        src: payload,
      }),
    );
    doc = setTheme(doc, 'dark');
    doc = addObject(doc, makeStroke(straightPath(4, 0.4), { tool: 'highlighter', color: '#e6b800', size: 16 }));
    const copy = deserialize(serialize(doc));
    const image = copy.objects.find((object) => object.type === 'image');
    console.log(
      `serialize then deserialize deep-equals the document, including image payload and theme: theme ${copy.theme}; image bytes match ${image?.type === 'image' && image.src === payload}; equal ${JSON.stringify(copy) === JSON.stringify(doc)}`,
    );
    expect(copy).toEqual(doc);
    expect(copy.theme).toBe('dark');
    expect(image?.type).toBe('image');
    if (image?.type === 'image') expect(image.src).toBe(payload);
  });
});
