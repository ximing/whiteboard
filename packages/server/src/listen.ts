import type { ClientWire, ServerWire } from '@plume/collab';
import { WebSocketServer, type WebSocket } from 'ws';
import { createHub, type Authorize, type Member } from './hub';
import { loadRooms, saveRoom } from './store';

export type PlumeServerOptions = {
  port?: number;
  host?: string;
  /** When set, a connection needs a token your account system accepts. */
  authorize?: Authorize;
  /** Directory of room logs. Omit it and rooms stay in memory. */
  dataDir?: string;
};

export type PlumeServer = {
  url: string;
  port: number;
  close(): Promise<void>;
};

function parseClient(raw: unknown): ClientWire | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as ClientWire;
  if (message.kind === 'hello' || message.kind === 'submit' || message.kind === 'sync' || message.kind === 'presence') return message;
  return null;
}

export async function createPlumeServer(options: PlumeServerOptions = {}): Promise<PlumeServer> {
  const host = options.host ?? '127.0.0.1';
  const dataDir = options.dataDir || undefined;
  const hub = createHub({
    authorize: options.authorize,
    rooms: dataDir ? await loadRooms(dataDir) : undefined,
    onRoom: dataDir ? (boardId, room) => saveRoom(dataDir, boardId, room) : undefined,
  });
  const wss = new WebSocketServer({ port: options.port ?? 8790, host });

  wss.on('connection', (socket: WebSocket) => {
    let member: Member | undefined;
    const send = (message: ServerWire) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    socket.on('message', (data) => {
      let parsed: ClientWire | null = null;
      try {
        parsed = parseClient(JSON.parse(String(data)) as unknown);
      } catch {
        return;
      }
      if (!parsed) return;
      if (parsed.kind === 'hello') {
        void hub.join({ send }, parsed).then((next) => {
          member = next;
        });
        return;
      }
      if (!member || member.id !== parsed.clientId) return;
      if (parsed.kind === 'submit') void hub.submit(member, parsed.version, parsed.steps);
      else if (parsed.kind === 'presence') hub.presence(member, parsed);
      else void hub.sync(member, parsed.version);
    });
    socket.on('close', () => {
      if (member) void hub.leave(member);
    });
  });

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const address = wss.address();
      const port = typeof address === 'object' && address ? address.port : (options.port ?? 8790);
      resolve({
        url: `ws://${host}:${port}`,
        port,
        close: () =>
          new Promise((done, fail) => {
            wss.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
