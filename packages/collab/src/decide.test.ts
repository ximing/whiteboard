import { addObject, createDocument, createEditor, makeStroke } from '@plume/model';
import { describe, expect, it } from 'vitest';
import { decideOpen } from './decide';

describe('decideOpen', () => {
  it('rebases a client that is ahead of an empty room', () => {
    const base = createDocument();
    const stroke = makeStroke(
      [
        { x: 0, y: 0 },
        { x: 20, y: 8 },
      ],
      { tool: 'pen', color: '#1d4e89', size: 4 },
    );
    const local = createEditor(addObject(base, stroke));
    const decision = decideOpen(local, { version: base.rev, base: base.rev, doc: base, steps: [] });
    expect(decision?.type).toBe('diverge');
    if (decision?.type === 'diverge') expect(decision.version).toBe(base.rev);
  });
});
