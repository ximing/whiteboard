import type { Document, Step } from '@plume/model';

/** Client → authority. The same messages a WebSocket server and the local provider share. */
export type ClientWire =
  | { kind: 'hello'; clientId: string; boardId: string; token?: string; version: number; doc: Document }
  | { kind: 'submit'; clientId: string; version: number; steps: Step[] }
  | { kind: 'sync'; clientId: string; version: number };

/** Authority → client. */
export type ServerWire =
  | { kind: 'welcome'; version: number; base: number; steps: Step[]; doc: Document; peers: number }
  | { kind: 'accepted'; clientId: string; version: number; steps: Step[] }
  | { kind: 'catchup'; clientId: string; from: number; steps: Step[] | null; version: number; doc: Document }
  | { kind: 'peers'; count: number }
  | { kind: 'rejected'; reason: string };
