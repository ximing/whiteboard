import type { Document } from './types';

export function serialize(doc: Document): string {
  return JSON.stringify(doc);
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
  return doc as Document;
}
