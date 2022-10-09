import type { EditorState, RoomLog } from '@plume/model';
import { decideOpen } from './decide';
import { cleanPresence, cursorColor, type CollabProvider, type CollabSession, type OpenDecision } from './types';
import type { ClientWire, ServerWire } from './wire';

export type ServerProviderOptions = {
  /** WebSocket URL of the Plume authority. */
  url: string;
  /** One authority hosts many boards. */
  boardId: string;
  /**
   * Account credential. Pass a string or a function the provider calls on each connect.
   * The reference server treats a missing token as anonymous until a product sets `authorize`.
   */
  token?: string | (() => string | Promise<string>);
};

type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

const OPEN = 1;

function isServerWire(value: unknown): value is ServerWire {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'welcome' || kind === 'accepted' || kind === 'catchup' || kind === 'peers' || kind === 'presence' || kind === 'rejected';
}

/**
 * Client SDK for a Plume authority. Steps are the same ones the editor already
 * commits. The host supplies the socket URL and, later, the account token.
 */
export function createServerProvider(options: ServerProviderOptions): CollabProvider {
  let socket: SocketLike | null = null;
  let session: CollabSession | null = null;
  let latest: EditorState | null = null;
  let ready = false;
  let closed = false;
  let flight = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let clientId = '';
  let authFailed = false;
  let generation = 0;
  let settle: ((decision: OpenDecision) => void) | null = null;

  function emitStatus(status: 'connecting' | 'live' | 'offline', detail?: string) {
    session?.emit({ type: 'status', status, detail });
  }

  function send(message: ClientWire) {
    if (!socket || socket.readyState !== OPEN) return;
    socket.send(JSON.stringify(message));
  }

  function roomFromWelcome(message: Extract<ServerWire, { kind: 'welcome' }>): RoomLog {
    return { version: message.version, base: message.base, doc: message.doc, steps: message.steps };
  }

  function onServer(message: ServerWire, handshake: ((decision: OpenDecision) => void) | null) {
    if (!session || !latest) return handshake;
    if (message.kind === 'rejected') {
      ready = false;
      flight = false;
      authFailed = true;
      emitStatus('offline', message.reason);
      handshake?.(null);
      socket?.close();
      return null;
    }
    if (message.kind === 'welcome') {
      const decision = decideOpen(latest, roomFromWelcome(message));
      ready = true;
      attempts = 0;
      emitStatus('live');
      session.emit({ type: 'peers', count: message.peers });
      if (handshake) handshake(decision);
      else if (decision) session.emit(decision);
      return null;
    }
    if (message.kind === 'peers') {
      session.emit({ type: 'peers', count: message.count });
      return handshake;
    }
    if (message.kind === 'presence') {
      if (message.clientId !== clientId) {
        session.emit({
          type: 'cursor',
          clientId: message.clientId,
          x: message.x,
          y: message.y,
          color: message.color,
          name: message.name,
          active: message.active,
          trail: message.trail,
          presenting: message.presenting,
          view: message.view,
        });
      }
      return handshake;
    }
    if (message.kind === 'accepted') {
      if (message.clientId === clientId) {
        flight = false;
        session.emit({ type: 'confirm', count: message.steps.length, version: message.version });
        return handshake;
      }
      if (latest.collab.version + message.steps.length === message.version) {
        session.emit({ type: 'remote', steps: message.steps, version: message.version });
      } else if (message.version > latest.collab.version) {
        send({ kind: 'sync', clientId, version: latest.collab.version });
      }
      return handshake;
    }
    flight = false;
    if (latest.collab.version >= message.version) return handshake;
    if (message.steps && message.from === latest.collab.version) {
      session.emit({ type: 'remote', steps: message.steps, version: message.version });
    } else {
      session.emit({ type: 'snapshot', doc: message.doc, version: message.version });
    }
    return handshake;
  }

  function detachSocket() {
    const current = socket;
    socket = null;
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    current.close();
  }

  function scheduleReconnect(gen: number) {
    if (closed || authFailed || gen !== generation) return;
    const delay = Math.min(8000, 400 * 2 ** attempts);
    attempts += 1;
    retry = globalThis.setTimeout(() => {
      if (gen !== generation || closed || authFailed) return;
      open(null, gen);
    }, delay);
  }

  function open(handshake: ((decision: OpenDecision) => void) | null, gen: number) {
    if (closed || gen !== generation || !session || !latest) {
      handshake?.(null);
      return;
    }
    emitStatus('connecting');
    const next = new WebSocket(options.url) as SocketLike;
    socket = next;
    next.onopen = () => {
      void (async () => {
        if (socket !== next || gen !== generation || !session || !latest) return;
        try {
          const token = typeof options.token === 'function' ? await options.token() : options.token;
          if (socket !== next || gen !== generation || closed || !session || !latest) return;
          send({
            kind: 'hello',
            clientId,
            boardId: options.boardId,
            token,
            version: latest.collab.version,
            doc: latest.doc,
          });
        } catch (error) {
          if (gen !== generation) return;
          authFailed = true;
          emitStatus('offline', error instanceof Error ? error.message : 'Sign-in failed');
          next.close();
        }
      })();
    };
    next.onmessage = (event) => {
      if (socket !== next || gen !== generation) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data)) as unknown;
      } catch {
        return;
      }
      if (!isServerWire(parsed)) return;
      handshake = onServer(parsed, handshake);
    };
    next.onerror = () => {
      /* close follows */
    };
    next.onclose = () => {
      if (socket !== next || gen !== generation) return;
      ready = false;
      flight = false;
      socket = null;
      if (handshake) {
        handshake(null);
        handshake = null;
      }
      if (!authFailed) emitStatus('offline');
      scheduleReconnect(gen);
    };
  }

  return {
    id: 'server',
    label: 'Server',
    connect(next) {
      const gen = ++generation;
      authFailed = false;
      closed = false;
      ready = false;
      flight = false;
      attempts = 0;
      globalThis.clearTimeout(retry);
      detachSocket();
      session = next;
      clientId = next.clientId;
      latest = next.getState();
      return new Promise<OpenDecision>((resolve) => {
        let settled = false;
        const finish = (decision: OpenDecision) => {
          if (settled) return;
          settled = true;
          if (settle === finish) settle = null;
          globalThis.clearTimeout(giveUp);
          resolve(gen === generation ? decision : null);
        };
        settle = finish;
        const giveUp = globalThis.setTimeout(() => {
          if (gen !== generation) {
            finish(null);
            return;
          }
          emitStatus('offline', 'The authority did not answer');
          finish(null);
        }, 8000);
        open(finish, gen);
      });
    },
    presence(cursor) {
      if (!ready || closed) return;
      const clean = cleanPresence(cursor);
      send({
        kind: 'presence',
        clientId,
        x: clean?.x ?? 0,
        y: clean?.y ?? 0,
        color: clean?.color || cursorColor(clientId),
        name: clean?.name,
        active: !!clean,
        trail: clean?.trail,
        presenting: clean?.presenting,
        view: clean?.view,
      });
    },
    sync(state) {
      latest = state;
      if (!ready || closed || flight || state.collab.unconfirmed.length === 0) return;
      flight = true;
      send({ kind: 'submit', clientId, version: state.collab.version, steps: state.collab.unconfirmed });
    },
    disconnect() {
      generation += 1;
      closed = true;
      ready = false;
      globalThis.clearTimeout(retry);
      const pending = settle;
      settle = null;
      detachSocket();
      session = null;
      pending?.(null);
    },
  };
}


