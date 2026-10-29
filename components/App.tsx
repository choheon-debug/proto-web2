"use client";
// 화면 전체: 탭(경기 · 기록장 · 지킴이) + 경기 분석 화면
import { useCallback, useEffect, useRef, useState } from "react";
import { useStored } from "@/lib/store";
import { gameDate, todayKst } from "@/lib/time";
import type { Bet, Match, Trio } from "@/lib/types";
import type { Saved } from "@/lib/evaluate";
import Calendar from "./Calendar";
import DayList from "./DayList";
import MatchDetail from "./MatchDetail";
import Ledger from "./Ledger";
import Guard from "./Guard";

export type ProtoMap = Record<string, { odds: Trio; date: string; over: Trio | null }>;
export type Limits = { daily: number; monthlyLoss: number };
export type Day = { matches: Match[]; mock: boolean; quota?: { remaining: number | null } };

export default function App() {
  const [tab, setTab] = useState<"games" | "ledger" | "guard">("games");
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
  const [limits, setLimits] = useStored<Limits>("proto.limits", { daily: 30000, monthlyLoss: 50000 });
  const [toast, setToast] = useState("");

  /** 프로토 배당 저장 (해외 배당도 같이 적어 두어 달력이 날짜별 판정을 할 수 있게) */
  const putProto = (m: Match, odds: Trio | null) => setProto(p => {
    const n = { ...p };
    if (odds) n[m.id] = { odds, date: gameDate(m.kickoff), over: m.odds }; else delete n[m.id];
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

  // 자동 채점: 시작 2시간이 지난 "결과 전" 기록을 앱을 열 때와 기록장을 열 때 확인 (10분에 한 번까지, 결과는 최근 3일까지만 받을 수 있음)
  const lastGrade = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (!betsReady || now - lastGrade.current < 10 * 60_000) return;
    const due = bets.filter(b => b.result === "pending" && b.match && now - new Date(b.match.kickoff).getTime() > 2 * 3600_000
      && now - new Date(b.match.kickoff).getTime() < 3 * 86400_000);
    if (!due.length) return;
    lastGrade.current = now;
    fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bets: due.map(b => ({ id: b.id, match: b.match })) }) })
      .then(r => r.json()).then(j => {
        const res = (j.results ?? []) as { id: string; result: "win" | "lose"; score: string }[];
        if (!res.length) return;
        const map = new Map(res.map(r => [r.id, r]));
        setBets(p => p.map(b => { const r = map.get(b.id); return r && b.result === "pending" ? { ...b, result: r.result, score: r.score, auto: true } : b; }));
        say(`${res.length}건 자동 채점했어요 (기록장에서 확인)`);
      }).catch(() => {});
  }, [betsReady, tab]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 휴대폰 뒤로가기로 분석 화면 닫기
  useEffect(() => {
    const onPop = () => setDetail(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openDetail = (m: Match) => { history.pushState({ detail: m.id }, ""); setDetail(m); scrollTo(0, 0); };

  if (detail) {
    return <main className="mx-auto max-w-xl px-4 pb-16 pt-4">
      <MatchDetail m={detail} proto={proto[detail.id]?.odds ?? null} saved={saved[detail.id] ?? null}
        onBack={() => history.back()}
        onProto={odds => putProto(detail, odds)}
        onSaved={s => setSaved(p => ({ ...p, [detail.id]: s }))}
        bets={bets} limits={limits} onBet={b => { setBets(p => [b, ...p]); say("기록장에 넣었어요"); }} say={say} />
      {toast && <Toast text={toast} />}
    </main>;
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-16 pt-[max(env(safe-area-inset-top),1rem)]">
      <h1 className="mb-3 mt-1 text-2xl font-extrabold">⚽ 프로토 분석</h1>
      <div className="card mb-3 grid grid-cols-3 gap-1 !p-1 !rounded-full">
        {([["games", "📅 경기"], ["ledger", "🧾 기록장"], ["guard", "🛡 지킴이"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full py-2 text-sm font-bold ${tab === k ? "bg-[var(--acc)] text-white" : "muted"}`}>{l}</button>
        ))}
      </div>

      {tab === "games" && <>
        <Calendar month={month} setMonth={setMonth} date={date} setDate={setDate} counts={counts} proto={proto} saved={saved} />
        <DayList date={date} day={day} loading={loading} err={err} proto={proto} saved={saved}
          setProto={putProto}
          onOpen={openDetail} say={say} />
      </>}
      {tab === "ledger" && <Ledger bets={bets} setBets={setBets} limits={limits} say={say} />}
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
