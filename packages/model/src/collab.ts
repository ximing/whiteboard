import { applyStep, diffSteps, rebaseSteps } from './step';
import type { Document, EditorState, HistoryEvent, Step } from './types';

const STEP_LOG = 200;

export type RoomLog = {
  version: number;
  /** Authority version before `steps[0]`. Older clients need a snapshot. */
  base: number;
  doc: Document;
  steps: Step[];
};

export type AuthorityResult =
  | { type: 'accepted'; room: RoomLog; steps: Step[] }
  | { type: 'catchup'; from: number; steps: Step[] | null; version: number; doc: Document };

function rebaseHistory(events: HistoryEvent[], over: Step[]): HistoryEvent[] {
  if (over.length === 0) return events;
  return events.flatMap((event) => {
    const steps = rebaseSteps(event.steps, over);
    return steps.length ? [{ steps }] : [];
  });
}

export function seedRoom(doc: Document): RoomLog {
  return { version: doc.rev, base: doc.rev, doc, steps: [] };
}

export function stepsSince(room: RoomLog, version: number): Step[] | null {
  if (version < room.base || version > room.version) return null;
  return room.steps.slice(version - room.base);
}

/** Single-authority receive, the same role as a ProseMirror collab server. */
export function authorityReceive(room: RoomLog, version: number, steps: Step[]): AuthorityResult {
  if (version !== room.version || steps.length === 0) {
    return { type: 'catchup', from: version, steps: stepsSince(room, version), version: room.version, doc: room.doc };
  }
  let doc = room.doc;
  const applied: Step[] = [];
  for (const step of steps) {
    const result = applyStep(doc, step);
    if (result.failed) {
      return { type: 'catchup', from: version, steps: stepsSince(room, version), version: room.version, doc: room.doc };
    }
    doc = result.doc;
    applied.push(step);
  }
  const log = room.steps.concat(applied);
  const dropped = Math.max(0, log.length - STEP_LOG);
  doc = { ...doc, rev: room.version + applied.length };
  return {
    type: 'accepted',
    steps: applied,
    room: {
      version: doc.rev,
      base: room.base + dropped,
      doc,
      steps: log.slice(dropped),
    },
  };
}

/** Local document is ahead of the room. Submit the difference at the room version. */
export function followRoom(state: EditorState, roomDoc: Document, version: number): EditorState {
  return {
    ...state,
    collab: {
      version,
      confirmed: { ...roomDoc, view: state.doc.view },
      unconfirmed: diffSteps(roomDoc, state.doc),
    },
  };
}

/** Local steps were already applied. Remember them until the authority accepts. */
export function noteLocalSteps(state: EditorState, steps: Step[]): EditorState {
  if (steps.length === 0) return state;
  return { ...state, collab: { ...state.collab, unconfirmed: [...state.collab.unconfirmed, ...steps] } };
}

export function confirmSteps(state: EditorState, count: number, version: number): EditorState {
  const accepted = state.collab.unconfirmed.slice(0, count);
  let confirmed = state.collab.confirmed;
  for (const step of accepted) {
    const result = applyStep(confirmed, step);
    if (!result.failed) confirmed = result.doc;
  }
  const rev = Math.max(state.doc.rev, version);
  return {
    ...state,
    doc: { ...state.doc, rev },
    collab: {
      version,
      confirmed: { ...confirmed, view: state.doc.view, rev },
      unconfirmed: state.collab.unconfirmed.slice(count),
    },
  };
}

/** Apply authority steps, then rebase unconfirmed local steps and undo history on top. */
export function receiveSteps(state: EditorState, steps: Step[], version: number): EditorState {
  let confirmed = state.collab.confirmed;
  const accepted: Step[] = [];
  for (const step of steps) {
    const result = applyStep(confirmed, step);
    if (result.failed) continue;
    accepted.push(step);
    confirmed = result.doc;
  }
  const unconfirmed = rebaseSteps(state.collab.unconfirmed, accepted);
  let doc = { ...confirmed, view: state.doc.view };
  for (const step of unconfirmed) {
    const result = applyStep(doc, step);
    if (!result.failed) doc = result.doc;
  }
  const rev = Math.max(state.doc.rev + 1, version);
  return {
    doc: { ...doc, view: state.doc.view, rev },
    past: rebaseHistory(state.past, accepted),
    future: rebaseHistory(state.future, accepted),
    collab: { version, confirmed: { ...confirmed, view: state.doc.view, rev: version }, unconfirmed },
  };
}

export function adoptSnapshot(state: EditorState, doc: Document, version: number): EditorState {
  const next = { ...doc, view: state.doc.view, rev: Math.max(doc.rev, state.doc.rev, version) };
  return {
    doc: next,
    past: [],
    future: [],
    collab: { version, confirmed: { ...next }, unconfirmed: [] },
  };
}
