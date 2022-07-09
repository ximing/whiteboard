import { createServerProvider, reduceCollab, type CollabEvent, type CollabSession } from '@plume/collab';
import { addObject, commit, createDocument, createEditor, makeStroke, undo, type EditorState } from '@plume/model';
import { afterEach, describe, expect, it } from 'vitest';
import { createPlumeServer, type PlumeServer } from './index';

const open: Array<{ close: () => void }> = [];
let server: PlumeServer | null = null;

afterEach(async () => {
  for (const provider of open) provider.close();
  open.length = 0;
  if (server) await server.close();
  server = null;
});

function waitFor(check: () => boolean): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > 4000) {
        clearInterval(timer);
        reject(new Error('timed out waiting for the authority'));
      }
    }, 15);
  });
}

function connectClient(url: string, boardId: string, token?: string) {
  let state = createEditor(createDocument());
  const events: CollabEvent[] = [];
  const provider = createServerProvider({ url, boardId, token });
  const session: CollabSession = {
    clientId: `client-${open.length}-${Math.random().toString(16).slice(2)}`,
    getState: () => state,
    emit(event) {
      events.push(event);
      if (event.type === 'peers' || event.type === 'status') return;
      state = reduceCollab(state, event);
      provider.sync(state);
    },
  };
  open.push({ close: () => provider.disconnect() });
  return {
    provider,
    events,
    get state() {
      return state;
    },
    set state(value: EditorState) {
      state = value;
    },
    async start() {
      const decision = await provider.connect(session);
      if (decision) {
        state = reduceCollab(state, decision);
        provider.sync(state);
      }
    },
  };
}

describe('server provider', () => {
  it('lets a second connect replace one that was cancelled', async () => {
    server = await createPlumeServer({ port: 0 });
    let state = createEditor(createDocument());
    const provider = createServerProvider({ url: server.url, boardId: 'strict-mode' });
    open.push({ close: () => provider.disconnect() });
    const statuses: string[] = [];
    const session = {
      clientId: 'second',
      getState: () => state,
      emit(event: CollabEvent) {
        if (event.type === 'status') statuses.push(event.status);
        if (event.type === 'peers' || event.type === 'status') return;
        state = reduceCollab(state, event);
      },
    };
    const cancelled = provider.connect({
      clientId: 'first',
      getState: () => state,
      emit() {},
    });
    provider.disconnect();
    const decision = await provider.connect(session);
    expect(await cancelled).toBeNull();
    expect(decision).toBeNull();
    await waitFor(() => statuses.includes('live'));
    expect(statuses.filter((status) => status === 'live')).toHaveLength(1);
  });

  it('orders a stroke and its undo across two clients', async () => {
    server = await createPlumeServer({ port: 0 });
    const alice = connectClient(server.url, 'board-a', 'dev');
    const bob = connectClient(server.url, 'board-a', 'dev');
    await alice.start();
    await bob.start();

    const stroke = makeStroke(
      [
        { x: 4, y: 6 },
        { x: 40, y: 18 },
        { x: 70, y: 8 },
      ],
      { tool: 'pen', color: '#1d4e89', size: 4, id: 'stroke-shared' },
    );
    alice.state = commit(alice.state, addObject(alice.state.doc, stroke));
    alice.provider.sync(alice.state);
    await waitFor(() => bob.state.doc.objects.some((object) => object.id === 'stroke-shared'));

    alice.state = undo(alice.state);
    alice.provider.sync(alice.state);
    await waitFor(() => bob.state.doc.objects.length === 0 && bob.state.doc.rev > alice.state.doc.rev - 1);
    expect(alice.state.doc.objects.length).toBe(0);
    expect(bob.state.doc.objects.length).toBe(0);
    expect(bob.state.collab.version).toBeGreaterThan(0);
  });

  it('rejects a token the account hook does not accept', async () => {
    server = await createPlumeServer({
      port: 0,
      authorize: ({ token }) => (token === 'secret' ? { userId: 'ada' } : { error: 'Sign in required' }),
    });
    const client = connectClient(server.url, 'board-b', 'nope');
    await client.start();
    await waitFor(() => client.events.some((event) => event.type === 'status' && event.status === 'offline' && event.detail === 'Sign in required'));
  });
});
