// 경기 하나의 판정: 해외 배당(시장 확률) + AI 보정 → 최종 확률, 프로토 배당과 비교한 평균 수익률
import { applyAdjust, expectedReturn, fairProbs, verdict, type Verdict } from "./odds";
import type { Match, Trio } from "./types";

export type Saved = { market: Trio | null; ai: { adjust: number[]; summary: string; info: string[]; form: { home: string; away: string }; sources: { title: string; url: string }[] }; at: string; mock?: boolean };

export type Outcome = { proto: number | null; over: number | null; prob: number | null; ev: number | null; verdict: Verdict | null; higher: boolean | null };
export type Evaluation = {
  probs: Trio | null;          // 최종 확률
  market: Trio | null;         // 시장 확률
  outcomes: Outcome[];         // 승·무·패
  tag: "good" | "normal" | "bad" | "noProto" | "noOver";
  best: number | null;         // 가장 좋은 평균 수익률
};

export function evaluate(m: Match, proto: Trio | null | undefined, saved?: Saved | null): Evaluation {
  const market = m.odds ? fairProbs(m.odds) : null;
  const probs = market && saved?.ai ? applyAdjust(market, saved.ai.adjust as Trio) : market;
  const outcomes: Outcome[] = [0, 1, 2].map(i => {
    const p = proto?.[i] ?? null, o = m.odds?.[i] ?? null, prob = probs?.[i] ?? null;
    const ev = p && prob != null ? expectedReturn(prob, p) : null;
    return { proto: p, over: o, prob, ev, verdict: ev == null ? null : verdict(ev), higher: p && o ? p > o : null };
  });
  const evs = outcomes.map(o => o.ev).filter((x): x is number => x != null);
  const best = evs.length ? Math.max(...evs) : null;
  const tag = !m.odds ? "noOver" : !proto ? "noProto" : best! >= 0.02 ? "good" : best! <= -0.06 ? "bad" : "normal";
  return { probs, market, outcomes, tag, best };
}

export const TAG_UI: Record<Evaluation["tag"], { label: string; cls: string }> = {
  good: { label: "덜 불리", cls: "tag-g" },
  normal: { label: "보통", cls: "tag-n" },
  bad: { label: "프로토 불리", cls: "tag-r" },
  noProto: { label: "프로토 배당 없음", cls: "tag-a" },
  noOver: { label: "해외 배당 없음", cls: "tag-n" },
};

/** 1만 원 걸면 평균 얼마가 남거나 모자라나 */
export const per10k = (ev: number) => `${ev >= 0 ? "+" : "−"}${Math.abs(Math.round(ev * 10000)).toLocaleString()}원`;
