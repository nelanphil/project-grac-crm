"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type Latest<T> = { value: T; key: string; blocked: boolean };

/**
 * Saves `value` after edits settle. Changes made before `arm()` (for example,
 * defaults the form fills in on load) become the baseline instead of a save.
 */
export function useWorkOrderAutosave<T>({
  value,
  serialize,
  save,
  blocked = false,
  delayMs = 1200,
}: {
  value: T;
  serialize: (value: T) => string;
  save: (value: T) => Promise<void>;
  blocked?: boolean;
  delayMs?: number;
}) {
  const key = useMemo(() => serialize(value), [serialize, value]);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const armed = useRef(false);
  const lastSaved = useRef(key);
  const failedKey = useRef<string | null>(null);
  const latest = useRef<Latest<T>>({ value, key, blocked });
  const saveRef = useRef(save);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const rerun = useRef(false);
  const runRef = useRef<() => void>(() => {});

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const run = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!armed.current) return;
    if (inFlight.current) {
      rerun.current = true;
      return;
    }
    const next = latest.current;
    if (next.blocked || next.key === lastSaved.current) return;
    if (next.key === failedKey.current) return;
    inFlight.current = true;
    setStatus("saving");
    setError(null);
    saveRef.current(next.value)
      .then(() => {
        lastSaved.current = next.key;
        failedKey.current = null;
        setStatus(latest.current.key === next.key ? "saved" : "pending");
      })
      .catch((err: unknown) => {
        failedKey.current = next.key;
        setStatus("error");
        setError(
          err instanceof ApiError ? err.message : "Couldn't save changes.",
        );
      })
      .finally(() => {
        inFlight.current = false;
        if (rerun.current) {
          rerun.current = false;
          runRef.current();
        }
      });
  }, []);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    latest.current = { value, key, blocked };
    if (!armed.current) {
      lastSaved.current = key;
      return;
    }
    if (blocked || key === lastSaved.current) return;
    if (timer.current) clearTimeout(timer.current);
    setStatus((prev) => (prev === "saving" ? prev : "pending"));
    timer.current = setTimeout(() => runRef.current(), delayMs);
  }, [value, key, blocked, delayMs]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const next = latest.current;
      if (
        armed.current &&
        !next.blocked &&
        next.key !== lastSaved.current &&
        next.key !== failedKey.current
      ) {
        void saveRef.current(next.value).catch(() => {});
      }
    },
    [],
  );

  const arm = useCallback(() => {
    armed.current = true;
  }, []);

  const flush = useCallback(() => runRef.current(), []);

  const retry = useCallback(() => {
    failedKey.current = null;
    runRef.current();
  }, []);

  return { status, error, arm, flush, retry };
}
