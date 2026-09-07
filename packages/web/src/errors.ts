/**
 * One place to turn a caught `unknown` into something showable. Storage reasons
 * and the store's error banner must format the same underlying failure the same
 * way, so both go through here.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
