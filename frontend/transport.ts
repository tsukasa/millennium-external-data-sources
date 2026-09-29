/**
 * Decodes a response from the Steam client, handling both JSON strings and already-parsed objects.
 * Millennium's live FFI deserializes JSON return strings; test/legacy transports may leave them encoded.
 * @template T The expected type of the decoded response.
 * @param response The response to decode, either as a JSON string or an already-parsed object.
 * @returns The decoded response typed as T.
 */
export function decodeResponse<T>(response: unknown): T {
  return (typeof response === 'string' ? JSON.parse(response) : response) as T;
}
