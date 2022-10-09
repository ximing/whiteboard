import {
  authorityReceive,
  seedRoom,
  stepsSince,
  type Document,
  type EditorState,
  type RoomLog,
  type Step,
} from '@plume/model';
import { decideOpen } from './decide';
import { cleanPresence, cursorColor, type CollabEvent, type CollabProvider, type CollabSession, type OpenDecision } from './types';

const ROOM_KEY = 'plume.room.v1';
const CHANNEL = 'plume.collab.v1';
const LOCK = 'plume.collab.v1';

type Submit = { kind: 'submit'; clientID: string; version: number; steps: Step[] };
type Accepted = { kind: 'accepted'; clientID: string; version: number; steps: Step[] };
type Catchup = { kind: 'catchup'; clientID: string; from: number; steps: Step[] | null; version: number; doc: Document };
type Hello = { kind: 'hello'; clientID: string };
type Cursor = {
  kind: 'cursor';
  clientID: string;
  x: number;
  y: number;
  color: string;
  name?: string;
  active: boolean;
  trail?: { x: number; y: number }[];
  presenting?: boolean;
  view?: { panX: number; panY: number; zoom: number };
};
type Wire = Submit | Accepted | Catchup | Hello | Cursor;

function isRoom(value: unknown): value is RoomLog {
  if (!value || typeof value !== 'object') return false;
  const room = value as RoomLog;
  return typeof room.version === 'number' && typeof room.base === 'number' && !!room.doc && Array.isArray(room.doc.objects) && Array.isArray(room.steps);
}

/**
 * Same-browser authority. `BroadcastChannel` carries steps and `navigator.locks`
 * orders them. Enough for the demo site. A product uses `createServerProvider`.
 */
export function createLocalProvider(boardId?: string): CollabProvider {
  const roomKey = boardId ? `${ROOM_KEY}:${boardId}` : ROOM_KEY;
  const channelName = boardId ? `${CHANNEL}:${boardId}` : CHANNEL;
  const lockName = boardId ? `${LOCK}:${boardId}` : LOCK;
  let cursorAt = 0;
  let channel: BroadcastChannel | null = null;
  let timer = 0;
  let ready = false;
  let closed = false;
  let latest: EditorState | null = null;
  let session: CollabSession | null = null;
  let clientID = '';
  let flight: { version: number; count: number } | null = null;
  let memory: RoomLog | null = null;
  const peers = new Map<string, number>();
  let peerCount = 0;
  let generation = 0;

  function emit(event: CollabEvent) {
    session?.emit(event);
  }

  function readRoom(): RoomLog | null {
    try {
      const raw = localStorage.getItem(roomKey);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isRoom(parsed)) {
          memory = parsed;
          return parsed;
        }
      }
    } catch {
      /* Keep the in-memory log if storage is unreadable. */
    }
    return memory;
  }

  function writeRoom(room: RoomLog) {
    memory = room;
    try {
      localStorage.setItem(roomKey, JSON.stringify(room));
    } catch {
      /* Other tabs still hear the accepted broadcast. */
    }
  }

  function lock<T>(body: () => T): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(lockName, body);
    return Promise.resolve(body());
  }

  function post(message: Wire) {
    channel?.postMessage(message);
  }

  function publishPeers() {
    const now = Date.now();
    for (const [id, at] of peers) {
      if (now - at > 6000) peers.delete(id);
    }
    peers.set(clientID, now);
    if (peers.size === peerCount) return;
    peerCount = peers.size;
    emit({ type: 'peers', count: peers.size });
  }

  function catchUp(room: RoomLog) {
    if (!latest || room.version <= latest.collab.version) return;
    const missed = stepsSince(room, latest.collab.version);
    if (missed && latest.collab.version + missed.length === room.version) {
      emit({ type: 'remote', steps: missed, version: room.version });
      return;
    }
    emit({ type: 'snapshot', doc: room.doc, version: room.version });
  }

  async function handleSubmit(message: Submit) {
    const gen = generation;
    await lock(() => {
      if (closed || gen !== generation) return;
      const room = readRoom();
      if (!room) return;
      const result = authorityReceive(room, message.version, message.steps);
      if (result.type === 'accepted') {
        writeRoom(result.room);
        post({ kind: 'accepted', clientID: message.clientID, version: result.room.version, steps: result.steps });
        flight = null;
        emit({ type: 'confirm', count: result.steps.length, version: result.room.version });
        return;
      }
      flight = null;
      catchUp(readRoom() ?? room);
    });
  }

  function onMessage(event: MessageEvent<Wire>) {
    const message = event.data;
    if (!message || typeof message !== 'object' || !latest) return;
    if (message.kind === 'hello') {
      peers.set(message.clientID, Date.now());
      publishPeers();
      return;
    }
    if (message.kind === 'cursor') {
      if (message.clientID === clientID) return;
      emit({
        type: 'cursor',
        clientId: message.clientID,
        x: message.x,
        y: message.y,
        color: message.color,
        name: message.name,
        active: message.active,
        trail: message.trail,
        presenting: message.presenting,
        view: message.view,
      });
      return;
    }
    if (message.kind === 'accepted') {
      if (message.clientID === clientID) return;
      if (latest.collab.version + message.steps.length === message.version) {
        emit({ type: 'remote', steps: message.steps, version: message.version });
      } else if (message.version > latest.collab.version) {
        const gen = generation;
        void lock(() => {
          if (closed || gen !== generation) return;
          const room = readRoom();
          if (room) catchUp(room);
        });
      }
      return;
    }
    if (message.kind === 'catchup' && message.clientID === clientID) {
      flight = null;
      if (latest.collab.version >= message.version) return;
      if (message.steps && message.from === latest.collab.version) emit({ type: 'remote', steps: message.steps, version: message.version });
      else emit({ type: 'snapshot', doc: message.doc, version: message.version });
    }
  }

  return {
    id: 'local',
    label: 'Local',
    async connect(next: CollabSession): Promise<OpenDecision> {
      const gen = ++generation;
      window.clearInterval(timer);
      timer = 0;
      channel?.close();
      channel = null;
      session = next;
      clientID = next.clientId;
      latest = next.getState();
      closed = false;
      ready = false;
      flight = null;
      if (typeof BroadcastChannel === 'undefined') {
        if (gen !== generation) return null;
        ready = true;
        emit({ type: 'status', status: 'live' });
        return null;
      }
      const mine = new BroadcastChannel(channelName);
      channel = mine;
      mine.onmessage = onMessage;
      peers.set(clientID, Date.now());
      const decision = await lock(() => {
        if (gen !== generation) return null;
        let room = readRoom();
        if (!room) {
          room = seedRoom(latest!.doc);
          writeRoom(room);
        }
        return decideOpen(latest!, room);
      });
      if (closed || gen !== generation) {
        if (channel === mine) {
          mine.close();
          channel = null;
        }
        return null;
      }
      ready = true;
      post({ kind: 'hello', clientID });
      publishPeers();
      emit({ type: 'status', status: 'live' });
      timer = window.setInterval(() => {
        if (closed || gen !== generation) return;
        post({ kind: 'hello', clientID });
        publishPeers();
        void lock(() => {
          if (closed || gen !== generation) return;
          const room = readRoom();
          if (room) catchUp(room);
        });
      }, 3000);
      return decision;
    },
    presence(cursor) {
      if (!ready || closed) return;
      const now = Date.now();
      if (cursor && now - cursorAt < 40) return;
      cursorAt = now;
      const clean = cleanPresence(cursor);
      post({
        kind: 'cursor',
        clientID,
        x: clean?.x ?? 0,
        y: clean?.y ?? 0,
        color: clean?.color || cursorColor(clientID),
        name: clean?.name,
        active: !!clean,
        trail: clean?.trail,
        presenting: clean?.presenting,
        view: clean?.view,
      });
    },
    sync(state: EditorState) {
      latest = state;
      if (!ready || closed || flight || state.collab.unconfirmed.length === 0) return;
      const steps = state.collab.unconfirmed;
      flight = { version: state.collab.version, count: steps.length };
      void handleSubmit({ kind: 'submit', clientID, version: state.collab.version, steps });
    },
    disconnect() {
      generation += 1;
      closed = true;
      ready = false;
      window.clearInterval(timer);
      timer = 0;
      channel?.close();
      channel = null;
      session = null;
    },
  };
}
