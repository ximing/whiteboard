import type { ClientWire, ServerWire } from '@plume/collab';
import { authorityReceive, createDocument, seedRoom, stepsSince, type Document, type RoomLog, type Step } from '@plume/model';

export type AuthorizeResult = { userId: string } | { error: string };

/** Plug the account system in here. Without it, every connection is anonymous. */
export type Authorize = (input: {
  token?: string;
  boardId: string;
  clientId: string;
}) => AuthorizeResult | Promise<AuthorizeResult>;

export type HubClient = {
  send(message: ServerWire): void;
};

export type Member = HubClient & {
  id: string;
  boardId: string;
  userId: string;
};

function isDocument(value: unknown): value is Document {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Document;
  return (
    Array.isArray(doc.objects) &&
    (doc.theme === 'light' || doc.theme === 'dark') &&
    typeof doc.rev === 'number' &&
    !!doc.view &&
    typeof doc.view.zoom === 'number'
  );
}

export function createHub(options?: { authorize?: Authorize }) {
  const rooms = new Map<string, RoomLog>();
  const members = new Map<string, Set<Member>>();
  const chains = new Map<string, Promise<unknown>>();

  function enqueue<T>(boardId: string, job: () => Promise<T> | T): Promise<T> {
    const prev = chains.get(boardId) ?? Promise.resolve();
    const run = prev.then(job, job);
    chains.set(
      boardId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  function broadcast(boardId: string, message: ServerWire) {
    for (const member of members.get(boardId) ?? []) member.send(message);
  }

  return {
    join(client: HubClient, hello: Extract<ClientWire, { kind: 'hello' }>) {
      const boardId = hello.boardId;
      return enqueue(boardId, async (): Promise<Member | undefined> => {
        if (!boardId || !hello.clientId) {
          client.send({ kind: 'rejected', reason: 'A board and a client are required' });
          return;
        }
        const auth = options?.authorize
          ? await options.authorize({ token: hello.token, boardId, clientId: hello.clientId })
          : { userId: 'anonymous' };
        if ('error' in auth) {
          client.send({ kind: 'rejected', reason: auth.error });
          return;
        }
        let room = rooms.get(boardId);
        if (!room) {
          room = seedRoom(isDocument(hello.doc) ? hello.doc : createDocument());
          rooms.set(boardId, room);
        }
        const member: Member = { send: client.send, id: hello.clientId, boardId, userId: auth.userId };
        let group = members.get(boardId);
        if (!group) {
          group = new Set();
          members.set(boardId, group);
        }
        for (const existing of group) {
          if (existing.id === hello.clientId) group.delete(existing);
        }
        group.add(member);
        member.send({
          kind: 'welcome',
          version: room.version,
          base: room.base,
          steps: room.steps,
          doc: room.doc,
          peers: group.size,
        });
        broadcast(boardId, { kind: 'peers', count: group.size });
        return member;
      });
    },

    submit(member: Member, version: number, steps: Step[]) {
      return enqueue(member.boardId, async () => {
        const room = rooms.get(member.boardId);
        if (!room || !Array.isArray(steps) || steps.length === 0) return;
        const result = authorityReceive(room, version, steps);
        if (result.type === 'accepted') {
          rooms.set(member.boardId, result.room);
          broadcast(member.boardId, {
            kind: 'accepted',
            clientId: member.id,
            version: result.room.version,
            steps: result.steps,
          });
          return;
        }
        member.send({
          kind: 'catchup',
          clientId: member.id,
          from: version,
          steps: result.steps,
          version: result.version,
          doc: result.doc,
        });
      });
    },

    sync(member: Member, version: number) {
      return enqueue(member.boardId, async () => {
        const room = rooms.get(member.boardId);
        if (!room || version === room.version) return;
        member.send({
          kind: 'catchup',
          clientId: member.id,
          from: version,
          steps: stepsSince(room, version),
          version: room.version,
          doc: room.doc,
        });
      });
    },

    leave(member: Member) {
      return enqueue(member.boardId, async () => {
        const group = members.get(member.boardId);
        group?.delete(member);
        broadcast(member.boardId, { kind: 'peers', count: group?.size ?? 0 });
      });
    },
  };
}
