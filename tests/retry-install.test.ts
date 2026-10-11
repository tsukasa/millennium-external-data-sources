import { expect, spyOn, test } from 'bun:test';
import { retryInstall } from '../frontend/steam/retry-install';

function fakeTimers() {
  const originalTimeout = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const scheduled: { callback: () => void; delay: number; id: number }[] = [];
  const cleared: unknown[] = [];
  let ids = 0;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    scheduled.push({ callback, delay, id: ++ids });
    return ids as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: unknown) => { cleared.push(timer); }) as typeof clearTimeout;
  return {
    scheduled,
    cleared,
    run() { scheduled.shift()!.callback(); },
    restore() {
      globalThis.setTimeout = originalTimeout;
      globalThis.clearTimeout = originalClear;
    },
  };
}

test('installation polls at the base interval while modules are unavailable and stops on success', () => {
  const timers = fakeTimers();
  try {
    const stopImmediate = retryInstall(() => true, 500);
    expect(timers.scheduled).toHaveLength(0);
    stopImmediate();

    let attempts = 0;
    retryInstall(() => ++attempts === 3, 500);
    expect(attempts).toBe(1);
    expect(timers.scheduled[0].delay).toBe(500);
    timers.run();
    expect(timers.scheduled[0].delay).toBe(500);
    timers.run();
    expect(attempts).toBe(3);
    expect(timers.scheduled).toHaveLength(0);

    const cancel = retryInstall(() => false, 500);
    const pending = timers.scheduled[0].id;
    cancel();
    expect(timers.cleared).toContain(pending);
  } finally {
    timers.restore();
  }
});

test('thrown installation attempts back off, log once per message and give up', () => {
  const timers = fakeTimers();
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  try {
    let attempts = 0;
    retryInstall(() => { attempts++; throw new Error('Steam structure changed'); }, 500,
      { name: 'Library installation', maxFailures: 5, maxDelayMs: 4_000 });
    const delays: number[] = [];
    while (timers.scheduled.length) {
      delays.push(timers.scheduled[0].delay);
      timers.run();
    }
    expect(attempts).toBe(5);
    expect(delays).toEqual([1_000, 2_000, 4_000, 4_000]);
    expect(errors.mock.calls.map(([message]) => String(message))).toEqual([
      '[External Data Sources] Library installation failed:',
      '[External Data Sources] Library installation stopped after 5 failed attempts',
    ]);
  } finally {
    errors.mockRestore();
    timers.restore();
  }
});
