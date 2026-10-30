"use client";
// 화면 전체: 탭(경기 · 기록장 · 지킴이) + 경기 분석 화면
import { useCallback, useEffect, useRef, useState } from "react";
import { useStored } from "@/lib/store";
import { gameDate, todayKst } from "@/lib/time";
import { OUTCOMES, type Bet, type Extra, type Match, type Pick, type Track, type Trio } from "@/lib/types";
import { evaluate } from "@/lib/evaluate";
import type { DeepResult } from "@/lib/deep/run";
import type { Saved } from "@/lib/evaluate";
import Calendar from "./Calendar";
import DayList from "./DayList";
import Chat from "./Chat";
import MatchDetail from "./MatchDetail";
import Ledger from "./Ledger";
import Guard from "./Guard";

/** 프로토 배당 (경기 id별). m: 판정에 쓰는 해외 배당·예상 득점, extra: 핸디캡·언더오버 */
export type ProtoMap = Record<string, { odds: Trio; date: string; over: Trio | null; m?: Match; extra?: Extra[] }>;
export type Limits = { daily: number; monthlyLoss: number; bankroll?: number };   // bankroll: 정밀 분석 금액 계산용 운용 자금
export type Day = { matches: Match[]; mock: boolean; quota?: { remaining: number | null } };

export default function App() {
  const [tab, setTab] = useState<"games" | "chat" | "ledger" | "guard">("games");
  const [month, setMonth] = useState(() => todayKst().slice(0, 7));
  const [date, setDate] = useState(todayKst);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [day, setDay] = useState<Day | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Match | null>(null);
  const [proto, setProto] = useStored<ProtoMap>("proto.odds", {});
  const [saved, setSaved] = useStored<Record<string, Saved>>("proto.analysis", {});
  const [bets, setBets, betsReady] = useStored<Bet[]>("proto.bets", []);
  const [track, setTrack, trackReady] = useStored<Record<string, Track>>("proto.track", {});
  const [deep, setDeep] = useStored<Record<string, DeepResult>>("proto.deep", {});
  const [limits, setLimits] = useStored<Limits>("proto.limits", { daily: 30000, monthlyLoss: 50000 });
  const [toast, setToast] = useState("");

  /** 프로토 배당 저장 (해외 배당도 같이 적어 두어 달력이 날짜별 판정을 할 수 있게) */
  const putProto = (m: Match, odds: Trio | null, extra?: Extra[]) => setProto(p => {
    const old = new Date(Date.now() - 21 * 86400_000).toISOString().slice(0, 10);   // 3주 지난 것은 정리
    const n = Object.fromEntries(Object.entries(p).filter(([, v]) => v.date >= old));
    if (odds) n[m.id] = { odds, date: gameDate(m.kickoff), over: m.odds, m, extra: extra ?? p[m.id]?.extra }; else delete n[m.id];
    return n;
  });
  const say = useCallback((t: string) => { setToast(t); setTimeout(() => setToast(""), 2800); }, []);

  useEffect(() => {
    fetch(`/api/month?m=${month}`).then(r => r.json()).then(j => setCounts(j.counts ?? {})).catch(() => {});
  }, [month]);

  useEffect(() => {
    setLoading(true); setErr(""); setDay(null);
    fetch(`/api/day?d=${date}`).then(async r => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setDay(j);
    }).catch(e => setErr(e.message || "경기를 가져오지 못했어요.")).finally(() => setLoading(false));
  }, [date]);

  // 🟢 검증표: 시작 전 경기의 덜 불리한 선택을 마지막 값으로 적어 둔다 (판정이 바뀌면 지우고, 시작하면 고정)
  useEffect(() => {
    if (!trackReady || !day || day.mock) return;
    const now = Date.now();
    setTrack(prev => {
      const n = { ...prev };
      let changed = false;
      for (const m of day.matches) {
        if (new Date(m.kickoff).getTime() <= now) continue;
        const p = proto[m.id], e = evaluate(m, p?.odds, saved[m.id], p?.extra);
        const picks: { label: string; odds: number; ev: number; est: boolean; pick: Pick }[] = [
          ...e.outcomes.flatMap((o, k) => (o.verdict === "good" ? [{ label: OUTCOMES[k], odds: o.proto!, ev: o.ev!, est: false, pick: { kind: "1x2" as const, pick: k } }] : [])),
          ...e.extras.filter(o => o.verdict === "good").map(o => ({ label: o.label, odds: o.proto, ev: o.ev!, est: o.est, pick: o.pick })),
        ];
        const keep = new Set<string>();
        for (const g of picks) {
          const key = `${m.id}:${g.pick.kind}:${g.pick.line ?? ""}:${g.pick.pick}`;
          keep.add(key);
          const t: Track = { key, date: gameDate(m.kickoff), label: `${m.home} vs ${m.away} · ${g.label}`, odds: g.odds, ev: +g.ev.toFixed(4), est: g.est,
            match: { id: m.id, league: m.league, kickoff: m.kickoff, ...g.pick }, result: "pending" };
          if (JSON.stringify(n[key]) !== JSON.stringify(t)) { n[key] = t; changed = true; }
        }
        for (const k of Object.keys(n)) if (k.startsWith(`${m.id}:`) && !keep.has(k) && n[k].result === "pending") { delete n[k]; changed = true; }
      }
      return changed ? n : prev;
    });
  }, [day, proto, saved, trackReady]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** 정밀 분석 결과 저장 + 덜 불리 판정을 검증표에 (경기 시작 전일 때만, 같은 경기의 이전 정밀 판정은 바꿔 씀) */
  const putDeep = (m: Match, r: DeepResult) => {
    setDeep(p => {
      const old = new Date(Date.now() - 21 * 86400_000).toISOString();
      return { ...Object.fromEntries(Object.entries(p).filter(([, v]) => v.at >= old)), [m.id]: r };
    });
    if (new Date(m.kickoff).getTime() <= Date.now()) return;
    setTrack(prev => {
      const n = Object.fromEntries(Object.entries(prev).filter(([k, t]) => !(k.startsWith(`deep:${m.id}:`) && t.result === "pending")));
      for (const g of r.picks.filter(p => p.verdict === "good")) {
        const key = `deep:${m.id}:${g.pick.kind}:${g.pick.line ?? ""}:${g.pick.pick}`;
        n[key] = { key, date: gameDate(m.kickoff), label: `${m.home} vs ${m.away} · ${g.label}`, odds: g.proto, ev: +g.ev.toFixed(4), est: false, src: "deep",
          match: { id: m.id, league: m.league, kickoff: m.kickoff, ...g.pick }, result: "pending" };
      }
      return n;
    });
  };
  const deepDone = Object.values(track).filter(t => t.src === "deep" && t.result !== "pending");
  const deepStage = { settled: deepDone.length, net: deepDone.reduce((a, t) => a + (t.result === "win" ? (t.odds - 1) * 10000 : -10000), 0) };
  const todayStaked = bets.filter(b => b.date === todayKst() && b.result !== "void").reduce((a, b) => a + b.stake, 0);

  // 자동 채점: 시작 2시간이 지난 "결과 전" 기록·검증표를 앱을 열 때와 탭을 바꿀 때 확인 (10분에 한 번까지, 결과는 최근 3일까지만 받을 수 있음)
  const lastGrade = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (!betsReady || !trackReady || now - lastGrade.current < 10 * 60_000) return;
    const due = (k: string) => now - new Date(k).getTime() > 2 * 3600_000 && now - new Date(k).getTime() < 3 * 86400_000;
    const dueBets = bets.filter(b => b.result === "pending" && b.match && due(b.match.kickoff));
    const dueTrack = Object.values(track).filter(t => t.result === "pending" && due(t.match.kickoff));
    if (!dueBets.length && !dueTrack.length) return;
    lastGrade.current = now;
    const req = [...dueBets.map(b => ({ id: `b:${b.id}`, match: b.match })), ...dueTrack.map(t => ({ id: `t:${t.key}`, match: t.match }))];
    fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bets: req }) })
      .then(r => r.json()).then(j => {
        const res = (j.results ?? []) as { id: string; result: "win" | "lose"; score: string }[];
        const map = new Map(res.map(r => [r.id, r]));
        const nb = res.filter(r => r.id.startsWith("b:")).length;
        if (nb) {
          setBets(p => p.map(b => { const r = map.get(`b:${b.id}`); return r && b.result === "pending" ? { ...b, result: r.result, score: r.score, auto: true } : b; }));
          say(`${nb}건 자동 채점했어요 (기록장에서 확인)`);
        }
        if (res.length > nb) setTrack(p => Object.fromEntries(Object.entries(p).map(([k, t]) => { const r = map.get(`t:${k}`); return [k, r && t.result === "pending" ? { ...t, result: r.result, score: r.score } : t]; })));
      }).catch(() => {});
  }, [betsReady, trackReady, tab]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 휴대폰 뒤로가기로 분석 화면 닫기
  useEffect(() => {
    const onPop = () => setDetail(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openDetail = (m: Match) => { history.pushState({ detail: m.id }, ""); setDetail(m); scrollTo(0, 0); };

  if (detail) {
    return <main className="mx-auto max-w-xl px-4 pb-16 pt-4">
      <MatchDetail m={detail} proto={proto[detail.id]?.odds ?? null} extra={proto[detail.id]?.extra} saved={saved[detail.id] ?? null}
        onBack={() => history.back()}
        onProto={odds => putProto(detail, odds)}
        onSaved={s => setSaved(p => ({ ...p, [detail.id]: s }))}
        deep={deep[detail.id] ?? null} onDeep={r => putDeep(detail, r)} deepStage={deepStage} todayStaked={todayStaked}
        bets={bets} limits={limits} onBet={b => { setBets(p => [b, ...p]); say("기록장에 넣었어요"); }} say={say} />
      {toast && <Toast text={toast} />}
    </main>;
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-16 pt-[max(env(safe-area-inset-top),1rem)]">
      <h1 className="mb-3 mt-1 text-2xl font-extrabold">⚽ 프로토 분석</h1>
      <div className="card mb-3 grid grid-cols-4 gap-1 !p-1 !rounded-full">
        {([["games", "📅 경기"], ["chat", "💬 질문"], ["ledger", "🧾 기록장"], ["guard", "🛡 지킴이"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full py-2 text-[0.85rem] font-bold ${tab === k ? "bg-[var(--acc)] text-white" : "muted"}`}>{l}</button>
        ))}
      </div>

      {tab === "games" && <>
        <Calendar month={month} setMonth={setMonth} date={date} setDate={setDate} counts={counts} proto={proto} saved={saved} />
        <DayList date={date} day={day} loading={loading} err={err} proto={proto} saved={saved}
          setProto={putProto}
          onOpen={openDetail} say={say} />
      </>}
      {tab === "chat" && <Chat date={date} day={day} proto={proto} saved={saved} goGames={() => setTab("games")} />}
      {tab === "ledger" && <Ledger bets={bets} setBets={setBets} track={track} clearTrack={() => setTrack({})} limits={limits} say={say} />}
      {tab === "guard" && <Guard bets={bets} limits={limits} setLimits={setLimits} quota={day?.quota?.remaining ?? null} say={say} />}

      <footer className="mt-8 border-t border-[var(--line)] pt-4 text-xs leading-relaxed muted">
        이 앱의 분석은 참고 자료이며 결과를 보장하지 않습니다. 프로토는 구조적으로 사는 쪽이 평균적으로 손해를 보는 게임입니다.
        모든 구매는 본인의 판단과 책임으로, 국내법이 허용하는 범위(베트맨) 안에서만 하세요. 해외·사설 스포츠 베팅 사이트 이용은 국민체육진흥법 위반으로 처벌될 수 있습니다.
        <br />도박 문제 상담 ☎ 1336 (24시간)
      </footer>
      {toast && <Toast text={toast} />}
    </main>
  );
}

export function Toast({ text }: { text: string }) {
  return <div role="status" className="fixed bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] left-1/2 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-[#1d2127] px-4 py-3 text-sm text-white shadow-lg">{text}</div>;
}
