"use client";
// 경기 분석: 배당 비교표 → 승·무·패 판정 → (AI 분석) 핵심 정보 → 기록장에 추가
import { useState } from "react";
import { evaluate, per10k, type Saved } from "@/lib/evaluate";
import { checkBet } from "@/lib/guard";
import { leagueName } from "@/lib/leagues";
import { pct } from "@/lib/odds";
import { uid } from "@/lib/store";
import { gameDate, isLateNight, kstTime, prettyDate, todayKst } from "@/lib/time";
import { OUTCOMES, type Bet, type Extra, type Match, type Trio } from "@/lib/types";
import { ProtoInputs } from "./DayList";
import type { Limits } from "./App";

type Props = {
  m: Match; proto: Trio | null; extra?: Extra[]; saved: Saved | null; onBack: () => void;
  onProto: (o: Trio | null) => void; onSaved: (s: Saved) => void;
  bets: Bet[]; limits: Limits; onBet: (b: Bet) => void; say: (t: string) => void;
};

const VERDICT = {
  good: { t: "🟢 덜 불리", c: "bg-[var(--acc2)] text-[var(--acc)]" },
  normal: { t: "⚪ 보통", c: "bg-[#f1f2f4] text-[#5f6670]" },
  avoid: { t: "🔴 피하기", c: "bg-[var(--red2)] text-[var(--red)]" },
};

export default function MatchDetail({ m, proto, extra, saved, onBack, onProto, onSaved, bets, limits, onBet, say }: Props) {
  const [editProto, setEditProto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const ev = evaluate(m, proto, saved, extra);
  const aiAdj = saved?.ai.adjust.some(x => x !== 0);

  const analyze = async (refresh = false) => {
    setBusy(true); setErr(""); setStatus("요청 보내는 중…");
    try {
      const res = await fetch(`/api/analyze${refresh ? "?refresh=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ match: m }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error || "분석을 시작하지 못했어요");
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const p of parts) {
          if (!p.startsWith("data: ")) continue;
          const e = JSON.parse(p.slice(6));
          if (e.type === "status") setStatus(e.message);
          else if (e.type === "error") throw new Error(e.message);
          else onSaved({ market: e.market, ai: e.ai, at: e.at, mock: e.mock });
        }
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); setStatus(""); }
  };

  return (
    <div>
      <button onClick={onBack} className="mb-2 text-sm font-bold muted">‹ {prettyDate(gameDate(m.kickoff))}</button>
      <section className="card mb-3">
        <div className="text-xs muted">{leagueName(m.league)} · {prettyDate(gameDate(m.kickoff))} {isLateNight(m.kickoff) ? "밤(다음날 새벽) " : ""}{kstTime(m.kickoff)}</div>
        <h1 className="mb-3 mt-0.5 text-[1.35rem] font-extrabold leading-snug">{m.home} vs {m.away}</h1>
        <table className="w-full text-sm num">
          <thead><tr className="text-xs muted"><th className="text-left font-bold" />{OUTCOMES.map(o => <th key={o} className="font-bold">{o}</th>)}</tr></thead>
          <tbody className="[&_td]:border-t [&_td]:border-[var(--line)] [&_td]:py-2 [&_td]:text-center [&_td:first-child]:text-left">
            <tr><td className="text-xs muted">해외 배당</td>{[0, 1, 2].map(i => <td key={i}>{m.odds?.[i]?.toFixed(2) ?? "–"}</td>)}</tr>
            <tr><td className="text-xs muted">시장 확률</td>{[0, 1, 2].map(i => <td key={i}>{ev.market ? pct(ev.market[i]) : "–"}</td>)}</tr>
            {aiAdj && <tr><td className="text-xs muted">AI 보정 후</td>{[0, 1, 2].map(i => <td key={i} className="font-bold">{ev.probs ? pct(ev.probs[i]) : "–"}</td>)}</tr>}
            <tr><td className="text-xs muted">프로토 배당</td>{[0, 1, 2].map(i => <td key={i} className="font-bold">
              <button onClick={() => setEditProto(true)} className={proto ? "" : "text-xs font-normal text-[var(--acc)] underline"}>{proto ? proto[i].toFixed(2) : "입력"}</button></td>)}</tr>
          </tbody>
        </table>
        {editProto && <div className="mt-2 grid grid-cols-3"><ProtoInputs init={proto} onDone={o => { if (o !== undefined) onProto(o); setEditProto(false); }} /></div>}
        {proto && m.odds && (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {ev.outcomes.map((o, i) => o.verdict && (
              <div key={i} className={`rounded-xl px-1 py-2 text-center text-xs font-bold ${VERDICT[o.verdict].c}`}>
                {OUTCOMES[i]}<br />{VERDICT[o.verdict].t}<br /><span className="font-normal">1만 원당 평균 {per10k(o.ev!)}</span>
              </div>
            ))}
          </div>
        )}
        {!!ev.extras.length && (
          <div className="mt-4">
            <b className="text-sm">핸디캡 · 언더오버</b>
            {m.totals && <span className="ml-1 text-xs muted">(해외 언더오버 {m.totals.line}: {m.totals.under.toFixed(2)} / {m.totals.over.toFixed(2)})</span>}
            {ev.extras.map((o, i) => (
              <div key={i} className="flex items-center justify-between gap-2 border-t border-[var(--line)] py-1.5 text-sm first-of-type:border-0">
                <span className="min-w-0">{o.label} <b className="num">{o.proto.toFixed(2)}</b>
                  <span className="ml-1 text-xs muted">확률 {o.prob != null ? pct(o.prob) : "–"}{o.est ? " (추정)" : ""}</span></span>
                {o.verdict && <span className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-bold ${VERDICT[o.verdict].c}`}>{VERDICT[o.verdict].t} {per10k(o.ev!)}</span>}
              </div>
            ))}
            <p className="mt-1 text-xs muted">&ldquo;추정&rdquo;은 해외 배당으로 구한 예상 득점으로 계산해 오차가 커요. 그래서 +5% 이상만 덜 불리로 봐요.</p>
          </div>
        )}
        {!proto && <p className="mt-2 text-sm muted">프로토 배당을 넣으면 승·무·패마다 덜 불리한지 알려 드려요.</p>}
        {!m.odds && <p className="mt-2 text-sm muted">해외 배당이 없어요 (이미 시작했거나 아직 배당이 안 나온 경기).</p>}
      </section>

      <section className="card mb-3">
        <div className="mb-1 flex items-center justify-between">
          <b>핵심 정보</b>
          {saved && <span className="text-xs muted">{new Date(saved.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })} 분석</span>}
        </div>
        {saved ? <>
          {saved.mock && <p className="mb-2 rounded-lg bg-[var(--amber2)] px-2 py-1 text-xs text-[var(--amber)]">🧪 예시 분석이에요 (Anthropic 키를 넣으면 실제 분석)</p>}
          <p className="mb-2">{saved.ai.summary}</p>
          {(saved.ai.form.home || saved.ai.form.away) && <div className="mb-2 space-y-1 text-sm">
            <Form team={m.home} f={saved.ai.form.home} /><Form team={m.away} f={saved.ai.form.away} />
          </div>}
          <ul className="list-disc space-y-1 pl-5 text-[0.95rem]">{saved.ai.info.map((x, i) => <li key={i}>{x}</li>)}</ul>
          {!!saved.ai.sources.length && <details className="mt-2 text-sm"><summary className="muted">출처 {saved.ai.sources.length}건</summary>
            <ol className="mt-1 list-decimal pl-5">{saved.ai.sources.map((s, i) => <li key={i}><a className="text-[var(--acc)] underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>)}</ol></details>}
        </> : <p className="text-sm muted">AI가 부상·결장, 최근 성적, 일정 부담을 검색해서 정리해요. (분석 1회에 Anthropic 크레딧이 조금 들어요)</p>}
        {busy ? <p className="mt-3 flex items-center gap-2 text-sm font-bold"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--acc2)] border-t-[var(--acc)]" />{status}</p>
          : <button className={`btn mt-3 w-full ${saved ? "btn-gray" : "btn-fill"}`} onClick={() => analyze(!!saved)}>{saved ? "↻ 다시 분석" : "🔍 AI 분석하기"}</button>}
        {err && <p className="mt-2 text-sm text-[var(--red)]">{err}</p>}
      </section>

      <p className="card mb-3 !bg-[var(--amber2)] text-sm text-[#7a5413]">⚠️ 참고용이에요. 결과를 보장하지 않아요. &ldquo;덜 불리&rdquo;는 이길 것 같다는 뜻이 아니라, 같은 결과에 프로토가 해외보다 배당을 더 줘서 <b>평균적으로 덜 손해 보는 선택</b>이라는 뜻이에요.</p>

      <AddBet m={m} proto={proto} ev={ev} bets={bets} limits={limits} onBet={onBet} say={say} />
    </div>
  );
}

function Form({ team, f }: { team: string; f: string }) {
  if (!f) return null;
  const C = { W: ["승", "bg-[var(--acc)]"], D: ["무", "bg-[#9aa1ab]"], L: ["패", "bg-[var(--red)]"] } as const;
  return <div className="flex items-center justify-between gap-2"><span className="truncate">{team}</span>
    <span className="flex gap-1">{f.split("").map((c, i) => <b key={i} className={`grid h-6 w-6 place-items-center rounded-md text-[0.7rem] text-white ${C[c as "W"][1]}`}>{C[c as "W"][0]}</b>)}</span></div>;
}

function AddBet({ m, proto, ev, bets, limits, onBet, say }: { m: Match; proto: Trio | null; ev: ReturnType<typeof evaluate>; bets: Bet[]; limits: Limits; onBet: (b: Bet) => void; say: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [stake, setStake] = useState("");
  if (!open) return <button className="btn btn-fill w-full" onClick={() => setOpen(true)}>🧾 기록장에 추가</button>;
  const amount = parseInt(stake.replace(/\D/g, ""), 10) || 0;
  const date = todayKst();
  const check = amount ? checkBet(bets, limits, amount, date) : { block: null, warn: null };
  const odds = pick != null ? proto?.[pick] ?? null : null;
  const kind = pick != null && ev.outcomes[pick].verdict === "good" ? "value" : "gut";
  return (
    <section className="card">
      <b>기록장에 추가</b>
      <p className="mb-2 text-xs muted">베트맨에서 실제로 구매한 것을 기록하세요.</p>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {OUTCOMES.map((o, i) => <button key={o} disabled={!proto} onClick={() => setPick(i)}
          className={`rounded-xl py-2 text-sm font-bold ${pick === i ? "bg-[var(--acc)] text-white" : "bg-[#f1f2f4]"}`}>{o} {proto ? proto[i].toFixed(2) : ""}</button>)}
      </div>
      {!proto && <p className="mb-2 text-sm muted">프로토 배당을 먼저 넣어 주세요.</p>}
      <input className="inp mb-2 num" inputMode="numeric" placeholder="건 금액 (원)" value={stake} onChange={e => setStake(e.target.value)} />
      {check.block && <p className="mb-2 rounded-lg bg-[var(--red2)] p-2 text-sm text-[var(--red)]">🛑 {check.block}</p>}
      {check.warn && <p className="mb-2 rounded-lg bg-[var(--amber2)] p-2 text-sm text-[#7a5413]">⚠️ {check.warn}</p>}
      {pick != null && <p className="mb-2 text-xs muted">{kind === "value" ? "🟢 분석대로 건 것으로 기록돼요" : "🎲 감으로 건 것으로 기록돼요"}</p>}
      <div className="flex gap-2">
        <button className="btn btn-fill flex-1" disabled={pick == null || !odds || !amount || !!check.block}
          onClick={() => { onBet({ id: uid(), date, label: `${m.home} vs ${m.away} · ${OUTCOMES[pick!]}`, odds: odds!, stake: amount, kind, result: "pending",
            match: { id: m.id, league: m.league, kickoff: m.kickoff, pick: pick as 0 | 1 | 2 } }); setOpen(false); setPick(null); setStake(""); }}>저장</button>
        <button className="btn btn-gray" onClick={() => { setOpen(false); say("취소했어요"); }}>취소</button>
      </div>
    </section>
  );
}
