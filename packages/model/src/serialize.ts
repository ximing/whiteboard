import type { BoardObject, Document, ImageObj, View } from './types';

export function serialize(doc: Document): string {
  return JSON.stringify(doc);
}

function finiteZ(value: unknown, index: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : index;
}

function normalizeObject(raw: unknown, index: number): BoardObject {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Document is not a Plume board');
  }
  const record = raw as Record<string, unknown>;
  const z = finiteZ(record.z, index);
  if (record.type === 'image') {
    const hasDataUrl = Object.prototype.hasOwnProperty.call(record, 'dataUrl');
    const srcOk = typeof record.src === 'string';
    if (srcOk && !hasDataUrl && record.z === z) return record as unknown as BoardObject;
    const dataUrl = record.dataUrl;
    const src = srcOk ? record.src : typeof dataUrl === 'string' ? dataUrl : '';
    const image = { ...record };
    delete image.dataUrl;
    delete image.z;
    return { ...(image as unknown as ImageObj), src: src as string, z };
  }
  if (record.z === z) return record as unknown as BoardObject;
  return { ...(record as unknown as BoardObject), z };
}

export function deserialize(json: string): Document {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Document is not an object');
  }
  const doc = parsed as Partial<Document>;
  if (doc.version !== 1 || !Array.isArray(doc.objects) || (doc.theme !== 'light' && doc.theme !== 'dark')) {
    throw new Error('Document is not a Plume board');
  }
  if (!doc.view || typeof doc.view.zoom !== 'number') {
    throw new Error('Document is missing a view');
  }
  return {
    version: 1,
    rev: typeof doc.rev === 'number' ? doc.rev : 0,
    theme: doc.theme,
    view: doc.view as View,
    objects: doc.objects.map((object, index) => normalizeObject(object, index)),
  };
}
