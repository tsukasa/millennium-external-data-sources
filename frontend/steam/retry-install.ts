/** Steam loads private modules lazily. Stop polling once installation succeeds. */
export function retryInstall(install: () => boolean, intervalMs: number): () => void {
  const timer = install() ? undefined : setInterval(() => {
    if (install())
      clearInterval(timer);
  }, intervalMs);

  return () => clearInterval(timer);
}
