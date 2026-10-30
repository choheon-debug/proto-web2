"use client";
// 🔬 정밀 분석: 결장자·선발·주심·감독 검색 + 팀 시즌 기록·휴식·이동·날씨로 예상 득점 → 프로토 배당 판정
import { useState } from "react";
import { per10k } from "@/lib/evaluate";
import { pct } from "@/lib/odds";
import { CONFIG } from "@/lib/deep/engine";
import type { DeepPick, DeepResult } from "@/lib/deep/run";
import type { Extra, Match, Trio } from "@/lib/types";

const STEPS = ["결장자(부상·징계) 검색", "예상 선발·주심·감독 검색", "찾은 내용 정리", "팀 기록으로 예상 득점 계산", "프로토 배당 판정 · 설명 쓰기"];
const GRADE = { A: "충분", B: "보통", C: "부족" } as const;
const V = {
  good: { t: "🟢", n: "덜 불리", c: "bg-[var(--acc2)]" },
  normal: { t: "⚪", n: "덜 불리하지 않음", c: "bg-[#f4f5f7]" },
  avoid: { t: "🔴", n: "피하기", c: "bg-[var(--red2)]" },
  excluded: { t: "⛔", n: "제외", c: "bg-[#f4f5f7]" },
};

type Props = {
  m: Match; proto: Trio | null; extra?: Extra[]; result: DeepResult | null; onResult: (r: DeepResult) => void;
  stage: { settled: number; net: number }; bankroll: number; todayStaked: number; dailyLimit: number;
};

export default function Deep({ m, proto, extra, result, onResult, stage, bankroll, todayStaked, dailyLimit }: Props) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  const run = async (refresh = false) => {
    setBusy(true); setErr(""); setStep(0); setText("요청 보내는 중…");
    try {
      const res = await fetch(`/api/deep${refresh ? "?refresh=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ match: m, proto, extra: extra ?? [] }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error || "정밀 분석을 시작하지 못했어요");
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
          if (e.type === "step") { setStep(s => Math.max(s, e.step)); setText(e.text ?? ""); }
          else if (e.type === "error") throw new Error(e.message);
          else if (e.type === "result") onResult(e.result);
        }
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const soon = new Date(m.kickoff).getTime() - Date.now();
  return (
    <section className="card mb-3">
      <div className="mb-1 flex items-center justify-between"><b>🔬 정밀 분석</b>{result && <span className="text-xs muted">{new Date(result.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}</div>
      {!result && !busy && <p className="text-sm muted">결장자·예상 선발·주심·감독을 검색하고, 두 팀의 시즌 기록·휴식일·이동거리·날씨로 예상 득점을 계산해요. 약 1~2분 · 크레딧 수백 원.</p>}
      {!result && !busy && soon > 90 * 60_000 && <p className="mt-1 text-xs text-[var(--amber)]">💡 선발 명단이 나오는 경기 1시간 전쯤 하면 &ldquo;믿을 만한 정도&rdquo;가 올라가 판정이 나오기 쉬워요.</p>}
      {busy && (
        <div className="mt-2">
          {STEPS.map((s, i) => {
            const n = i + 1, done = step > n, now = step === n;
            return <div key={s} className="flex items-center gap-2.5 border-t border-[var(--line)] py-2 text-[0.95rem] first:border-0">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? "bg-[var(--acc)] text-white" : now ? "animate-spin border-[3px] border-[var(--acc2)] border-t-[var(--acc)]" : "bg-[#f1f2f4] text-[#aaa]"}`}>{done ? "✓" : now ? "" : n}</span>
              <span className={now ? "font-bold" : done ? "" : "muted"}>{now && text ? text : s}</span>
            </div>;
          })}
          {step === 0 && <p className="text-sm muted">{text}</p>}
        </div>
      )}
      {err && <p className="mt-2 text-sm text-[var(--red)]">{err}</p>}
      {!busy && <button className={`btn mt-3 w-full ${result ? "btn-gray" : "btn-fill"}`} onClick={() => run(!!result)}>{result ? "↻ 정밀 분석 다시" : "🔬 정밀 분석하기"}</button>}
      {result && !busy && <Result r={result} m={m} stage={stage} bankroll={bankroll} todayStaked={todayStaked} dailyLimit={dailyLimit} />}
    </section>
  );
}

function Stars({ n }: { n: number }) {
  return <span className="tracking-wider text-[#f5a524]">{"★".repeat(n)}<span className="text-[#d8dbe0]">{"★".repeat(5 - n)}</span></span>;
}

function PickRow({ p }: { p: DeepPick }) {
  const v = V[p.verdict];
  return (
    <div className={`mt-2 rounded-xl px-3 py-2.5 ${v.c}`}>
      <div className="flex items-center justify-between gap-2"><b>{v.t} {p.label} <span className="num">{p.proto.toFixed(2)}</span></b>
        {p.verdict === "good" ? <Stars n={p.rs} /> : <span className="text-xs muted">{v.n}</span>}</div>
      <div className="mt-0.5 text-xs muted">
        확률 {pct(p.p)} × 배당 {p.proto.toFixed(2)} = {(p.p * p.proto).toFixed(2)} → 1만 원당 <b className={p.ev >= 0 ? "text-[var(--acc)]" : "text-[var(--red)]"}>{per10k(p.ev)}</b>
        {p.reasons.map(r => <span key={r} className="block">· {r}</span>)}
      </div>
    </div>
  );
}

function Result({ r, m, stage, bankroll, todayStaked, dailyLimit }: { r: DeepResult; m: Match; stage: Props["stage"]; bankroll: number; todayStaked: number; dailyLimit: number }) {
  const goods = r.picks.filter(p => p.verdict === "good").sort((a, b) => b.ev * b.rs - a.ev * a.rs);
  const order = { good: 0, normal: 1, avoid: 2, excluded: 3 };
  const picks = [...r.picks].sort((a, b) => order[a.verdict] - order[b.verdict] || b.ev - a.ev);
  const [all, setAll] = useState(false);
  const shown = all ? picks : picks.slice(0, 5);
  // 추천 금액: 정밀 분석 검증표 30건 이상 + 실제 손익 플러스일 때만 (그 전엔 관찰 · 0원)
  const best = goods[0];
  const raw = best && bankroll ? Math.min(bankroll * best.kelly * (best.rs / 5), bankroll * CONFIG.matchCap, Math.max(0, bankroll * CONFIG.dailyCap - todayStaked), dailyLimit ? Math.max(0, dailyLimit - todayStaked) : Infinity) : 0;
  const stake = Math.round(raw / 100) * 100;
  const open = stage.settled >= CONFIG.observationUntilSettled && stage.net > 0;
  const absent = (l: DeepResult["absent"]["home"]) => l.length ? l.map(a => `${a.name}${a.position ? `(${a.position}${a.reason ? `, ${a.reason}` : ""})` : ""}`).join(" · ") : "확인된 결장자 없음";
  const roles = (l: DeepResult["absent"]["home"]) => ({ atk: l.filter(a => a.role === "ATTACK").length, def: l.filter(a => a.role === "GK_CB").length });

  return (
    <div className="mt-3">
      {!r.picks.length && <p className="rounded-xl bg-[#f4f5f7] p-3 text-sm">프로토 배당이 없어 판정은 못 했어요. 확률과 예상 득점만 참고하세요.</p>}
      {shown.map((p, i) => <PickRow key={i} p={p} />)}
      {picks.length > 5 && <button className="mt-2 w-full text-sm font-bold text-[var(--acc)]" onClick={() => setAll(!all)}>{all ? "접기" : `나머지 ${picks.length - 5}개 보기`}</button>}
      <p className="mt-2 text-xs muted">★ 믿을 만한 정도: 자료가 충분하고, 선발이 확정되고, 변수(날씨·더비)가 적을수록 별이 많아요. ★3 이상만 판정해요.</p>

      {r.summary && <div className="mt-4"><b>📝 한 줄 정리</b><p className="mt-1 text-[0.95rem]">{r.summary}</p></div>}

      <div className="mt-4"><b>⚽ 예상 득점</b>
        <div className="mt-1 flex items-center text-center"><div className="flex-1"><div className="truncate text-xs muted">{m.home}</div><div className="num text-2xl font-extrabold">{r.lambdas.home.toFixed(2)}</div></div>
          <span className="muted">:</span><div className="flex-1"><div className="truncate text-xs muted">{m.away}</div><div className="num text-2xl font-extrabold">{r.lambdas.away.toFixed(2)}</div></div></div>
        <p className="text-xs muted">가장 많이 나올 점수: {r.topScores.map(s => `${s.score.replace("-", ":")} (${pct(s.p)})`).join(" · ")}</p></div>

      <div className="mt-4"><b>📊 확률 비교</b>
        <table className="mt-1 w-full text-center text-sm num [&_td]:border-t [&_td]:border-[var(--line)] [&_td]:py-1.5 [&_td:first-child]:text-left">
          <thead><tr className="text-xs muted"><th /><th>승</th><th>무</th><th>패</th></tr></thead>
          <tbody>
            <tr><td className="text-xs muted">해외 배당(시장)</td>{r.probs.market.map((x, i) => <td key={i}>{pct(x)}</td>)}</tr>
            <tr><td className="text-xs muted">팀 기록</td>{r.probs.model.map((x, i) => <td key={i}>{pct(x)}</td>)}</tr>
            <tr><td className="font-bold">최종</td>{r.probs.final.map((x, i) => <td key={i} className="font-bold">{pct(x)}</td>)}</tr>
          </tbody>
        </table>
        <p className="mt-1 text-xs muted">자료 수준: <b>{GRADE[r.grade]}</b> · 팀 기록 비중 {Math.round(r.modelWeight * 100)}%{r.grade === "C" ? " (자료가 부족해 판정하지 않아요)" : ""}{r.modelFailed ? " · 팀 기록이 시장과 너무 달라 판정 제외" : ""}</p></div>

      <div className="mt-4"><b>🩹 결장자</b>
        {(["home", "away"] as const).map(s => { const l = r.absent[s], c = roles(l); return (
          <div key={s} className="border-t border-[var(--line)] py-1.5 text-sm first-of-type:border-0">
            <b>{s === "home" ? m.home : m.away}</b>{c.atk > 0 && <span className="tag tag-r ml-1">공격 {c.atk}</span>}{c.def > 0 && <span className="tag tag-n ml-1">골키퍼·중앙수비 {c.def}</span>}
            <span className="block text-xs muted">{absent(l)}</span></div>); })}
      </div>

      <div className="mt-4"><b>📋 경기 상황</b>
        {[
          ["예상 선발", r.lineupConfirmed ? "확정" : "아직 미확정"],
          ["휴식일", `${r.rest.home ?? "?"}일 · ${r.rest.away ?? "?"}일 (최근 2주 ${r.rest.home14}경기 · ${r.rest.away14}경기)`],
          ["감독 재임", `${r.managerMonths.home ?? "?"}개월 · ${r.managerMonths.away ?? "?"}개월`],
          ["주심", r.referee.name ? `${r.referee.name}${r.referee.homeWinRate != null ? ` (홈 승률 ${pct(r.referee.homeWinRate)})` : ""}` : "확인 안 됨"],
          ["날씨", r.weather ? `비 확률 ${pct(r.weather.precip)} · 바람 ${r.weather.wind.toFixed(0)}m/s` : "확인 안 됨"],
          ["원정 이동거리", r.distanceKm != null ? `${r.distanceKm.toLocaleString()}km` : "확인 안 됨"],
        ].map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-t border-[var(--line)] py-1.5 text-sm first-of-type:border-0"><span className="shrink-0 muted">{k}</span><b className="text-right">{v}</b></div>)}
      </div>

      {(r.adjust.home.length > 0 || r.adjust.away.length > 0) && <div className="mt-4"><b>🔧 예상 득점을 고친 이유</b>
        {r.adjust.home.map(a => <p key={a} className="text-sm">{m.home}: {a}</p>)}
        {r.adjust.away.map(a => <p key={a} className="text-sm">{m.away}: {a}</p>)}
        <p className="text-xs muted">한 팀당 최대 ±20%까지만 고쳐요.</p></div>}

      <div className="mt-4"><b>💰 추천 금액</b>
        {open && best ? <p className="mt-1">{best.label} · <b className="num">{stake.toLocaleString()}원</b> <span className="text-xs muted">(운용 자금의 일부, 하루 한도 안에서)</span></p>
          : <>
            <div className="mt-1 flex justify-between text-sm"><b>{best ? "관찰 중 · 0원" : "덜 불리한 선택 없음 · 0원"}</b><span className="muted">정밀 분석 검증 {Math.min(stage.settled, 30)} / 30건</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#f1f2f4]"><i className="block h-full bg-[var(--acc)]" style={{ width: `${Math.min(100, stage.settled / 30 * 100)}%` }} /></div>
            <p className="mt-1 text-xs muted">정밀 분석 판정이 30건 넘게 채점되고 <b>실제 손익이 플러스</b>일 때만 금액이 나와요.{best && bankroll ? ` (계산상 금액: ${stake.toLocaleString()}원)` : ""}{!bankroll ? " 지킴이에서 운용 자금을 정하면 계산상 금액이 보여요." : ""}</p>
          </>}
      </div>

      {!!r.sources.length && <details className="mt-3 text-sm"><summary className="muted">출처 {r.sources.length}건</summary>
        <ol className="mt-1 list-decimal pl-5">{r.sources.map(u => <li key={u} className="truncate"><a className="text-[var(--acc)] underline" href={u} target="_blank" rel="noopener noreferrer">{u.replace(/^https?:\/\/(www\.)?/, "")}</a></li>)}</ol></details>}
    </div>
  );
}
