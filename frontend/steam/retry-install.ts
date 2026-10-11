interface RetryInstallOptions {
  /** Integration name used in log messages. */
  name?: string;
  /** Thrown attempts after which installation stops. */
  maxFailures?: number;
  /** Upper bound for the delay after thrown attempts. */
  maxDelayMs?: number;
}

/**
 * Steam loads private modules lazily, so installation is retried until it succeeds.
 *
 * `install` returns false while modules are still missing; these cheap checks repeat
 * every `intervalMs` so lazily opened views are patched without delay. A thrown error
 * means the modules exist but no longer match. Such attempts may scan or render Steam
 * internals, so they back off exponentially and stop after `maxFailures`.
 */
export function retryInstall(install: () => boolean, intervalMs: number,
  { name = 'Installation', maxFailures = 8, maxDelayMs = 30_000 }: RetryInstallOptions = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let failures = 0;
  let lastMessage: string | undefined;

  const attempt = () => {
    timer = undefined;
    let delay = intervalMs;

    try {
      if (install())
        return;
    } catch (error) {
      failures++;

      const message = String(error);
      if (message !== lastMessage)
        console.error(`[External Data Sources] ${name} failed:`, error);
      lastMessage = message;

      if (failures >= maxFailures) {
        console.error(`[External Data Sources] ${name} stopped after ${failures} failed attempts`);
        return;
      }

      delay = Math.min(intervalMs * 2 ** failures, maxDelayMs);
    }

    if (!stopped)
      timer = setTimeout(attempt, delay);
  };

  attempt();

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
