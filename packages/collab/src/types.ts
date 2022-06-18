import type { Document, EditorState, Step } from '@plume/model';

/** What the editor learns from a provider. View changes never travel. */
export type CollabEvent =
  | { type: 'confirm'; count: number; version: number }
  | { type: 'remote'; steps: Step[]; version: number }
  | { type: 'snapshot'; doc: Document; version: number }
  | { type: 'diverge'; doc: Document; version: number }
  | { type: 'peers'; count: number }
  | { type: 'status'; status: 'connecting' | 'live' | 'offline'; detail?: string };

/** First look at the room, before the editor sends unconfirmed steps. */
export type OpenDecision =
  | { type: 'diverge'; doc: Document; version: number }
  | { type: 'remote'; from: number; steps: Step[]; version: number }
  | { type: 'snapshot'; doc: Document; version: number }
  | null;

export type CollabSession = {
  clientId: string;
  getState: () => EditorState;
  emit: (event: CollabEvent) => void;
};

/**
 * One way to order steps. The demo mounts the local provider.
 * A product mounts the server provider against its authority.
 * A host can also implement this interface itself.
 */
export interface CollabProvider {
  readonly id: string;
  readonly label: string;
  connect(session: CollabSession): Promise<OpenDecision>;
  disconnect(): void;
  sync(state: EditorState): void;
}
