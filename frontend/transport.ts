// Millennium's live FFI deserializes JSON return strings; test/legacy transports may leave them encoded.
export function decodeResponse<T>(response: unknown): T {
  return (typeof response === 'string' ? JSON.parse(response) : response) as T;
}
