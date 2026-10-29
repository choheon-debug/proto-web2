"use client";
// 기록장: 이번 달 손익, 손실 한도 막대, 분석대로 vs 감으로, 기록 목록(결과 입력), 직접 기록
import { useState } from "react";
import { checkBet, monthStats, profit } from "@/lib/guard";
import { uid, won } from "@/lib/store";
import { todayKst } from "@/lib/time";
import type { Bet } from "@/lib/types";
import type { Limits } from "./App";

type Props = { bets: Bet[]; setBets: (f: (b: Bet[]) => Bet[]) => void; limits: Limits; say: (t: string) => void };

export default function Ledger({ bets, setBets, limits, say }: Props) {
  const [month, setMonth] = useState(todayKst().slice(0, 7));
  const s = monthStats(bets, month);
  const [y, m] = month.split("-").map(Number);
  const move = (d: number) => setMonth(new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7));
  const group = (k: Bet["kind"]) => {
    const l = s.settled.filter(b => b.kind === k);
    return { n: l.length, win: l.filter(b => b.result === "win").length, net: l.reduce((a, b) => a + profit(b), 0) };
  };
  const value = group("value"), gut = group("gut");
  const ratio = limits.monthlyLoss ? Math.min(1, s.loss / limits.monthlyLoss) : 0;
  const setResult = (id: string, result: Bet["result"]) => setBets(p => p.map(b => (b.id === id ? { ...b, result, auto: false } : b)));

  return (
    <div>
      <section className="card mb-3">
        <div className="mb-2 flex items-center justify-between">
          <button onClick={() => move(-1)} className="h-8 w-8 rounded-lg bg-[#f1f2f4] font-bold" aria-label="이전 달">‹</button>
          <b>{y}년 {m}월</b>
          <button onClick={() => move(1)} className="h-8 w-8 rounded-lg bg-[#f1f2f4] font-bold" aria-label="다음 달">›</button>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center num">
          <div className="rounded-xl bg-[#f4f5f7] py-2"><b className="block">{won(s.staked)}</b><span className="text-xs muted">건 돈</span></div>
          <div className="rounded-xl bg-[#f4f5f7] py-2"><b className="block">{won(s.returned)}</b><span className="text-xs muted">돌려받은 돈</span></div>
          <div className="rounded-xl bg-[#f4f5f7] py-2"><b className={`block ${s.net < 0 ? "text-[var(--red)]" : s.net > 0 ? "text-[var(--acc)]" : ""}`}>{s.net > 0 ? "+" : ""}{won(s.net)}</b><span className="text-xs muted">순손익</span></div>
        </div>
        {limits.monthlyLoss > 0 && <>
          <div className="mt-3 flex justify-between text-sm font-bold"><span>🛡 이번 달 손실 한도</span><span className="num muted">{won(s.loss)} / {won(limits.monthlyLoss)}원</span></div>
          <div className="my-1.5 h-3 overflow-hidden rounded-full bg-[#eef0f2]"><i className="block h-full bg-gradient-to-r from-[#f2a33a] to-[var(--red)]" style={{ width: `${ratio * 100}%` }} /></div>
          <p className="text-xs muted">한도의 80%가 되면 알려 드리고, 넘으면 이번 달 기록 추가를 멈춰요. (한도는 지킴이에서 바꿔요)</p>
        </>}
      </section>

      <section className="card mb-3">
        <b>분석대로 건 것 vs 감으로 건 것</b>
        <table className="mt-1 w-full text-sm num [&_td]:border-t [&_td]:border-[var(--line)] [&_td]:py-1.5 [&_td]:text-center [&_td:first-child]:text-left">
          <thead><tr className="text-xs muted"><th /><th>건수</th><th>적중</th><th>순손익</th></tr></thead>
          <tbody>
            {[["🟢 분석대로", value], ["🎲 감으로", gut]].map(([l, g]) => { const x = g as typeof value; return (
              <tr key={l as string}><td>{l as string}</td><td>{x.n}</td><td>{x.win}</td><td className={x.net < 0 ? "text-[var(--red)]" : x.net > 0 ? "text-[var(--acc)]" : ""}>{x.net > 0 ? "+" : ""}{won(x.net)}</td></tr>); })}
          </tbody>
        </table>
        <p className="mt-1 text-xs muted">결과가 나온 기록 기준이에요. 30건 넘게 쌓여야 차이를 믿을 만해요.</p>
      </section>

      <ManualAdd bets={bets} limits={limits} onAdd={b => { setBets(p => [b, ...p]); say("기록했어요"); }} />

      <section className="card">
        <b>기록 ({s.list.length}건)</b>
        {!s.list.length && <p className="mt-1 text-sm muted">이 달 기록이 없어요. 경기 분석 화면에서 &ldquo;기록장에 추가&rdquo;를 누르거나 위에서 직접 기록하세요.</p>}
        {s.list.map(b => (
          <div key={b.id} className="border-t border-[var(--line)] py-2.5 first-of-type:border-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="text-[0.95rem]">{b.label} · <span className="num">{b.odds.toFixed(2)}</span></div>
                <div className="text-xs muted">{b.date.slice(5).replace("-", "/")} · {won(b.stake)}원 · {b.kind === "value" ? "🟢" : "🎲"}{b.score ? ` · 결과 ${b.score}${b.auto ? " (자동)" : ""}` : ""}</div></div>
              <b className={`num shrink-0 ${profit(b) < 0 ? "text-[var(--red)]" : profit(b) > 0 ? "text-[var(--acc)]" : "muted"}`}>
                {b.result === "pending" ? "결과 전" : b.result === "void" ? "취소" : `${profit(b) > 0 ? "+" : ""}${won(profit(b))}`}</b>
            </div>
            <div className="mt-1.5 flex gap-1.5 text-xs">
              {(["win", "lose", "void"] as const).map(r => (
                <button key={r} onClick={() => setResult(b.id, b.result === r ? "pending" : r)}
                  className={`rounded-full px-3 py-1 font-bold ${b.result === r ? (r === "win" ? "bg-[var(--acc)] text-white" : r === "lose" ? "bg-[var(--red)] text-white" : "bg-[#5f6670] text-white") : "bg-[#f1f2f4] muted"}`}>
                  {r === "win" ? "적중" : r === "lose" ? "실패" : "취소"}</button>))}
              <button className="ml-auto muted" onClick={() => { if (confirm("이 기록을 지울까요?")) setBets(p => p.filter(x => x.id !== b.id)); }}>삭제</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/** 조합(여러 경기 묶음) 등 직접 기록 */
function ManualAdd({ bets, limits, onAdd }: { bets: Bet[]; limits: Limits; onAdd: (b: Bet) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(""), [odds, setOdds] = useState(""), [stake, setStake] = useState("");
  if (!open) return <button className="btn btn-out mb-3 w-full" onClick={() => setOpen(true)}>＋ 직접 기록 (조합 등)</button>;
  const o = parseFloat(odds.replace(",", ".")), amount = parseInt(stake.replace(/\D/g, ""), 10) || 0;
  const check = amount ? checkBet(bets, limits, amount, todayKst()) : { block: null, warn: null };
  return (
    <section className="card mb-3 space-y-2">
      <b>직접 기록</b>
      <input className="inp" placeholder="내용 (예: 3폴더 조합)" value={label} onChange={e => setLabel(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input className="inp num" inputMode="decimal" placeholder="배당 (예: 6.40)" value={odds} onChange={e => setOdds(e.target.value)} />
        <input className="inp num" inputMode="numeric" placeholder="건 금액 (원)" value={stake} onChange={e => setStake(e.target.value)} />
      </div>
      {o >= 1.01 && <p className="text-xs muted">이 배당이 맞으려면 대략 {Math.round(100 / o)}% 확률이 필요해요. 여러 경기를 묶을수록 적중 확률은 곱해져서 빠르게 낮아져요.</p>}
      {check.block && <p className="rounded-lg bg-[var(--red2)] p-2 text-sm text-[var(--red)]">🛑 {check.block}</p>}
      {check.warn && <p className="rounded-lg bg-[var(--amber2)] p-2 text-sm text-[#7a5413]">⚠️ {check.warn}</p>}
      <div className="flex gap-2">
        <button className="btn btn-fill flex-1" disabled={!label.trim() || !(o >= 1.01) || !amount || !!check.block}
          onClick={() => { onAdd({ id: uid(), date: todayKst(), label: label.trim(), odds: o, stake: amount, kind: "gut", result: "pending" }); setOpen(false); setLabel(""); setOdds(""); setStake(""); }}>저장</button>
        <button className="btn btn-gray" onClick={() => setOpen(false)}>취소</button>
      </div>
    </section>
  );
}
