"use client";
// 지킴이: 한도 설정, 이번 달 상태, 상담 안내, 상태 확인(해외 배당 남은 횟수, 베트맨 자동 읽기 시험)
import { useState } from "react";
import { monthStats } from "@/lib/guard";
import { won } from "@/lib/store";
import { todayKst } from "@/lib/time";
import type { Bet } from "@/lib/types";
import type { Limits } from "./App";

type Props = { bets: Bet[]; limits: Limits; setLimits: (l: Limits) => void; quota: number | null; say: (t: string) => void };

export default function Guard({ bets, limits, setLimits, quota, say }: Props) {
  const [daily, setDaily] = useState(String(limits.daily || ""));
  const [monthly, setMonthly] = useState(String(limits.monthlyLoss || ""));
  const [test, setTest] = useState<string>("");
  const s = monthStats(bets, todayKst().slice(0, 7));
  const today = bets.filter(b => b.date === todayKst() && b.result !== "void").reduce((a, b) => a + b.stake, 0);

  const runOdds = async () => {
    const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));   // 이번 토요일
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setTest("시험 중…");
    try {
      const j = await (await fetch(`/api/odds-test?d=${date}`)).json();
      if (j.error) { setTest(j.error); return; }
      setTest(`${date} (${j.range.from} ~ ${j.range.to})\n` + j.leagues.map((l: { league: string; status: number; count: number | null; note: string }) =>
        `${l.league}: 응답 ${l.status} · ${l.count ?? "?"}경기${l.note ? ` · ${l.note}` : ""}`).join("\n"));
    } catch { setTest("시험하지 못했어요"); }
  };
  const runTest = async () => {
    setTest("시험 중…");
    try {
      const j = await (await fetch("/api/betman-test")).json();
      setTest(j.results.map((r: { url: string; status?: number; bytes?: number; title?: string; error?: string; hasOdds?: boolean }) =>
        `${r.url}\n→ ${r.error ? `실패: ${r.error}` : `응답 ${r.status} · ${r.bytes}자 · 제목 "${r.title ?? "-"}" · 배당 글자 ${r.hasOdds ? "있음" : "없음"}`}`).join("\n\n"));
    } catch { setTest("시험하지 못했어요"); }
  };

  return (
    <div className="space-y-3">
      <section className="card">
        <b>🛡 나의 한도</b>
        <p className="mb-2 text-xs muted">정해 둔 한도를 넘으면 기록장에 더 넣을 수 없어요. 0으로 두면 한도 없음.</p>
        <label className="mb-2 block text-sm">하루 최대 베팅 금액 (원)
          <input className="inp mt-1 num" inputMode="numeric" value={daily} onChange={e => setDaily(e.target.value)} /></label>
        <label className="mb-2 block text-sm">한 달 최대 손실 금액 (원)
          <input className="inp mt-1 num" inputMode="numeric" value={monthly} onChange={e => setMonthly(e.target.value)} /></label>
        <button className="btn btn-fill w-full" onClick={() => { setLimits({ daily: parseInt(daily.replace(/\D/g, ""), 10) || 0, monthlyLoss: parseInt(monthly.replace(/\D/g, ""), 10) || 0 }); say("한도를 저장했어요"); }}>저장</button>
      </section>

      <section className="card text-sm">
        <b>지금 상태</b>
        <div className="mt-1 flex justify-between"><span className="muted">오늘 건 돈</span><b className="num">{won(today)}{limits.daily ? ` / ${won(limits.daily)}` : ""}원</b></div>
        <div className="flex justify-between"><span className="muted">이번 달 손실</span><b className="num">{won(s.loss)}{limits.monthlyLoss ? ` / ${won(limits.monthlyLoss)}` : ""}원</b></div>
        <p className="mt-2 text-xs muted">잃은 뒤 금액을 키우는 &ldquo;복구 베팅&rdquo;을 하면 기록할 때 경고해 드려요.</p>
      </section>

      <section className="card text-sm">
        <b>📞 도움이 필요할 때</b>
        <p className="mt-1">한국도박문제예방치유원 <a className="font-bold text-[var(--acc)]" href="tel:1336">☎ 1336</a> (24시간, 무료·익명)</p>
        <p className="mt-1 text-xs muted">돈을 빌려서 걸거나, 잃은 돈을 되찾으려 계속 걸게 되면 잠시 멈추고 상담을 받아 보세요.</p>
      </section>

      <section className="card text-sm">
        <b>⚙️ 상태 확인</b>
        <div className="mt-1 flex justify-between"><span className="muted">해외 배당 이번 달 남은 횟수</span><b className="num">{quota ?? "–"}</b></div>
        <button className="btn btn-gray mt-2 w-full text-sm" onClick={runOdds}>해외 배당 리그별 시험 (이번 토요일)</button>
        <button className="btn btn-gray mt-2 w-full text-sm" onClick={runTest}>베트맨 자동 읽기 시험</button>
        {test && <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-[#f4f5f7] p-2 text-xs">{test}</pre>}
      </section>
    </div>
  );
}
