import { createDocument, createEditor } from '@plume/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalProvider } from './local';

describe('local provider', () => {
  let liveChannels = 0;
  let liveTimers = 0;
  const RealChannel = globalThis.BroadcastChannel;

  afterEach(() => {
    vi.unstubAllGlobals();
    liveChannels = 0;
    liveTimers = 0;
  });

  it('keeps one channel when connect is interrupted', async () => {
    class CountingChannel extends RealChannel {
      private stopped = false;
      constructor(name: string) {
        super(name);
        liveChannels += 1;
      }
      override close() {
        if (this.stopped) return;
        this.stopped = true;
        liveChannels -= 1;
        super.close();
      }
    }
    vi.stubGlobal('BroadcastChannel', CountingChannel);
    vi.stubGlobal('window', {
      setInterval: (handler: TimerHandler, timeout?: number) => {
        liveTimers += 1;
        return setInterval(handler, timeout);
      },
      clearInterval: (id: ReturnType<typeof setInterval>) => {
        liveTimers = Math.max(0, liveTimers - 1);
        clearInterval(id);
      },
    });

    const provider = createLocalProvider();
    const state = createEditor(createDocument());
    const first = provider.connect({ clientId: 'a', getState: () => state, emit() {} });
    provider.disconnect();
    const second = provider.connect({ clientId: 'b', getState: () => state, emit() {} });
    await Promise.all([first, second]);
    expect(liveChannels).toBe(1);
    expect(liveTimers).toBe(1);
    provider.disconnect();
    expect(liveChannels).toBe(0);
    expect(liveTimers).toBe(0);
  });
});
