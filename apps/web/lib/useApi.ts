"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./auth";

/** Loads a merchant API path once, with a reload function and a plain error. */
export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api.get<T>(path).then((d) => { setData(d); setError(null); }, (e: Error) => setError(e.message));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

/** What one part of a page knows: still loading, failed, or the answer. */
export type Part<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };

/** Like useApi, but a 404 is a normal answer ("none yet") and becomes `null`. Each part of a page fails on its own. */
export function usePart<T>(path: string): Part<T | null> {
  const [part, setPart] = useState<Part<T | null>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    api.get<T>(path).then(
      (value) => live && setPart({ status: "ready", value }),
      (e: Error & { code?: string }) => live && setPart(e.code === "not_found" ? { status: "ready", value: null } : { status: "error", message: e.message }),
    );
    return () => { live = false; };
  }, [path]);
  return part;
}
