import { beforeEach, expect, test } from 'bun:test';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { installBackend, useAsyncStatus, getPluginI18nString } from './helpers/ui-runtime';

beforeEach(installBackend);

test('shared form feedback keeps the newest result when an older request fails later', async () => {
  document.body.replaceChildren();
  let state: ReturnType<typeof useAsyncStatus> | undefined;
  function Probe() {
    state = useAsyncStatus();
    return h('div', { role: state.error ? 'alert' : 'status' }, state.status);
  }
  const root = createRoot(document.body);
  let reject!: (reason: Error) => void;
  const slow = new Promise<void>((_resolve, fail) => { reject = fail; });
  let first: Promise<void> | undefined;
  try {
    await act(async () => root.render(h(Probe)));
    await act(async () => { first = state!.run(() => slow, 'loading'); });
    await act(async () => { await state!.run(async () => {}, 'saving', 'feedSettingsSaved'); });
    expect(state!.busy).toBe(false);
    await act(async () => { reject(new Error('stale failure')); await first; });
    expect(document.querySelector('[role="status"]')?.textContent).toBe(getPluginI18nString('feedSettingsSaved'));
    expect(state!.error).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});
