import { useState, useEffect, useCallback, useRef } from "react";

export const API_URL = import.meta.env.VITE_API_URL || "";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function useApi() {
  return { apiFetch, API_URL };
}

/**
 * Generic data-fetching hook with loading, error, and retry support.
 * Pass `null` as path to skip fetching.
 */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const currentPath = useRef(path);
  currentPath.current = path;

  const fetchData = useCallback(async () => {
    const p = currentPath.current;
    if (!p) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}${p}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "Not found" : `Error ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (path) {
      setData(null);
      fetchData();
    } else {
      setLoading(false);
    }
  }, [path, fetchData]);

  return { data, loading, error, retry: fetchData };
}
