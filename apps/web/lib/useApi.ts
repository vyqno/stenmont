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
