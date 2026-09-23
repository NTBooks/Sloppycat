// Deadlines for work the worker waits on.

/**
 * Give a promise a deadline. Loading the page had one and reading it did not, so a content script
 * that never answered left the check sitting on "Reading the page contents" for as long as the
 * browser stayed open, while the wizard promised it would stop by itself. It does now.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} gave up after ${Math.round(ms / 1000)}s`)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
