import { describe, expect, it } from 'vitest';
import {
  addObject,
  applyStep,
  authorityReceive,
  commit,
  confirmSteps,
  createDocument,
  createEditor,
  diffSteps,
  invertStep,
  makeStroke,
  receiveSteps,
  redo,
  seedRoom,
  undo,
  type ShapeObj,
  type Step,
} from './index';

function shape(id: string, cx: number, color: string): ShapeObj {
  return {
    id,
    z: 0,
    type: 'shape',
    kind: 'rect',
    cx,
    cy: 10,
    width: 40,
    height: 20,
    rotation: 0,
    stroke: color,
    fill: 'transparent',
    strokeWidth: 2,
  };
}

function withoutRev(doc: { rev: number }): string {
  return JSON.stringify({ ...doc, rev: 0 });
}

describe('collaborative steps', () => {
  it('inverts a committed edit back to the previous objects', () => {
    const start = createEditor(createDocument());
    const stroke = makeStroke(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
      ],
      { tool: 'pen', color: '#1d4e89', size: 4, id: 'ink' },
    );
    const edited = commit(start, addObject(start.doc, stroke));
    const steps = edited.collab.unconfirmed;
    let rolled = edited.doc;
    for (const step of [...steps].reverse()) {
      const result = applyStep(rolled, invertStep(step));
      expect(result.failed).toBeNull();
      rolled = result.doc;
    }
    console.log(
      `inverting committed steps restores the previous objects: steps ${steps.map((step) => step.type).join(',')}; empty ${rolled.objects.length === 0}`,
    );
    expect(steps.map((step) => step.type)).toEqual(['add']);
    expect(rolled.objects).toHaveLength(0);
    expect(edited.doc.objects).toHaveLength(1);
  });

  it('rebases a recolor over a remote move of the same object', () => {
    const base = addObject(createDocument(), shape('card', 0, '#1d4e89'));
    let local = createEditor(base);
    let remote = createEditor(base);
    const moved = {
      ...base,
      objects: base.objects.map((object) => (object.id === 'card' && object.type === 'shape' ? { ...object, cx: 80 } : object)),
    };
    const recolored = {
      ...base,
      objects: base.objects.map((object) => (object.id === 'card' && object.type === 'shape' ? { ...object, stroke: '#9f2d22' } : object)),
    };
    remote = commit(remote, moved);
    local = commit(local, recolored);
    const remoteSteps = remote.collab.unconfirmed;
    const version = remote.collab.version + remoteSteps.length;
    remote = confirmSteps(remote, remoteSteps.length, version);
    local = receiveSteps(local, remoteSteps, version);
    const card = local.doc.objects.find((object) => object.id === 'card');
    console.log(
      `rebase keeps both field changes: cx ${card && card.type === 'shape' ? card.cx : 'missing'}, stroke ${card && card.type === 'shape' ? card.stroke : 'missing'}`,
    );
    expect(card?.type).toBe('shape');
    if (card?.type === 'shape') {
      expect(card.cx).toBe(80);
      expect(card.stroke).toBe('#9f2d22');
    }
    expect(local.collab.unconfirmed.length).toBeGreaterThan(0);
  });

  it('drops a local update when a remote step deletes that object', () => {
    const base = addObject(createDocument(), shape('card', 0, '#1d4e89'));
    let local = createEditor(base);
    const recolored = {
      ...base,
      objects: base.objects.map((object) => (object.id === 'card' && object.type === 'shape' ? { ...object, stroke: '#9f2d22' } : object)),
    };
    local = commit(local, recolored);
    const deletion: Step = { type: 'delete', object: base.objects[0] };
    const next = receiveSteps(local, [deletion], local.collab.version + 1);
    console.log(
      `remote delete drops the rebased update: objects ${next.doc.objects.length}, unconfirmed ${next.collab.unconfirmed.length}`,
    );
    expect(next.doc.objects).toHaveLength(0);
    expect(next.collab.unconfirmed).toHaveLength(0);
  });

  it('two clients converge when the authority orders their steps', () => {
    const room0 = seedRoom(createDocument());
    let alice = createEditor(createDocument());
    let bob = createEditor(createDocument());
    alice = commit(alice, addObject(alice.doc, shape('a', 0, '#1d4e89')));
    let room = authorityReceive(room0, alice.collab.version, alice.collab.unconfirmed);
    expect(room.type).toBe('accepted');
    if (room.type !== 'accepted') return;
    alice = confirmSteps(alice, alice.collab.unconfirmed.length, room.room.version);
    bob = receiveSteps(bob, room.steps, room.room.version);
    bob = commit(bob, addObject(bob.doc, shape('b', 40, '#1f7a4d')));
    const second = authorityReceive(room.room, bob.collab.version, bob.collab.unconfirmed);
    expect(second.type).toBe('accepted');
    if (second.type !== 'accepted') return;
    bob = confirmSteps(bob, bob.collab.unconfirmed.length, second.room.version);
    alice = receiveSteps(alice, second.steps, second.room.version);
    const ids = alice.doc.objects.map((object) => object.id);
    console.log(
      `authority orders steps so both clients share the board: alice ${ids.join(',')} rev ${alice.collab.version}; bob ${bob.doc.objects.map((object) => object.id).join(',')} same ${withoutRev(alice.doc) === withoutRev(bob.doc)}`,
    );
    expect(ids).toEqual(['a', 'b']);
    expect(withoutRev(alice.doc)).toBe(withoutRev(bob.doc));
    expect(alice.collab.version).toBe(bob.collab.version);
  });

  it('undo then redo still round-trips through inverse steps', () => {
    let state = createEditor(createDocument());
    state = commit(state, addObject(state.doc, shape('box', 5, '#1d4e89')));
    const after = state.doc;
    const undone = undo(state);
    const redone = redo(undone);
    const steps = diffSteps(undone.doc, redone.doc);
    console.log(
      `undo then redo through steps: undone ${undone.doc.objects.length}, redo steps ${steps.map((step) => step.type).join(',')}, rev ${after.rev}<${undone.doc.rev}<${redone.doc.rev}`,
    );
    expect(undone.doc.objects).toHaveLength(0);
    expect(undone.doc.rev).toBeGreaterThan(after.rev);
    expect(redone.doc.rev).toBeGreaterThan(undone.doc.rev);
    expect(withoutRev(redone.doc)).toBe(withoutRev(after));
    expect(steps.some((step) => step.type === 'add')).toBe(true);
  });
});
