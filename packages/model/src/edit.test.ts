import { describe, expect, it } from 'vitest';
import {
  addConnector,
  addObject,
  alignSelection,
  appendComment,
  applyEraser,
  connectorPath,
  createDocument,
  deleteSelection,
  deserialize,
  distributeSelection,
  dragHandle,
  duplicateObjects,
  expandGroups,
  fitView,
  frameOf,
  groupSelection,
  hitTest,
  makeComment,
  makeImage,
  makeSticky,
  makeStroke,
  makeText,
  moveSelection,
  objectById,
  orderSelection,
  resizeSelection,
  restyleSelection,
  rotateSelection,
  scaleSelection,
  setConnectorEnd,
  setTextBox,
  snapDelta,
  type ShapeObj,
  type StrokeObj,
} from './index';

function rect(id: string, cx: number, cy = 0, width = 40, height = 40): ShapeObj {
  return {
    id,
    z: 0,
    type: 'shape',
    kind: 'rect',
    cx,
    cy,
    width,
    height,
    rotation: 0,
    stroke: '#1d4e89',
    fill: 'transparent',
    strokeWidth: 2,
  };
}

function leftEdge(doc: ReturnType<typeof createDocument>, id: string): number {
  const frame = frameOf(objectById(doc, id)!)!;
  return frame.cx - frame.width / 2;
}

describe('editing operations', () => {
  it('deserialize maps dataUrl to src and assigns z by old order', () => {
    const payload = 'data:image/png;base64,abc';
    const doc = deserialize(
      JSON.stringify({
        version: 1,
        rev: 2,
        theme: 'light',
        view: { panX: 0, panY: 0, zoom: 1 },
        objects: [
          {
            id: 'ink',
            type: 'stroke',
            tool: 'pen',
            color: '#111',
            size: 4,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
          },
          {
            id: 'pic',
            type: 'image',
            cx: 1,
            cy: 2,
            width: 8,
            height: 8,
            rotation: 0,
            mime: 'image/png',
            dataUrl: payload,
          },
        ],
      }),
    );
    const image = doc.objects[1];
    console.log(
      `deserialize maps dataUrl to src and keeps stack order: z ${doc.objects.map((object) => object.z).join(',')} src ${image?.type === 'image' ? image.src : 'missing'}`,
    );
    expect(doc.objects.map((object) => object.z)).toEqual([0, 1]);
    expect(image?.type).toBe('image');
    if (image?.type === 'image') expect(image.src).toBe(payload);
    expect(image).not.toHaveProperty('dataUrl');
    expect(doc.objects[0]).not.toHaveProperty('locked');
    expect(doc.objects[0]).not.toHaveProperty('groupId');
  });

  it('orderSelection front and forward raise an object so hitTest finds it', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('low', 0, 0, 80, 80));
    doc = addObject(doc, rect('high', 0, 0, 80, 80));
    expect(hitTest(doc, { x: 0, y: 0 })?.id).toBe('high');
    const front = orderSelection(doc, ['low'], 'front');
    const forward = orderSelection(doc, ['low'], 'forward');
    console.log(
      `order raises the lower object: front z ${objectById(front, 'low')?.z}>${objectById(front, 'high')?.z}; forward hit ${hitTest(forward, { x: 0, y: 0 })?.id}`,
    );
    expect(objectById(front, 'low')!.z).toBeGreaterThan(objectById(front, 'high')!.z);
    expect(hitTest(front, { x: 0, y: 0 })?.id).toBe('low');
    expect(objectById(forward, 'low')!.z).toBeGreaterThan(objectById(forward, 'high')!.z);
    expect(hitTest(forward, { x: 0, y: 0 })?.id).toBe('low');
  });

  it('applyEraser splits a stroke around the gap and deletes an unlocked shape but not a locked one', () => {
    let doc = createDocument();
    doc = addObject(
      doc,
      makeStroke(
        [0, 20, 40, 60, 80, 100].map((x) => ({ x, y: 0 })),
        { tool: 'pen', color: '#111', size: 2, id: 'ink' },
      ),
    );
    doc = addObject(doc, rect('open', 50, 0, 16, 16));
    doc = addObject(doc, { ...rect('shut', 50, 0, 16, 16), locked: true });
    const erased = applyEraser(
      doc,
      [
        { x: 50, y: -30 },
        { x: 50, y: 0 },
        { x: 50, y: 30 },
      ],
      2,
    );
    const strokes = erased.objects.filter((object): object is StrokeObj => object.type === 'stroke');
    const xs = strokes.flatMap((stroke) => stroke.points.map((point) => point.x));
    console.log(
      `eraser splits ink and keeps the locked shape: strokes ${strokes.map((stroke) => stroke.id).join(',')} xs ${xs.join(',')}; open ${objectById(erased, 'open') === undefined} shut ${objectById(erased, 'shut') !== undefined}`,
    );
    expect(strokes).toHaveLength(2);
    expect(strokes.some((stroke) => stroke.id === 'ink')).toBe(true);
    expect(xs.some((x) => x > 40 && x < 60)).toBe(false);
    expect(Math.min(...strokes[0].points.map((point) => point.x))).toBeLessThan(40.001);
    expect(Math.max(...strokes[1].points.map((point) => point.x))).toBeGreaterThan(59);
    expect(objectById(erased, 'open')).toBeUndefined();
    expect(objectById(erased, 'shut')?.type).toBe('shape');
  });

  it('restyleSelection changes a shape fill and text bold without touching an image', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('box', 0));
    doc = addObject(doc, makeText({ id: 'label', cx: 0, cy: 80, color: '#111', fontSize: 20, text: 'A' }));
    doc = addObject(doc, makeImage({ id: 'pic', cx: 0, cy: 160, width: 20, height: 20, mime: 'image/png', src: 'https://example.com/a.png' }));
    const image = objectById(doc, 'pic');
    const next = restyleSelection(doc, ['box', 'label', 'pic'], { fill: '#abc', bold: true });
    const shape = objectById(next, 'box');
    const text = objectById(next, 'label');
    console.log(
      `restyle fill ${shape?.type === 'shape' ? shape.fill : 'missing'} bold ${text?.type === 'text' ? text.bold : 'missing'} image same ${objectById(next, 'pic') === image}`,
    );
    expect(shape?.type).toBe('shape');
    if (shape?.type === 'shape') expect(shape.fill).toBe('#abc');
    expect(text?.type).toBe('text');
    if (text?.type === 'text') expect(text.bold).toBe(true);
    expect(objectById(next, 'pic')).toBe(image);
  });

  it('duplicateObjects offsets clones, remaps a connector between them, and drops a one-ended connector', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('a', 0, 0));
    doc = addObject(doc, rect('b', 120, 0));
    doc = addObject(doc, rect('c', 0, 120));
    doc = addConnector(doc, 'a', 'b', { color: '#111', strokeWidth: 2 });
    doc = addConnector(doc, 'a', 'c', { color: '#111', strokeWidth: 2 });
    const links = doc.objects.filter((object) => object.type === 'connector');
    const between = links.find((object) => object.type === 'connector' && object.fromId === 'a' && object.toId === 'b');
    const dangling = links.find((object) => object.type === 'connector' && object.toId === 'c');
    const { doc: next, ids } = duplicateObjects(doc, ['a', 'b', between!.id, dangling!.id]);
    const clones = ids.map((id) => objectById(next, id)!);
    const shapes = clones.filter((object) => object.type === 'shape');
    const connector = clones.find((object) => object.type === 'connector');
    const cloneA = shapes.find((object) => object.type === 'shape' && object.cx === 24 && object.cy === 24);
    const cloneB = shapes.find((object) => object.type === 'shape' && object.cx === 144 && object.cy === 24);
    console.log(
      `duplicate offsets ${shapes.length} shapes and ${clones.filter((object) => object.type === 'connector').length} connectors; links now ${next.objects.filter((object) => object.type === 'connector').length}`,
    );
    expect(shapes).toHaveLength(2);
    expect(cloneA?.type).toBe('shape');
    expect(cloneB?.type).toBe('shape');
    expect(connector?.type).toBe('connector');
    if (connector?.type === 'connector' && cloneA && cloneB) {
      expect(connector.fromId).toBe(cloneA.id);
      expect(connector.toId).toBe(cloneB.id);
    }
    expect(next.objects.filter((object) => object.type === 'connector')).toHaveLength(3);
    expect(next.objects.some((object) => object.type === 'connector' && object.toId === 'c' && object.id !== dangling!.id)).toBe(false);
    const original = objectById(next, 'a');
    expect(original?.type).toBe('shape');
    if (original?.type === 'shape') expect(original.cx).toBe(0);
  });

  it('align left makes left edges equal', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('a', 0, 0, 40, 20));
    doc = addObject(doc, rect('b', 100, 30, 20, 20));
    const aligned = alignSelection(doc, ['a', 'b'], 'left');
    console.log(`align left: ${leftEdge(aligned, 'a')} and ${leftEdge(aligned, 'b')}`);
    expect(leftEdge(aligned, 'a')).toBeCloseTo(-20);
    expect(leftEdge(aligned, 'b')).toBeCloseTo(leftEdge(aligned, 'a'));
  });

  it('distribute horizontal puts equal gaps between three rects', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('a', 10, 0, 20, 10));
    doc = addObject(doc, rect('b', 50, 0, 20, 10));
    doc = addObject(doc, rect('c', 130, 0, 20, 10));
    const next = distributeSelection(doc, ['a', 'b', 'c'], 'horizontal');
    const edge = (id: string) => {
      const shape = objectById(next, id);
      if (shape?.type !== 'shape') throw new Error('missing');
      return { min: shape.cx - shape.width / 2, max: shape.cx + shape.width / 2 };
    };
    const a = edge('a');
    const b = edge('b');
    const c = edge('c');
    console.log(`distribute gaps ${b.min - a.max} and ${c.min - b.max}`);
    expect(a.min).toBeCloseTo(0);
    expect(c.max).toBeCloseTo(140);
    expect(b.min - a.max).toBeCloseTo(c.min - b.max);
    expect(b.min - a.max).toBeCloseTo(40);
  });

  it('groupSelection shares a groupId that expandGroups returns', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('a', 0));
    doc = addObject(doc, rect('b', 80));
    const grouped = groupSelection(doc, ['a', 'b']);
    console.log(`group ${grouped.groupId} expands to ${expandGroups(grouped.doc, ['a']).join(',')}`);
    expect(grouped.groupId).toBeTruthy();
    expect(objectById(grouped.doc, 'a')?.groupId).toBe(grouped.groupId);
    expect(objectById(grouped.doc, 'b')?.groupId).toBe(grouped.groupId);
    expect(expandGroups(grouped.doc, ['a'])).toEqual(['a', 'b']);
  });

  it('text handle resize keeps fontSize and scaleSelection changes it', () => {
    let doc = createDocument();
    doc = addObject(doc, makeText({ id: 't', cx: 0, cy: 0, width: 200, height: 80, color: '#111', fontSize: 22, text: 'Hi' }));
    const resized = objectById(resizeSelection(doc, ['t'], 260, 40), 't');
    const dragged = dragHandle(objectById(doc, 't')!, 'se', { x: 160, y: 80 });
    const scaled = objectById(scaleSelection(doc, ['t'], 2), 't');
    const boxed = objectById(setTextBox(doc, 't', 10, 10), 't');
    console.log(
      `text font stays ${resized?.type === 'text' ? resized.fontSize : 'missing'} on resize, becomes ${scaled?.type === 'text' ? scaled.fontSize : 'missing'} on scale`,
    );
    expect(resized?.type).toBe('text');
    if (resized?.type === 'text') {
      expect(resized.fontSize).toBe(22);
      expect(resized.width).toBe(260);
      expect(resized.height).toBe(40);
    }
    expect(dragged.type).toBe('text');
    if (dragged.type === 'text') {
      expect(dragged.fontSize).toBe(22);
      expect(dragged.height).not.toBe(80);
    }
    expect(scaled?.type).toBe('text');
    if (scaled?.type === 'text') expect(scaled.fontSize).toBe(44);
    expect(boxed?.type).toBe('text');
    if (boxed?.type === 'text') {
      expect(boxed.width).toBe(24);
      expect(boxed.height).toBe(16);
      expect(boxed.fontSize).toBe(22);
    }
  });

  it('connectorPath elbow has an orthogonal bend', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('left', 0, 0, 80, 40));
    doc = addObject(doc, rect('right', 200, 120, 80, 40));
    doc = addConnector(doc, 'left', 'right', { color: '#111', strokeWidth: 2 });
    const connector = doc.objects.find((object) => object.type === 'connector');
    doc = restyleSelection(doc, [connector!.id], { route: 'elbow' });
    const path = connectorPath(doc, connector!.id);
    console.log(`elbow path ${path?.map((point) => `${point.x},${point.y}`).join(' -> ')}`);
    expect(path).toBeTruthy();
    expect(path!.length).toBeGreaterThanOrEqual(3);
    let horizontal = false;
    let vertical = false;
    for (let index = 1; index < path!.length; index++) {
      const dx = path![index].x - path![index - 1].x;
      const dy = path![index].y - path![index - 1].y;
      expect(dx === 0 || dy === 0).toBe(true);
      if (dy === 0 && dx !== 0) horizontal = true;
      if (dx === 0 && dy !== 0) vertical = true;
    }
    expect(horizontal).toBe(true);
    expect(vertical).toBe(true);
  });

  it('setConnectorEnd rejects a connector target', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('a', 0, 0));
    doc = addObject(doc, rect('b', 120, 0));
    doc = addObject(doc, rect('c', 240, 0));
    doc = addConnector(doc, 'a', 'b', { color: '#111', strokeWidth: 2 });
    doc = addConnector(doc, 'b', 'c', { color: '#111', strokeWidth: 2 });
    const links = doc.objects.filter((object) => object.type === 'connector');
    const ab = links.find((object) => object.type === 'connector' && object.toId === 'b')!;
    const bc = links.find((object) => object.type === 'connector' && object.toId === 'c')!;
    const rejected = setConnectorEnd(doc, ab.id, 'to', bc.id);
    const accepted = setConnectorEnd(doc, ab.id, 'to', 'c');
    const moved = objectById(accepted, ab.id);
    console.log(`connector target rejected ${rejected === doc}; valid end ${moved?.type === 'connector' ? moved.toId : 'missing'}`);
    expect(rejected).toBe(doc);
    expect(moved?.type).toBe('connector');
    if (moved?.type === 'connector') expect(moved.toId).toBe('c');
  });

  it('fitView centers a 100x100 box at the origin', () => {
    const view = fitView({ width: 200, height: 200 }, { minX: -50, minY: -50, maxX: 50, maxY: 50 }, 50);
    console.log(`fitView zoom ${view.zoom} pan ${view.panX},${view.panY}`);
    expect(view).toEqual({ zoom: 1, panX: 100, panY: 100 });
  });

  it('snapDelta pulls a box that is 4 units off a 32-grid onto that grid', () => {
    const doc = addObject(createDocument(), rect('box', 24, 16, 40, 32));
    const snapped = snapDelta(doc, ['box'], 0.2, 0, { grid: 32, threshold: 8 });
    const moved = moveSelection(doc, ['box'], snapped.dx, snapped.dy);
    const frame = frameOf(objectById(moved, 'box')!)!;
    console.log(`snap delta ${snapped.dx},${snapped.dy} lands left ${frame.cx - frame.width / 2}`);
    expect(snapped.dx).toBeCloseTo(-4);
    expect(snapped.dy).toBeCloseTo(0);
    expect(frame.cx - frame.width / 2).toBeCloseTo(0);
  });

  it('hits an elbow on the bend, not only the straight chord', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('left', 0, 0, 40, 40));
    doc = addObject(doc, rect('right', 200, 120, 40, 40));
    doc = addConnector(doc, 'left', 'right', { color: '#111', strokeWidth: 2 });
    const connector = doc.objects.find((object) => object.type === 'connector');
    if (!connector || connector.type !== 'connector') throw new Error('missing connector');
    doc = restyleSelection(doc, [connector.id], { route: 'elbow', fromSide: 'right', toSide: 'left' });
    const path = connectorPath(doc, connector.id);
    expect(path && path.length).toBeGreaterThan(2);
    const bend = path![1];
    const bendHit = hitTest(doc, bend);
    const offChord = {
      x: path![0].x + (path![path!.length - 1].x - path![0].x) * 0.15,
      y: path![0].y + (path![path!.length - 1].y - path![0].y) * 0.15,
    };
    expect(bendHit?.id).toBe(connector.id);
    expect(hitTest(doc, offChord)?.id).not.toBe(connector.id);
  });

  it('delete skips locked objects and drops a comment anchor when its target goes', () => {
    let doc = createDocument();
    doc = addObject(doc, { ...rect('keep', 0, 0), locked: true });
    doc = addObject(doc, rect('gone', 80, 0));
    doc = addObject(doc, makeComment({ id: 'pin', cx: 110, cy: -20, targetId: 'gone' }));
    expect(deleteSelection(doc, ['keep'])).toBe(doc);
    const next = deleteSelection(doc, ['keep', 'gone']);
    expect(objectById(next, 'keep')?.locked).toBe(true);
    expect(objectById(next, 'gone')).toBeUndefined();
    const pin = objectById(next, 'pin');
    expect(pin?.type).toBe('comment');
    if (pin?.type === 'comment') expect(pin.targetId).toBeUndefined();
  });

  it('a comment follows its target and stores a reply', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('card', 0, 0));
    doc = addObject(doc, makeComment({ id: 'pin', cx: 40, cy: -20, targetId: 'card' }));
    doc = addObject(doc, makeSticky({ id: 'note', cx: 200, cy: 0, text: 'Remember' }));
    const moved = moveSelection(doc, ['card'], 15, 5);
    const pin = objectById(moved, 'pin');
    expect(pin?.type === 'comment' ? pin.cx : 0).toBe(55);
    expect(pin?.type === 'comment' ? pin.cy : 0).toBe(-15);
    const replied = appendComment(moved, 'pin', { text: ' Looks good ', author: 'Ada', at: 10 });
    const thread = objectById(replied, 'pin');
    expect(thread?.type === 'comment' ? thread.messages.map((message) => message.text) : []).toEqual(['Looks good']);
    const note = objectById(replied, 'note');
    expect(note?.type === 'sticky' ? note.fill : '').toBe('#efe3b0');
  });

  it('a comment stays on its target through rotation and scaling', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('card', 0, 0));
    doc = addObject(doc, makeComment({ id: 'pin', cx: 40, cy: -20, targetId: 'card' }));
    const turned = rotateSelection(doc, ['card'], Math.PI / 2);
    const rotated = objectById(turned, 'pin');
    expect(rotated?.type === 'comment' ? rotated.cx : 0).toBeCloseTo(20);
    expect(rotated?.type === 'comment' ? rotated.cy : 0).toBeCloseTo(40);
    const grown = scaleSelection(doc, ['card'], 2);
    const scaled = objectById(grown, 'pin');
    expect(scaled?.type === 'comment' ? scaled.cx : 0).toBeCloseTo(80);
    expect(scaled?.type === 'comment' ? scaled.cy : 0).toBeCloseTo(-40);
  });

  it('duplicating a target copies the comment pinned to it', () => {
    let doc = createDocument();
    doc = addObject(doc, rect('card', 0, 0));
    doc = addObject(doc, makeComment({ id: 'pin', cx: 40, cy: -20, targetId: 'card' }));
    const copy = duplicateObjects(doc, ['card']);
    const clones = copy.doc.objects.filter((object) => object.type === 'comment' && object.id !== 'pin');
    expect(clones).toHaveLength(1);
    const clone = clones[0];
    expect(clone.type === 'comment' ? clone.cx : 0).toBe(64);
    expect(clone.type === 'comment' ? clone.cy : 0).toBe(4);
    expect(clone.type === 'comment' ? clone.targetId : '').not.toBe('card');
    const targetId = clone.type === 'comment' ? clone.targetId : undefined;
    const target = targetId ? objectById(copy.doc, targetId) : undefined;
    expect(target?.type === 'shape' ? target.cx : 0).toBe(24);
  });
});
