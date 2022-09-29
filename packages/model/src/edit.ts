import { addObject, connectorPath, followAnchors, frameOf, moveSelection, objectById, paintOrder } from './document';
import { bboxOf, localToWorld } from './geometry';
import { createId } from './id';
import type { BoardObject, ConnectorObj, Document, Frame, Point, StylePatch } from './types';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type OrderMode = 'front' | 'back' | 'forward' | 'backward';
type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

function frameBounds(frame: Frame): Bounds {
  const hx = frame.width / 2;
  const hy = frame.height / 2;
  return bboxOf([
    localToWorld({ x: -hx, y: -hy }, frame),
    localToWorld({ x: hx, y: -hy }, frame),
    localToWorld({ x: hx, y: hy }, frame),
    localToWorld({ x: -hx, y: hy }, frame),
  ]);
}

function unionBounds(boxes: Bounds[]): Bounds | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function objectBounds(doc: Document, object: BoardObject): Bounds | null {
  if (object.type === 'connector') {
    const path = connectorPath(doc, object.id);
    if (!path) return null;
    return bboxOf(path);
  }
  const frame = frameOf(object);
  return frame ? frameBounds(frame) : null;
}

function movable(doc: Document, ids: string[]): Array<{ object: BoardObject; index: number }> {
  const selected = new Set(ids);
  const found: Array<{ object: BoardObject; index: number }> = [];
  doc.objects.forEach((object, index) => {
    if (!selected.has(object.id) || object.locked || object.type === 'connector') return;
    if (!frameOf(object)) return;
    found.push({ object, index });
  });
  return found;
}

function applyStyle(object: BoardObject, patch: StylePatch): BoardObject {
  if (object.type === 'image') return object;
  if (object.type === 'stroke') {
    const color = patch.color !== undefined ? patch.color : object.color;
    const size = patch.size !== undefined && patch.size > 0 ? patch.size : object.size;
    if (color === object.color && size === object.size) return object;
    return { ...object, color, size };
  }
  if (object.type === 'shape') {
    const stroke = patch.color !== undefined ? patch.color : object.stroke;
    const fill = patch.fill !== undefined ? patch.fill : object.fill;
    const strokeWidth = patch.strokeWidth !== undefined ? patch.strokeWidth : object.strokeWidth;
    if (stroke === object.stroke && fill === object.fill && strokeWidth === object.strokeWidth) return object;
    return { ...object, stroke, fill, strokeWidth };
  }
  if (object.type === 'text') {
    let next = object;
    if (patch.color !== undefined && patch.color !== next.color) next = { ...next, color: patch.color };
    if (patch.fontSize !== undefined) {
      const fontSize = Math.max(8, patch.fontSize);
      if (fontSize !== next.fontSize) next = { ...next, fontSize };
    }
    if (patch.bold !== undefined && patch.bold !== next.bold) next = { ...next, bold: patch.bold };
    if (patch.align !== undefined && patch.align !== next.align) next = { ...next, align: patch.align };
    return next;
  }
  if (object.type === 'sticky') {
    let next = object;
    if (patch.color !== undefined && patch.color !== next.color) next = { ...next, color: patch.color };
    if (patch.fill !== undefined && patch.fill !== next.fill) next = { ...next, fill: patch.fill };
    if (patch.fontSize !== undefined) {
      const fontSize = Math.max(8, patch.fontSize);
      if (fontSize !== next.fontSize) next = { ...next, fontSize };
    }
    return next;
  }
  if (object.type === 'comment') {
    if (patch.color !== undefined && patch.color !== object.color) return { ...object, color: patch.color };
    return object;
  }
  let next: ConnectorObj = object;
  if (patch.color !== undefined && patch.color !== next.color) next = { ...next, color: patch.color };
  if (patch.strokeWidth !== undefined && patch.strokeWidth !== next.strokeWidth) next = { ...next, strokeWidth: patch.strokeWidth };
  if (patch.route !== undefined && patch.route !== next.route) next = { ...next, route: patch.route };
  if (patch.arrow !== undefined && patch.arrow !== next.arrow) next = { ...next, arrow: patch.arrow };
  if (patch.label !== undefined && patch.label !== next.label) next = { ...next, label: patch.label };
  if (patch.fromSide !== undefined && patch.fromSide !== next.fromSide) next = { ...next, fromSide: patch.fromSide };
  if (patch.toSide !== undefined && patch.toSide !== next.toSide) next = { ...next, toSide: patch.toSide };
  return next;
}

export function restyleSelection(doc: Document, ids: string[], patch: StylePatch): Document {
  const selected = new Set(ids);
  let changed = false;
  const objects = doc.objects.map((object) => {
    if (!selected.has(object.id) || object.locked) return object;
    const next = applyStyle(object, patch);
    if (next !== object) changed = true;
    return next;
  });
  return changed ? { ...doc, objects } : doc;
}

function reorder(order: BoardObject[], selected: Set<string>, mode: OrderMode): BoardObject[] {
  if (mode === 'front' || mode === 'back') {
    const picked: BoardObject[] = [];
    const rest: BoardObject[] = [];
    for (const object of order) (selected.has(object.id) ? picked : rest).push(object);
    return mode === 'front' ? [...rest, ...picked] : [...picked, ...rest];
  }
  const next = order.slice();
  if (mode === 'forward') {
    for (let index = next.length - 2; index >= 0; index--) {
      if (selected.has(next[index].id) && !selected.has(next[index + 1].id)) {
        const above = next[index + 1];
        next[index + 1] = next[index];
        next[index] = above;
      }
    }
    return next;
  }
  for (let index = 1; index < next.length; index++) {
    if (selected.has(next[index].id) && !selected.has(next[index - 1].id)) {
      const below = next[index - 1];
      next[index - 1] = next[index];
      next[index] = below;
    }
  }
  return next;
}

export function orderSelection(doc: Document, ids: string[], mode: OrderMode): Document {
  const order = paintOrder(doc.objects);
  const next = reorder(order, new Set(ids), mode);
  if (next.every((object, index) => object.id === order[index]?.id)) return doc;
  const zOf = new Map(next.map((object, index) => [object.id, index]));
  return {
    ...doc,
    objects: doc.objects.map((object) => {
      const z = zOf.get(object.id);
      if (z === undefined || object.z === z) return object;
      return { ...object, z };
    }),
  };
}

export function setTextBox(doc: Document, id: string, width: number, height: number): Document {
  const widthNext = Math.max(24, width);
  const heightNext = Math.max(16, height);
  let changed = false;
  const objects = doc.objects.map((object) => {
    if (object.id !== id || (object.type !== 'text' && object.type !== 'sticky') || object.locked) return object;
    if (object.width === widthNext && object.height === heightNext) return object;
    changed = true;
    return { ...object, width: widthNext, height: heightNext };
  });
  return changed ? followAnchors(doc, { ...doc, objects }) : doc;
}

export { connectorPath } from './document';

export function setConnectorEnd(doc: Document, id: string, which: 'from' | 'to', targetId: string): Document {
  const connector = objectById(doc, id);
  if (!connector || connector.type !== 'connector') return doc;
  const target = objectById(doc, targetId);
  if (!target || target.type === 'connector') return doc;
  const fromId = which === 'from' ? targetId : connector.fromId;
  const toId = which === 'to' ? targetId : connector.toId;
  if (fromId === toId || (fromId === connector.fromId && toId === connector.toId)) return doc;
  const next: ConnectorObj = { ...connector, fromId, toId };
  return { ...doc, objects: doc.objects.map((object) => (object.id === id ? next : object)) };
}

function cloneShifted(object: BoardObject, id: string, offset: Point, idMap: Map<string, string>, groupId?: string): BoardObject {
  let copy: BoardObject;
  if (object.type === 'stroke') {
    copy = {
      ...object,
      id,
      points: object.points.map((point) => ({ ...point, x: point.x + offset.x, y: point.y + offset.y })),
    };
  } else if (object.type === 'connector') {
    copy = {
      ...object,
      id,
      fromId: idMap.get(object.fromId) ?? object.fromId,
      toId: idMap.get(object.toId) ?? object.toId,
    };
  } else if (object.type === 'comment') {
    copy = {
      ...object,
      id,
      cx: object.cx + offset.x,
      cy: object.cy + offset.y,
      targetId: object.targetId && idMap.has(object.targetId) ? idMap.get(object.targetId) : object.targetId,
    };
  } else {
    copy = { ...object, id, cx: object.cx + offset.x, cy: object.cy + offset.y };
  }
  delete copy.locked;
  delete copy.groupId;
  if (groupId) copy.groupId = groupId;
  return copy;
}

export function duplicateObjects(doc: Document, ids: string[], offset?: Point): { doc: Document; ids: string[] } {
  const delta = offset ?? { x: 24, y: 24 };
  const selected = new Set(ids);
  const included = new Set<string>();
  for (const object of doc.objects) {
    if (selected.has(object.id) && object.type !== 'connector') included.add(object.id);
  }
  for (const object of doc.objects) {
    if (object.type === 'connector' && selected.has(object.id) && included.has(object.fromId) && included.has(object.toId)) {
      included.add(object.id);
    }
    if (object.type === 'comment' && object.targetId && included.has(object.targetId)) included.add(object.id);
  }
  const counts = new Map<string, number>();
  for (const object of doc.objects) {
    if (!included.has(object.id) || !object.groupId) continue;
    counts.set(object.groupId, (counts.get(object.groupId) ?? 0) + 1);
  }
  const groupMap = new Map<string, string>();
  for (const [groupId, count] of counts) {
    if (count >= 2) groupMap.set(groupId, createId());
  }
  const idMap = new Map<string, string>();
  for (const object of doc.objects) {
    if (included.has(object.id)) idMap.set(object.id, createId());
  }
  let next = doc;
  const created: string[] = [];
  for (const object of paintOrder(doc.objects)) {
    const id = idMap.get(object.id);
    if (!id) continue;
    const groupId = object.groupId ? groupMap.get(object.groupId) : undefined;
    next = addObject(next, cloneShifted(object, id, delta, idMap, groupId));
    created.push(id);
  }
  return { doc: next, ids: created };
}

export function alignSelection(doc: Document, ids: string[], mode: AlignMode): Document {
  const objects = movable(doc, ids);
  if (objects.length < 2) return doc;
  const boxes = objects.map((entry) => ({ id: entry.object.id, box: frameBounds(frameOf(entry.object)!) }));
  const union = unionBounds(boxes.map((entry) => entry.box));
  if (!union) return doc;
  let next = doc;
  for (const entry of boxes) {
    const box = entry.box;
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = union.minX - box.minX;
    else if (mode === 'right') dx = union.maxX - box.maxX;
    else if (mode === 'center') dx = (union.minX + union.maxX) / 2 - (box.minX + box.maxX) / 2;
    else if (mode === 'top') dy = union.minY - box.minY;
    else if (mode === 'bottom') dy = union.maxY - box.maxY;
    else dy = (union.minY + union.maxY) / 2 - (box.minY + box.maxY) / 2;
    next = moveSelection(next, [entry.id], dx, dy);
  }
  return next;
}

export function distributeSelection(doc: Document, ids: string[], axis: 'horizontal' | 'vertical'): Document {
  const objects = movable(doc, ids);
  if (objects.length < 3) return doc;
  const items = objects.map((entry) => {
    const box = frameBounds(frameOf(entry.object)!);
    const min = axis === 'horizontal' ? box.minX : box.minY;
    const max = axis === 'horizontal' ? box.maxX : box.maxY;
    return { id: entry.object.id, index: entry.index, min, max, size: max - min };
  });
  items.sort((a, b) => a.min - b.min || a.index - b.index);
  const first = items[0];
  const last = items[items.length - 1];
  const span = last.max - first.min;
  const sizeSum = items.reduce((sum, item) => sum + item.size, 0);
  const gap = (span - sizeSum) / (items.length - 1);
  let cursor = first.max;
  let next = doc;
  for (let index = 1; index < items.length - 1; index++) {
    const item = items[index];
    const target = cursor + gap;
    const delta = target - item.min;
    next = axis === 'horizontal' ? moveSelection(next, [item.id], delta, 0) : moveSelection(next, [item.id], 0, delta);
    cursor = target + item.size;
  }
  return next;
}

export function groupSelection(doc: Document, ids: string[]): { doc: Document; groupId: string | null } {
  const selected = new Set(ids);
  const members = doc.objects.filter((object) => selected.has(object.id) && object.type !== 'connector');
  if (members.length < 2) return { doc, groupId: null };
  const groupId = createId();
  const memberIds = new Set(members.map((object) => object.id));
  return {
    groupId,
    doc: {
      ...doc,
      objects: doc.objects.map((object) => (memberIds.has(object.id) ? { ...object, groupId } : object)),
    },
  };
}

export function ungroupSelection(doc: Document, ids: string[]): Document {
  const selected = new Set(ids);
  const groups = new Set<string>();
  for (const object of doc.objects) {
    if (selected.has(object.id) && object.groupId) groups.add(object.groupId);
  }
  if (groups.size === 0) return doc;
  return {
    ...doc,
    objects: doc.objects.map((object) => {
      if (!object.groupId || !groups.has(object.groupId)) return object;
      const next = { ...object };
      delete next.groupId;
      return next;
    }),
  };
}

export function expandGroups(doc: Document, ids: string[]): string[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const object = objectById(doc, id);
    if (object?.groupId) groups.add(object.groupId);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of ids) push(id);
  if (groups.size > 0) {
    for (const object of doc.objects) {
      if (object.groupId && groups.has(object.groupId)) push(object.id);
    }
  }
  return out;
}

export function setLocked(doc: Document, ids: string[], locked: boolean): Document {
  const selected = new Set(ids);
  let changed = false;
  const objects = doc.objects.map((object) => {
    if (!selected.has(object.id) || Boolean(object.locked) === locked) return object;
    changed = true;
    if (!locked) {
      const next = { ...object };
      delete next.locked;
      return next;
    }
    return { ...object, locked: true };
  });
  return changed ? { ...doc, objects } : doc;
}

export function boundsOf(doc: Document, ids?: string[]): Bounds | null {
  if (ids && ids.length === 0) return null;
  const chosen = ids ? new Set(ids) : null;
  const boxes: Bounds[] = [];
  for (const object of doc.objects) {
    if (chosen && !chosen.has(object.id)) continue;
    const box = objectBounds(doc, object);
    if (box) boxes.push(box);
  }
  return unionBounds(boxes);
}

function pushExtent(target: number[], min: number, max: number): void {
  target.push(min, (min + max) / 2, max);
}

function snapTargets(doc: Document, exclude: Set<string>): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (const object of doc.objects) {
    if (exclude.has(object.id) || object.locked) continue;
    const box = objectBounds(doc, object);
    if (!box) continue;
    pushExtent(x, box.minX, box.maxX);
    pushExtent(y, box.minY, box.maxY);
  }
  return { x, y };
}

function bestAdjust(anchors: number[], targets: number[], grid: number, threshold: number): number {
  let best = 0;
  let bestAbs = Infinity;
  const consider = (adjust: number) => {
    const distance = Math.abs(adjust);
    if (distance > threshold || distance >= bestAbs) return;
    best = adjust;
    bestAbs = distance;
  };
  for (const anchor of anchors) {
    if (grid > 0 && Number.isFinite(grid)) consider(Math.round(anchor / grid) * grid - anchor);
    for (const target of targets) consider(target - anchor);
  }
  return best;
}

export function snapDelta(
  doc: Document,
  ids: string[],
  dx: number,
  dy: number,
  options?: { grid?: number; threshold?: number },
): { dx: number; dy: number } {
  if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };
  const grid = options?.grid ?? 32;
  const threshold = options?.threshold ?? 8;
  const moving = movable(doc, ids);
  const bounds = unionBounds(moving.map((entry) => frameBounds(frameOf(entry.object)!)));
  if (!bounds) return { dx, dy };
  const targets = snapTargets(doc, new Set(ids));
  return {
    dx: dx + bestAdjust([bounds.minX + dx, (bounds.minX + bounds.maxX) / 2 + dx, bounds.maxX + dx], targets.x, grid, threshold),
    dy: dy + bestAdjust([bounds.minY + dy, (bounds.minY + bounds.maxY) / 2 + dy, bounds.maxY + dy], targets.y, grid, threshold),
  };
}
