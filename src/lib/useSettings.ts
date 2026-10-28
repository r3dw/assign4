"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "terminal";
export const SIZES = [-2, -1, 0, 1, 2, 3];

export function load(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable: ignore */
  }
}

/**
 * Theme, text size and display options, persisted in localStorage.
 *
 * The inline script in layout.tsx applies the saved theme and size before first
 * paint. This hook picks the same values up after mount (so server and client
 * markup match) and keeps <html> in sync afterwards.
 */
export function useSettings() {
  const [ready, setReady] = useState(false);
  const [theme, setThemeState] = useState<Theme>("light");
  const [size, setSizeState] = useState(0);
  const [older, setOlder] = useState(false);
  const [beta, setBeta] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const t = root.dataset.theme;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser-only storage after mount
    setThemeState(t === "dark" || t === "terminal" ? t : "light");
    setSizeState(Number(root.dataset.size || 0));
    setOlder(load("showOlder", "false") === "true");
    setBeta(load("showBeta", "false") === "true");
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  useEffect(() => {
    if (!ready) return;
    if (size === 0) delete document.documentElement.dataset.size;
    else document.documentElement.dataset.size = String(size);
  }, [ready, size]);

  const setTheme = useCallback((t: Theme, persist = true) => {
    setThemeState(t);
    if (persist) save("theme", t);
  }, []);

  const setSize = useCallback((s: number, persist = true) => {
    const clamped = Math.max(SIZES[0], Math.min(SIZES[SIZES.length - 1], s));
    setSizeState(clamped);
    if (persist) save("textSize", clamped);
  }, []);

  const setOptions = useCallback((o: boolean, b: boolean, persist = true) => {
    setOlder(o);
    setBeta(b);
    if (persist) {
      save("showOlder", o);
      save("showBeta", b);
    }
  }, []);

  return { theme, size, older, beta, setTheme, setSize, setOptions };
}

export type Settings = ReturnType<typeof useSettings>;
