import { adoptSnapshot, confirmSteps, followRoom, receiveSteps, type EditorState } from '@plume/model';
import type { CollabEvent, OpenDecision } from './types';

/** Apply one provider event to the editor. Peers and link status do not touch the document. */
export function reduceCollab(state: EditorState, event: CollabEvent | OpenDecision): EditorState {
  if (!event || event.type === 'peers' || event.type === 'status' || event.type === 'cursor') return state;
  if (event.type === 'confirm') {
    if (state.collab.version >= event.version) return state;
    return confirmSteps(state, event.count, event.version);
  }
  if (event.type === 'diverge') return followRoom(state, event.doc, event.version);
  if (event.type === 'snapshot') {
    if (state.collab.version >= event.version) return state;
    return adoptSnapshot(state, event.doc, event.version);
  }
  if ('from' in event && state.collab.version !== event.from) return state;
  if (state.collab.version >= event.version) return state;
  return receiveSteps(state, event.steps, event.version);
}
