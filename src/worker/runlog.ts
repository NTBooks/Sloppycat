// The running commentary a check writes as it goes, and the state the popup and settings read it from.
import type { RunState } from "../types";
import { MAX_RUN_LOG } from "../types";
import * as storage from "../storage";

/**
 * Append a line to the running commentary. Every page load, every wait and every result goes
 * through here, because the alternative is a window appearing with no explanation, which is a
 * window that gets closed.
 */
export async function log(text: string, bad = false): Promise<void> {
  const at = new Date().toISOString();
  await storage.update("runState", (cur) => {
    // Lazily open one rather than dropping the line. Work started from the wizard is not a run, and
    // a page load nobody narrates is a page load the user closes.
    const base = cur && !cur.endedAt ? cur : { startedAt: at, queue: [], done: 0, log: [] };
    return { ...base, beatAt: at, log: [...base.log, { at, text, bad }].slice(-MAX_RUN_LOG) };
  });
}

/** Publish what the run is doing, so a click on "Check now" is visibly doing something. */
export async function setRun(patch: Partial<RunState> | null): Promise<void> {
  if (patch === null) {
    await storage.update("runState", (cur) => (cur ? { ...cur, endedAt: new Date().toISOString(), currentKey: undefined, currentLabel: undefined, phase: undefined } : cur));
    return;
  }
  const beatAt = new Date().toISOString();
  await storage.update("runState", (cur) => ({ ...(cur ?? { startedAt: beatAt, queue: [], done: 0, log: [] }), ...patch, beatAt }));
}
