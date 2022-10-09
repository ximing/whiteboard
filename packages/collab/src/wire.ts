import type { Document, Point, Step, View } from '@plume/model';

/** Client → authority. The same messages a WebSocket server and the local provider share. */
export type ClientWire =
  | { kind: 'hello'; clientId: string; boardId: string; token?: string; version: number; doc: Document }
  | { kind: 'submit'; clientId: string; version: number; steps: Step[] }
  | { kind: 'sync'; clientId: string; version: number }
  | {
      kind: 'presence';
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

/** Authority → client. */
export type ServerWire =
  | { kind: 'welcome'; version: number; base: number; steps: Step[]; doc: Document; peers: number }
  | { kind: 'accepted'; clientId: string; version: number; steps: Step[] }
  | { kind: 'catchup'; clientId: string; from: number; steps: Step[] | null; version: number; doc: Document }
  | { kind: 'peers'; count: number }
  | {
      kind: 'presence';
      clientId: string;
      x: number;
      y: number;
      color: string;
      name?: string;
      active: boolean;
      trail?: Point[];
      presenting?: boolean;
      view?: View;
    }
  | { kind: 'rejected'; reason: string };
