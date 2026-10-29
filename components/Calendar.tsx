"use client";
// 달력: 날짜 칸에 점 + 경기 수. 점 색: 🟢 덜 불리 경기 있음 · ⚪ 경기 있음
import { evaluate, type Saved } from "@/lib/evaluate";
import { todayKst } from "@/lib/time";
import type { ProtoMap } from "./App";

type Props = { month: string; setMonth: (m: string) => void; date: string; setDate: (d: string) => void; counts: Record<string, number>; proto: ProtoMap; saved: Record<string, Saved> };

export default function Calendar({ month, setMonth, date, setDate, counts, proto, saved }: Props) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = todayKst();
  const move = (d: number) => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(t.toISOString().slice(0, 7)); };

  // 프로토 배당을 넣은 경기 중 덜 불리한 게 있는 날 (AI 분석을 했으면 그 확률로)
  const goodDays = new Set<string>();
  for (const [id, p] of Object.entries(proto)) {
    if (!p.over) continue;
    const ev = evaluate(p.m ?? { id, league: "", kickoff: "", home: "", away: "", odds: p.over, books: 0 }, p.odds, saved[id], p.extra);
    if (ev.tag === "good") goodDays.add(p.date);
  }

  return (
    <section className="card mb-3">
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => move(-1)} className="h-9 w-9 rounded-xl bg-[#f1f2f4] font-bold" aria-label="이전 달">‹</button>
        <b className="text-lg">{y}년 {m}월</b>
        <button onClick={() => move(1)} className="h-9 w-9 rounded-xl bg-[#f1f2f4] font-bold" aria-label="다음 달">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {"일월화수목금토".split("").map((w, i) => <div key={w} className={`text-xs font-bold ${i === 0 ? "text-[var(--red)]" : i === 6 ? "text-[#2f6fd6]" : "muted"}`}>{w}</div>)}
        {Array.from({ length: first }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = `${month}-${String(i + 1).padStart(2, "0")}`, wd = (first + i) % 7, n = counts[d] ?? 0, sel = d === date;
          return (
            <button key={d} onClick={() => setDate(d)}
              className={`flex h-12 flex-col items-center justify-center rounded-xl text-[0.95rem] font-semibold
                ${sel ? "bg-[var(--acc)] text-white" : wd === 0 ? "text-[var(--red)]" : wd === 6 ? "text-[#2f6fd6]" : ""}
                ${d === today && !sel ? "ring-2 ring-[var(--acc)] ring-inset" : ""}`}>
              {i + 1}
              {n > 0 && <span className={`flex items-center gap-0.5 text-[0.62rem] leading-none ${sel ? "text-white" : "muted"}`}>
                <i className={`inline-block h-1.5 w-1.5 rounded-full ${goodDays.has(d) ? "bg-[var(--acc)]" : sel ? "bg-white" : "bg-[#b5bac1]"}`} style={sel && goodDays.has(d) ? { background: "#fff" } : undefined} />{n}
              </span>}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs muted">숫자는 경기 수 · <span className="text-[var(--acc)]">●</span> 덜 불리한 경기 있음</p>
    </section>
  );
}
