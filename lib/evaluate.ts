// 경기 하나의 판정: 해외 배당(시장 확률) + AI 보정 → 최종 확률, 프로토 배당과 비교한 평균 수익률
import { handi2Win, handiProbs, underProb } from "./model";
import { applyAdjust, expectedReturn, fairProbs, verdict, type Verdict } from "./odds";
import type { Extra, Match, Pick, Trio } from "./types";

export type Saved = { market: Trio | null; ai: { adjust: number[]; summary: string; info: string[]; form: { home: string; away: string }; sources: { title: string; url: string }[] }; at: string; mock?: boolean };

export type Outcome = { proto: number | null; over: number | null; prob: number | null; ev: number | null; verdict: Verdict | null; higher: boolean | null };
/** 핸디캡·언더오버 한 칸 */
export type ExtraOutcome = { label: string; proto: number; prob: number | null; ev: number | null; verdict: Verdict | null; est: boolean; pick: Pick };
export type Evaluation = {
  probs: Trio | null;          // 최종 확률
  market: Trio | null;         // 시장 확률
  outcomes: Outcome[];         // 승·무·패
  extras: ExtraOutcome[];      // 핸디캡·언더오버
  tag: "good" | "normal" | "bad" | "noProto" | "noOver";
  best: number | null;         // 가장 좋은 평균 수익률
};

/** 예상 득점 모델로 추정한 확률은 오차가 커서 더 엄격하게: +5% 이상만 덜 불리 */
const estVerdict = (ev: number): Verdict => (ev >= 0.05 ? "good" : ev <= -0.06 ? "avoid" : "normal");
export const handiLabel = (line: number) => `핸디 ${line > 0 ? "+" : ""}${line}`;

export function evaluate(m: Match, proto: Trio | null | undefined, saved?: Saved | null, extra?: Extra[] | null): Evaluation {
  const market = m.odds ? fairProbs(m.odds) : null;
  const probs = market && saved?.ai ? applyAdjust(market, saved.ai.adjust as Trio) : market;
  const outcomes: Outcome[] = [0, 1, 2].map(i => {
    const p = proto?.[i] ?? null, o = m.odds?.[i] ?? null, prob = probs?.[i] ?? null;
    const ev = p && prob != null ? expectedReturn(prob, p) : null;
    return { proto: p, over: o, prob, ev, verdict: ev == null ? null : verdict(ev), higher: p && o ? p > o : null };
  });
  const extras = (extra ?? []).flatMap(x => extraOutcomes(m, probs, x));
  const evs = [...outcomes, ...extras].map(o => o.ev).filter((x): x is number => x != null);
  const best = evs.length ? Math.max(...evs) : null;
  const anyGood = [...outcomes, ...extras].some(o => o.verdict === "good");
  const tag = !m.odds ? "noOver" : !proto && !extras.length ? "noProto" : anyGood ? "good" : best! <= -0.06 ? "bad" : "normal";
  return { probs, market, outcomes, extras, tag, best };
}

function extraOutcomes(m: Match, probs: Trio | null, x: Extra): ExtraOutcome[] {
  if (x.kind === "handi") {
    const p = probs && m.model ? handiProbs(m.model, probs, x.line) : null;
    return x.odds.map((o, i) => {
      const ev = p ? expectedReturn(p[i], o) : null;
      return { label: `${handiLabel(x.line)} ${["승", "무", "패"][i]}`, proto: o, prob: p?.[i] ?? null, ev, verdict: ev == null ? null : estVerdict(ev), est: true, pick: { kind: "handi", line: x.line, pick: i } };
    });
  }
  if (x.kind === "handi2") {
    const w = probs && m.model ? handi2Win(m.model, probs, x.line) : null;
    return x.odds.map((o, i) => {
      const prob = w == null ? null : i === 0 ? w : 1 - w, ev = prob == null ? null : expectedReturn(prob, o);
      return { label: `${handiLabel(x.line)} ${i === 0 ? "승" : "패"}`, proto: o, prob, ev, verdict: ev == null ? null : estVerdict(ev), est: true, pick: { kind: "handi2", line: x.line, pick: i } };
    });
  }
  // 언더오버: 해외에 같은 기준점이 있으면 그 시장 확률, 없으면 모델 추정
  const t = m.totals && m.totals.line === x.line ? m.totals : null;
  const u = t ? (1 / t.under) / (1 / t.under + 1 / t.over) : m.model ? underProb(m.model, x.line) : null;
  return x.odds.map((o, i) => {
    const prob = u == null ? null : i === 0 ? u : 1 - u, ev = prob == null ? null : expectedReturn(prob, o);
    return { label: `${i === 0 ? "언더" : "오버"} ${x.line}`, proto: o, prob, ev, verdict: ev == null ? null : t ? verdict(ev) : estVerdict(ev), est: !t, pick: { kind: "uo", line: x.line, pick: i } };
  });
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
