import { addObject, createId, type BoardObject, type Document, type Point } from '@plume/model';

export const CLIP_PREFIX = 'plume-board:';

export function encodeClipboard(objects: BoardObject[]): string {
  return CLIP_PREFIX + JSON.stringify(objects);
}

export function decodeClipboard(text: string): BoardObject[] | null {
  if (!text.startsWith(CLIP_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(CLIP_PREFIX.length));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((object): object is BoardObject => !!object && typeof object === 'object' && typeof (object as BoardObject).id === 'string' && typeof (object as BoardObject).type === 'string');
  } catch {
    return null;
  }
}

function translate(object: BoardObject, dx: number, dy: number): BoardObject {
  if (object.type === 'connector') return object;
  if (object.type === 'stroke') {
    return {
      ...object,
      points: object.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
    };
  }
  return { ...object, cx: object.cx + dx, cy: object.cy + dy };
}

/** New ids, remapped connectors and groups, shifted into place. Not inserted yet. */
export function remapObjects(objects: BoardObject[], delta: Point): BoardObject[] {
  const ids = new Map(objects.map((object) => [object.id, createId()]));
  const groups = new Map<string, string>();
  const groupFor = (groupId?: string) => {
    if (!groupId) return undefined;
    const existing = groups.get(groupId);
    if (existing) return existing;
    const next = createId();
    groups.set(groupId, next);
    return next;
  };
  const selected = new Set(objects.map((object) => object.id));
  const copies: BoardObject[] = [];
  for (const object of objects) {
    const id = ids.get(object.id);
    if (!id) continue;
    if (object.type === 'connector') {
      if (!selected.has(object.fromId) || !selected.has(object.toId)) continue;
      const fromId = ids.get(object.fromId);
      const toId = ids.get(object.toId);
      if (!fromId || !toId) continue;
      copies.push({ ...object, id, fromId, toId, locked: undefined, groupId: groupFor(object.groupId) });
      continue;
    }
    if (object.type === 'comment') {
      const targetId = object.targetId && selected.has(object.targetId) ? ids.get(object.targetId) : undefined;
      const copy = { ...translate(object, delta.x, delta.y), id, locked: undefined, groupId: groupFor(object.groupId), targetId };
      if (!targetId) delete copy.targetId;
      copies.push(copy);
      continue;
    }
    copies.push({ ...translate(object, delta.x, delta.y), id, locked: undefined, groupId: groupFor(object.groupId) });
  }
  return copies;
}

export function insertObjects(doc: Document, objects: BoardObject[], delta: Point): { doc: Document; ids: string[] } {
  let next = doc;
  const ids: string[] = [];
  for (const object of remapObjects(objects, delta)) {
    next = addObject(next, object);
    ids.push(object.id);
  }
  return { doc: next, ids };
}
