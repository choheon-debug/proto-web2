// 예상 득점 모델 (포아송): 해외 승무패·언더오버 확률에 맞춰 두 팀 예상 득점을 구하고,
// 그걸로 프로토 핸디캡·언더오버 확률을 "추정"한다. 승무패와 어긋나지 않게 점수차 분포를 시장 확률에 맞춰 다시 맞춘다.
import type { Trio } from "./types";

const N = 11;   // 0~10골
function pois(l: number) {
  const out = [Math.exp(-l)];
  for (let k = 1; k < N; k++) out.push(out[k - 1] * l / k);
  return out;
}
function grid(lh: number, la: number) {
  const h = pois(lh), a = pois(la);
  return h.map(x => a.map(y => x * y));
}
function summary(lh: number, la: number) {
  const g = grid(lh, la);
  let ph = 0, pd = 0, pa = 0;
  const margin = new Map<number, number>(), total = new Array(2 * N).fill(0);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const p = g[i][j];
    if (i > j) ph += p; else if (i === j) pd += p; else pa += p;
    margin.set(i - j, (margin.get(i - j) ?? 0) + p);
    total[i + j] += p;
  }
  return { ph, pd, pa, margin, total };
}
const under = (total: number[], line: number) => total.reduce((s, p, k) => (k < line ? s + p : s), 0);

/** 시장 확률(승무패)과 언더 확률(있으면)에 가장 잘 맞는 예상 득점 */
export function fitModel(p: Trio, uo?: { line: number; under: number } | null) {
  const err = (lh: number, la: number) => {
    const s = summary(lh, la);
    let e = (s.ph - p[0]) ** 2 + (s.pa - p[2]) ** 2;
    if (uo) e += (under(s.total, uo.line) - uo.under) ** 2;
    return e;
  };
  let best = { lh: 1.4, la: 1.1, e: Infinity };
  for (let lh = 0.2; lh <= 4.01; lh += 0.1) for (let la = 0.2; la <= 4.01; la += 0.1) {
    const e = err(lh, la);
    if (e < best.e) best = { lh, la, e };
  }
  const c = { ...best };
  for (let lh = c.lh - 0.1; lh <= c.lh + 0.1; lh += 0.01) for (let la = c.la - 0.1; la <= c.la + 0.1; la += 0.01) {
    if (lh <= 0.05 || la <= 0.05) continue;
    const e = err(lh, la);
    if (e < best.e) best = { lh, la, e };
  }
  return { lh: +best.lh.toFixed(3), la: +best.la.toFixed(3) };
}

/** 핸디캡(홈에 line을 더함) 승·무·패 확률. 점수차 분포를 시장 승무패 확률에 맞춰 다시 맞춘 값 */
export function handiProbs(model: { lh: number; la: number }, market: Trio, line: number): Trio | null {
  if (!Number.isInteger(line)) return null;
  const s = summary(model.lh, model.la);
  const scale = (k: number) => (k > 0 ? market[0] / s.ph : k === 0 ? market[1] / s.pd : market[2] / s.pa);
  let w = 0, d = 0, l = 0;
  for (const [k, p] of s.margin) {
    const q = p * scale(k), m = k + line;
    if (m > 0) w += q; else if (m === 0) d += q; else l += q;
  }
  const t = w + d + l;
  return [w / t, d / t, l / t];
}

/** 언더 확률 (기준점은 x.5만) */
export function underProb(model: { lh: number; la: number }, line: number): number | null {
  if (Number.isInteger(line)) return null;
  return under(summary(model.lh, model.la).total, line);
}
