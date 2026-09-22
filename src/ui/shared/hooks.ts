import { useEffect, useState } from "preact/hooks";
import * as storage from "../../storage";
import type { Schema } from "../../storage";

/** Live view of a storage key; re-renders when it changes. */
export function useStorage<K extends keyof Schema>(key: K): [Schema[K] | undefined, (v: Schema[K]) => Promise<void>] {
  const [value, setValue] = useState<Schema[K] | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => void storage.get(key).then((v) => alive && setValue(v));
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
