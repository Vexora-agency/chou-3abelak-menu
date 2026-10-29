/**
 * Runs fn when the main thread goes idle (post-paint, settled tree), with a
 * setTimeout ceiling so it still runs on busy devices. Returns a cancel fn.
 *
 * Use for first-time geometry reads: measuring on a dirty post-commit tree
 * forces a full-page synchronous layout (hundreds of ms on a low-end phone
 * with a big menu); the same reads on a settled tree cost ~nothing.
 */
export function scheduleIdle(fn: () => void, timeoutMs: number): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  const to = window.setTimeout(run, timeoutMs);
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(
      () => {
        window.clearTimeout(to);
        run();
      },
      { timeout: timeoutMs }
    );
    return () => {
      done = true;
      window.clearTimeout(to);
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id);
    };
  }
  return () => {
    done = true;
    window.clearTimeout(to);
  };
}
