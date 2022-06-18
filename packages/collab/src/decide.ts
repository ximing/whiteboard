import { diffSteps, stepsSince, type EditorState, type RoomLog } from '@plume/model';
import type { OpenDecision } from './types';

/** Compare a client with the authority log. Both providers use this. */
export function decideOpen(state: EditorState, room: RoomLog): OpenDecision {
  if (room.version > state.collab.version) {
    const missed = stepsSince(room, state.collab.version);
    if (missed && state.collab.version + missed.length === room.version) {
      return { type: 'remote', from: state.collab.version, steps: missed, version: room.version };
    }
    return { type: 'snapshot', doc: room.doc, version: room.version };
  }
  if (room.version < state.collab.version || diffSteps(room.doc, state.doc).length > 0) {
    return { type: 'diverge', doc: room.doc, version: room.version };
  }
  return null;
}
