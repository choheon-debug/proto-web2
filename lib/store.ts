// 브라우저 저장 (localStorage). 시크릿 모드 등에서 실패해도 앱은 돌아가게.
"use client";
import { useEffect, useState } from "react";

export function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
/** localStorage와 함께 쓰는 상태 */
export function useStored<T>(key: string, fallback: T) {
  const [v, setV] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => { setV(load(key, fallback)); setReady(true); }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: T | ((p: T) => T)) => setV(prev => { const n = typeof next === "function" ? (next as (p: T) => T)(prev) : next; save(key, n); return n; });
  return [v, set, ready] as const;
}
export const uid = () => (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2));
export const won = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString()}`;
