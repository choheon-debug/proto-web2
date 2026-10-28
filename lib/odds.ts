// 배당 계산: 배당 → 확률, 배팅사 몫 빼기, 평균 수익률
import type { Trio } from "./types";

/** 배당을 확률로 (1/배당) */
export const implied = (odds: Trio): Trio => odds.map(o => 1 / o) as Trio;

/** 세 확률의 합에서 100%를 넘는 부분(배팅사 몫) */
export const margin = (odds: Trio) => implied(odds).reduce((a, b) => a + b, 0) - 1;

/** 배팅사 몫을 비율대로 빼서 합이 100%가 되게 */
export function fairProbs(odds: Trio): Trio {
  const p = implied(odds), s = p[0] + p[1] + p[2];
  return p.map(x => x / s) as Trio;
}

/** 1만 원을 걸면 평균 몇 % 돌아오나 (확률 × 배당 − 1) */
export const expectedReturn = (prob: number, odds: number) => prob * odds - 1;

export type Verdict = "good" | "normal" | "avoid";
/** 평균 수익률로 판정: +2% 이상 덜 불리, −6% 이하 피하기 */
export const verdict = (ev: number): Verdict => (ev >= 0.02 ? "good" : ev <= -0.06 ? "avoid" : "normal");

/** 확률 보정값(%p)을 더하고 다시 합 100%로 */
export function applyAdjust(p: Trio, adjPct: Trio): Trio {
  const q = p.map((x, i) => Math.max(0.01, x + adjPct[i] / 100));
  const s = q[0] + q[1] + q[2];
  return q.map(x => x / s) as Trio;
}

/** 조합(다폴더) 적중 확률과 배당 */
export function combo(legs: { prob: number; odds: number }[]) {
  return legs.reduce((a, l) => ({ prob: a.prob * l.prob, odds: a.odds * l.odds }), { prob: 1, odds: 1 });
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
