import { expect, spyOn, test } from 'bun:test';
import { loggerOutput } from './helpers/ui-runtime';
import { log } from '../frontend/logger';

test('errors reach the plugin console and Millennium\'s DevTools logger; info only DevTools', () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  loggerOutput.length = 0;
  try {
    const failure = new Error('Steam structure changed');
    log.error('Library installation failed:', failure);
    log.info('Parsed feed');

    expect(errors.mock.calls).toEqual([['[External Data Sources] Library installation failed:', failure]]);
    expect(loggerOutput).toEqual([
      { level: 'error', args: ['Library installation failed:', failure] },
      { level: 'log', args: ['Parsed feed'] },
    ]);
  } finally {
    errors.mockRestore();
  }
});
