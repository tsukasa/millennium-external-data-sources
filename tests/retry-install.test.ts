import { expect, test } from 'bun:test';
import { retryInstall } from '../frontend/steam/retry-install';

test('installation retries until success and can be stopped while modules are unavailable', () => {
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  let tick!: () => void;
  let timers = 0;
  const cleared: unknown[] = [];
  globalThis.setInterval = ((callback: () => void, interval: number) => {
    expect(interval).toBe(500);
    tick = callback;
    return ++timers as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  globalThis.clearInterval = ((timer: unknown) => { cleared.push(timer); }) as typeof clearInterval;
  try {
    const stopImmediate = retryInstall(() => true, 500);
    expect(timers).toBe(0);
    stopImmediate();

    let attempts = 0;
    const stop = retryInstall(() => ++attempts === 3, 500);
    expect(attempts).toBe(1);
    tick();
    expect(cleared).not.toContain(1);
    tick();
    expect(attempts).toBe(3);
    expect(cleared).toContain(1);
    stop();

    const cancel = retryInstall(() => false, 500);
    cancel();
    expect(cleared).toContain(2);
  } finally {
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
  }
});
