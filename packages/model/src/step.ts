import type { BoardObject, Document, Step } from './types';

export type StepResult = { doc: Document; failed: string | null };

function fail(doc: Document, failed: string): StepResult {
  return { doc, failed };
}

export function applyStep(doc: Document, step: Step): StepResult {
  if (step.type === 'theme') return { doc: { ...doc, theme: step.after }, failed: null };
  if (step.type === 'add') {
    if (doc.objects.some((object) => object.id === step.object.id)) return fail(doc, 'add');
    return { doc: { ...doc, objects: [...doc.objects, step.object] }, failed: null };
  }
  if (step.type === 'delete') {
    if (!doc.objects.some((object) => object.id === step.object.id)) return fail(doc, 'delete');
    return { doc: { ...doc, objects: doc.objects.filter((object) => object.id !== step.object.id) }, failed: null };
  }
  const index = doc.objects.findIndex((object) => object.id === step.id);
  if (index < 0) return fail(doc, 'update');
  const objects = doc.objects.slice();
  objects[index] = step.after;
  return { doc: { ...doc, objects }, failed: null };
}

export function invertStep(step: Step): Step {
  if (step.type === 'add') return { type: 'delete', object: step.object };
  if (step.type === 'delete') return { type: 'add', object: step.object };
  if (step.type === 'theme') return { type: 'theme', before: step.after, after: step.before };
  return { type: 'update', id: step.id, before: step.after, after: step.before };
}

function asRecord(object: BoardObject): Record<string, unknown> {
  return object as unknown as Record<string, unknown>;
}

function mergeChanged(before: BoardObject, after: BoardObject, base: BoardObject): BoardObject {
  const prev = asRecord(before);
  const next = asRecord(after);
  const merged = { ...asRecord(base) };
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (key === 'id') continue;
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) merged[key] = next[key];
  }
  return merged as unknown as BoardObject;
}

/** Rebase `step` over an already-applied step. `null` means the change no longer applies. */
export function mapStep(step: Step, over: Step): Step | null {
  if (step.type === 'theme') {
    if (over.type !== 'theme') return step;
    if (step.after === over.after) return null;
    return { type: 'theme', before: over.after, after: step.after };
  }
  const id = step.type === 'update' ? step.id : step.object.id;
  if (step.type === 'add') {
    if (over.type === 'add' && over.object.id === id) return null;
    return step;
  }
  if (over.type === 'delete' && over.object.id === id) return null;
  if (step.type === 'delete') {
    if (over.type === 'update' && over.id === id) return { type: 'delete', object: over.after };
    if (over.type === 'add' && over.object.id === id) return { type: 'delete', object: over.object };
    return step;
  }
  const base = over.type === 'update' && over.id === id ? over.after : over.type === 'add' && over.object.id === id ? over.object : null;
  if (!base) return step;
  if (base.type !== step.before.type) return null;
  const after = mergeChanged(step.before, step.after, base);
  if (JSON.stringify(after) === JSON.stringify(base)) return null;
  return { type: 'update', id, before: base, after };
}

export function rebaseSteps(steps: Step[], over: Step[]): Step[] {
  const mapped: Step[] = [];
  for (const step of steps) {
    let next: Step | null = step;
    for (const remote of over) {
      if (!next) break;
      next = mapStep(next, remote);
    }
    if (next) mapped.push(next);
  }
  return mapped;
}

/** Steps that turn `before` into `after`, ignoring camera and revision. */
export function diffSteps(before: Document, after: Document): Step[] {
  const steps: Step[] = [];
  if (before.theme !== after.theme) steps.push({ type: 'theme', before: before.theme, after: after.theme });
  const prev = new Map(before.objects.map((object) => [object.id, object]));
  const nextIds = new Set(after.objects.map((object) => object.id));
  for (const object of after.objects) {
    const old = prev.get(object.id);
    if (!old) steps.push({ type: 'add', object });
    else if (JSON.stringify(old) !== JSON.stringify(object)) steps.push({ type: 'update', id: object.id, before: old, after: object });
  }
  for (const object of before.objects) {
    if (!nextIds.has(object.id)) steps.push({ type: 'delete', object });
  }
  return steps;
}
