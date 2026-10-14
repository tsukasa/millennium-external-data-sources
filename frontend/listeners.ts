import { log } from './logger';

/**
 * Calls every listener, even when an earlier one throws.
 * Listeners reach into Steam's private stores; one failing integration must not
 * abort a completed save or fetch, nor starve the remaining subscribers.
 */
export function notifyListeners<Args extends unknown[]>(listeners: Iterable<(...args: Args) => void>,
  ...args: Args): void {
  for (const listener of listeners) {
    try {
      listener(...args);
    } catch (error) {
      log.error('Listener failed', error);
    }
  }
}
