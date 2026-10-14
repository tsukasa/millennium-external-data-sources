import { log } from './logger';

/**
 * Decodes a response from the Steam client, handling both JSON strings and already-parsed objects.
 * Millennium's live FFI deserializes JSON return strings; test/legacy transports may leave them encoded.
 */
export function decodeResponse<T>(response: unknown): T {
  return (typeof response === 'string' ? JSON.parse(response) : response) as T;
}

/**
 * Runs a backend write and reports any failure with the given localized message.
 * Backend errors are English diagnostics; they are logged rather than shown.
 */
export async function backendWrite(write: () => Promise<boolean>, message: string): Promise<void> {
  let saved: boolean;

  try {
    saved = await write();
  } catch (error) {
    log.error(message, error);
    throw new Error(message, { cause: error });
  }

  if (!saved)
    throw new Error(message);
}
