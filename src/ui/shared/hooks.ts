import { useEffect, useState } from "preact/hooks";
import * as storage from "../../storage";
import type { Schema } from "../../storage";
import { isRunning, type RunLogEntry } from "../../types";

/** Live view of a storage key; re-renders when it changes. */
export function useStorage<K extends keyof Schema>(key: K): [Schema[K] | undefined, (v: Schema[K]) => Promise<void>] {
  const [value, setValue] = useState<Schema[K] | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    // A read that throws would land as an uncaught error on the page with no useful stack.
    const load = () =>
      void storage
        .get(key)
        .then((v) => alive && setValue(v))
        .catch((e: unknown) => console.error("Sloppycat: could not read", key, e));
    load();
    const off = storage.onChange([key], load);
    return () => {
      alive = false;
      off();
    };
  }, [key]);
  return [value, (v) => storage.set(key, v)];
}

export function useHash(): string {
  const [hash, setHash] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

/**
 * Live view of the check currently running. A run that ends without saying so (Chrome stopped the
 * worker) goes stale on its own, so the tick keeps a button from sitting on "Checking..." forever.
 */
export function useRun(): { running: boolean; currentKey?: string; label?: string; phase?: string; done: number; total: number; log: RunLogEntry[] } {
  const [run] = useStorage("runState");
  const [, tick] = useState(0);
  const live = isRunning(run);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [live]);
  return {
    running: live,
    currentKey: run?.currentKey,
    label: run?.currentLabel,
    phase: run?.phase,
    done: run?.done ?? 0,
    total: run?.queue.length ?? 0,
    log: run?.log ?? [],
  };
}
