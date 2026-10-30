import { useEffect, useRef, useState } from 'react';

/** Re-renders every `ms` so countdowns and "x ago" labels stay live. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useDebounced<T>(value: T, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

/** Animates a number from its previous value to `target`. Skips animation in tests. */
export function useCountUp(target: number, duration = 600) {
  const instant = import.meta.env.MODE === 'test';
  const [val, setVal] = useState(instant ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (instant) { setVal(target); return; }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(origin + (target - origin) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, instant]);
  return val;
}

export function useEscape(handler: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && handler();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handler, active]);
}

export function useStoredState(key: string, initial: boolean) {
  const [v, setV] = useState<boolean>(() => {
    try { const s = localStorage.getItem(key); return s === null ? initial : s === '1'; } catch { return initial; }
  });
  const set = (next: boolean) => {
    setV(next);
    try { localStorage.setItem(key, next ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  return [v, set] as const;
}
