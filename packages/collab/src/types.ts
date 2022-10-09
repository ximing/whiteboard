import type { Document, EditorState, Point, Step, View } from '@plume/model';

/** Ephemeral pointer. A trail is a laser. `presenting` offers others this client's camera. */
export type PresenceCursor = {
  x: number;
  y: number;
  name?: string;
  color?: string;
  trail?: Point[];
  presenting?: boolean;
  view?: View;
};

/** What the editor learns from a provider. Camera changes are not steps. */
export type CollabEvent =
  | { type: 'confirm'; count: number; version: number }
  | { type: 'remote'; steps: Step[]; version: number }
  | { type: 'snapshot'; doc: Document; version: number }
  | { type: 'diverge'; doc: Document; version: number }
  | { type: 'peers'; count: number }
  | { type: 'status'; status: 'connecting' | 'live' | 'offline'; detail?: string }
  | {
      type: 'cursor';
      clientId: string;
      x: number;
      y: number;
      color: string;
      name?: string;
      active: boolean;
      trail?: Point[];
      presenting?: boolean;
      view?: View;
    };

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
  /** Ephemeral pointer. Omit it and the board simply shows no remote cursor. */
  presence?(cursor: PresenceCursor | null): void;
}

export function cleanPresence(cursor: PresenceCursor | null): (PresenceCursor & { active: true }) | null {
  if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null;
  const trail = cursor.trail?.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).slice(-24);
  const view =
    cursor.presenting && cursor.view && Number.isFinite(cursor.view.zoom) && Number.isFinite(cursor.view.panX) && Number.isFinite(cursor.view.panY)
      ? cursor.view
      : undefined;
  return {
    x: cursor.x,
    y: cursor.y,
    name: cursor.name,
    color: cursor.color,
    trail: trail && trail.length ? trail : undefined,
    presenting: cursor.presenting || undefined,
    view,
    active: true,
  };
}

const CURSOR_COLORS = ['#0e7a6d', '#1d4e89', '#9f2d22', '#7a4e9a', '#c47b16', '#1f7a4d', '#b3402f', '#3d6b8a'];

export function cursorColor(clientId: string): string {
  let hash = 0;
  for (let index = 0; index < clientId.length; index += 1) hash = (hash * 33 + clientId.charCodeAt(index)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}
