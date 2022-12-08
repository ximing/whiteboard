import {
  addObject,
  commit,
  createDocument,
  createEditor,
  deleteSelection,
  dragHandle,
  frameOf,
  makeImage,
  makeStroke,
  objectById,
  redo,
  rotateSelection,
  screenToWorld,
  undo,
  worldToScreen,
  type Document,
  type StrokeObj,
} from '@plume/model';
import { describe, expect, it } from 'vitest';
import { frameCorners, hitHandle, selectionHandles } from '@plume/editor';
import { loadBest, preparePersist } from './storage';

function stripImages(doc: Document): Document {
  return {
    ...doc,
    objects: doc.objects.map((object) => (object.type === 'image' ? { ...object, src: '' } : object)),
  };
}

function imageUrl(doc: Document, id: string): string | null {
  const object = objectById(doc, id);
  return object?.type === 'image' ? object.src : null;
}

describe('reload after undo', () => {
  it('keeps the undone board when its rev is newer than the IndexedDB snapshot', () => {
    let state = createEditor(createDocument());
    const stroke = makeStroke(
      [
        { x: 0, y: 0 },
        { x: 40, y: 12 },
      ],
      { tool: 'pen', color: '#1d4e89', size: 6, id: 'ink' },
    );
    state = commit(state, addObject(state.doc, stroke));
    const edited = state.doc;
    const undone = undo(state);
    const redone = redo(undone);
    const chosen = loadBest(undone.doc, edited);
    const staleLocal = loadBest(edited, undone.doc);
    console.log(
      `loadBest keeps the undone board when its rev is newer than the IndexedDB snapshot: local rev ${undone.doc.rev} objects ${chosen?.objects.length}, stored rev ${edited.rev} objects ${edited.objects.length}, stale local loses ${staleLocal?.rev === undone.doc.rev}`,
    );
    expect(undone.doc.rev).toBeGreaterThan(edited.rev);
    expect(redone.doc.rev).toBeGreaterThan(undone.doc.rev);
    expect(chosen?.objects).toHaveLength(0);
    expect(chosen?.rev).toBe(undone.doc.rev);
    expect(staleLocal?.objects.map((object) => object.id)).toEqual([]);
    expect(staleLocal?.rev).toBe(undone.doc.rev);
  });
});

describe('image hydration', () => {
  it('restores a stripped local snapshot from the full IndexedDB snapshot', () => {
    const payload = `data:image/png;base64,${'iVBORw0KGgo'.repeat(12)}`;
    const doc = addObject(
      createDocument(),
      makeImage({
        id: 'pic',
        cx: 20,
        cy: 30,
        width: 16,
        height: 16,
        mime: 'image/png',
        src: payload,
      }),
    );
    const stripped = stripImages(doc);
    const restored = loadBest(stripped, doc);
    const prepared = preparePersist(stripped, doc);
    console.log(
      `restore of a stripped local snapshot plus a full IDB snapshot: local bytes ${imageUrl(stripped, 'pic')?.length ?? -1}, restored bytes ${imageUrl(restored!, 'pic')?.length ?? -1}, prepared bytes ${imageUrl(prepared, 'pic')?.length ?? -1}`,
    );
    expect(imageUrl(stripped, 'pic')).toBe('');
    expect(imageUrl(restored!, 'pic')).toBe(payload);
    expect(imageUrl(prepared, 'pic')).toBe(payload);
    expect(restored?.rev).toBe(doc.rev);
  });

  it('fills empty image bytes on a newer document and does not resurrect a deleted image', () => {
    const payload = `data:image/png;base64,${'Qk3image'.repeat(8)}`;
    const doc = addObject(
      createDocument(),
      makeImage({
        id: 'pic',
        cx: 4,
        cy: 6,
        width: 12,
        height: 12,
        mime: 'image/png',
        src: payload,
      }),
    );
    const newerStripped = commit(createEditor(doc), stripImages(doc)).doc;
    const filled = loadBest(newerStripped, doc);
    const removed = commit(createEditor(doc), deleteSelection(doc, ['pic'])).doc;
    const kept = loadBest(removed, doc);
    const persisted = preparePersist(removed, doc);
    console.log(
      `newer stripped image keeps its rev and regains bytes ${imageUrl(filled!, 'pic') === payload}; deleted image stays gone ${objectById(kept!, 'pic') === undefined}`,
    );
    expect(newerStripped.rev).toBeGreaterThan(doc.rev);
    expect(filled?.rev).toBe(newerStripped.rev);
    expect(imageUrl(filled!, 'pic')).toBe(payload);
    expect(removed.rev).toBeGreaterThan(doc.rev);
    expect(objectById(kept!, 'pic')).toBeUndefined();
    expect(objectById(persisted, 'pic')).toBeUndefined();
    expect(kept?.objects).toHaveLength(0);
  });
});

describe('flat strokes', () => {
  it('hits and resizes a horizontal stroke, and rotates it off the axis', () => {
    const doc = addObject(
      createDocument(),
      makeStroke(
        [
          { x: 0, y: 40 },
          { x: 160, y: 40 },
        ],
        { tool: 'pen', color: '#1d4e89', size: 24, id: 'flat' },
      ),
    );
    const stroke = objectById(doc, 'flat');
    expect(stroke?.type).toBe('stroke');
    if (stroke?.type !== 'stroke') return;
    const frame = frameOf(stroke);
    expect(frame).toBeTruthy();
    if (!frame) return;
    const corners = frameCorners(frame).map((point) => worldToScreen(point, doc.view));
    const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
    const rotateAt = selectionHandles(stroke, doc).find((handle) => handle.kind === 'rotate');
    const seWorld = screenToWorld(corners[2], doc.view);
    const resized = dragHandle(stroke, 'se', { x: seWorld.x, y: seWorld.y + stroke.size });
    const rotated = objectById(rotateSelection(doc, [stroke.id], Math.PI / 3), stroke.id);
    const spread = rotated?.type === 'stroke' ? Math.max(...rotated.points.map((point) => point.y)) - Math.min(...rotated.points.map((point) => point.y)) : 0;
    console.log(
      `horizontal stroke hitHandle ${hitHandle(stroke, doc, corners[2])} rotate ${rotateAt ? hitHandle(stroke, doc, rotateAt.at) : 'missing'}; drag size ${stroke.size} -> ${resized.type === 'stroke' ? resized.size : 'n/a'}; rotated y spread ${spread}`,
    );
    expect(frame.height).toBeGreaterThanOrEqual(stroke.size);
    expect(frame.width).toBeGreaterThan(frame.height);
    expect(hitHandle(stroke, doc, corners[2])).toBe('se');
    expect(rotateAt?.at.y).toBeLessThan(top.y);
    expect(hitHandle(stroke, doc, rotateAt!.at)).toBe('rotate');
    expect(resized.type).toBe('stroke');
    expect((resized as StrokeObj).size).toBeGreaterThan(stroke.size);
    expect(spread).toBeGreaterThan(0);
  });

  it('widens a vertical stroke by dragging its side handle', () => {
    const doc = addObject(
      createDocument(),
      makeStroke(
        [
          { x: 40, y: 0 },
          { x: 40, y: 150 },
        ],
        { tool: 'pen', color: '#1d4e89', size: 24, id: 'up' },
      ),
    );
    const stroke = objectById(doc, 'up');
    expect(stroke?.type).toBe('stroke');
    if (stroke?.type !== 'stroke') return;
    const frame = frameOf(stroke)!;
    const corners = frameCorners(frame).map((point) => worldToScreen(point, doc.view));
    const seWorld = screenToWorld(corners[2], doc.view);
    const resized = dragHandle(stroke, 'se', { x: seWorld.x + stroke.size, y: seWorld.y });
    console.log(
      `vertical stroke frame ${frame.width}x${frame.height}; hit ${hitHandle(stroke, doc, corners[2])}; size ${stroke.size} -> ${resized.type === 'stroke' ? resized.size : 'n/a'}`,
    );
    expect(frame.width).toBeGreaterThanOrEqual(stroke.size);
    expect(frame.height).toBeGreaterThan(frame.width);
    expect(hitHandle(stroke, doc, corners[2])).toBe('se');
    expect(resized.type).toBe('stroke');
    expect((resized as StrokeObj).size).toBeGreaterThan(stroke.size);
  });
});
