import { useCallback, useEffect, useRef, useState } from 'react';
import { getPluginI18nString } from '../i18n';

type StatusKey = Parameters<typeof getPluginI18nString>[0];

/** Shared feedback for loading and saving settings; ignore results after unmount. */
export interface AsyncStatus {
  busy: boolean;
  status: string;
  error: boolean;
  run: RunAsyncAction;
}

export type RunAsyncAction = (action: () => Promise<void>, pending?: StatusKey, success?: StatusKey) => Promise<void>;

/**
 * Custom hook for managing asynchronous action status.
 * Provides busy, status, error states and a run function to execute async actions.
 * @param initialStatus Optional initial status key to display.
 * @returns An object containing busy, status, error states and a run function.
 */
export function useAsyncStatus(initialStatus?: StatusKey): AsyncStatus {
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState(initialStatus ? getPluginI18nString(initialStatus) : '');
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async (action: () => Promise<void>, pending?: StatusKey, success?: StatusKey) => {
    const current = ++generation.current;
    const isCurrent = () => mounted.current && current === generation.current;
    setBusy(true);
    setError(false);
    setStatus(pending ? getPluginI18nString(pending) : '');
    try {
      await action();
      if (isCurrent())
        setStatus(success ? getPluginI18nString(success) : '');
    } catch (reason) {
      if (isCurrent()) {
        setError(true);
        setStatus(String(reason));
      }
    } finally {
      if (isCurrent())
        setBusy(false);
    }
  }, []);

  return { busy, status, error, run };
}
