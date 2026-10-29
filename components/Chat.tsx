"use client";
// 💬 질문: 고른 날짜의 경기·배당을 바탕으로 AI에게 조합·배당 질문
import { useEffect, useRef, useState } from "react";
import { evaluate, type Saved } from "@/lib/evaluate";
import { leagueName } from "@/lib/leagues";
import { useStored } from "@/lib/store";
import { isLateNight, kstTime, prettyDate } from "@/lib/time";
import type { ChatGame, ChatMsg } from "@/lib/chat";
import type { Day, ProtoMap } from "./App";

const EXAMPLES = [
  "덜 불리한 경기로 2폴더 조합 몇 개 계산해 줘",
  "2폴더와 3폴더는 평균 손해가 얼마나 달라?",
  "1번 승 + 3번 무 조합 계산해 줘",
  "배당이 가장 높은 프로토 경기는 뭐야?",
];

type Props = { date: string; day: Day | null; proto: ProtoMap; saved: Record<string, Saved>; goGames: () => void };

export default function Chat({ date, day, proto, saved, goGames }: Props) {
  const [msgs, setMsgs] = useStored<ChatMsg[]>("proto.chat", []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  const games: ChatGame[] = (day?.matches ?? []).map(m => {
    const p = proto[m.id]?.odds ?? null, ev = evaluate(m, p, saved[m.id]);
    return { id: m.id, league: leagueName(m.league), time: `${isLateNight(m.kickoff) ? "새벽 " : ""}${kstTime(m.kickoff)}`, home: m.home, away: m.away,
      over: m.odds, proto: p, probs: ev.probs ? ev.probs.map(x => +x.toFixed(3)) : null };
  });
  const withProto = games.filter(g => g.proto).length;

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    const history: ChatMsg[] = [...msgs, { role: "user", content: q }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setText(""); setBusy(true); setErr("");
    let answer = "";
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, games, messages: history.slice(-12) }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error || "질문을 보내지 못했어요");
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
          if (e.type === "error") throw new Error(e.message);
          if (e.type === "text") { answer += e.text; setMsgs([...history, { role: "assistant", content: answer }]); }
        }
      }
      if (!answer.trim()) throw new Error("답변이 비어 있어요. 다시 물어봐 주세요.");
    } catch (e) {
      setErr((e as Error).message);
      setMsgs(answer.trim() ? [...history, { role: "assistant", content: answer }] : history);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <section className="card text-sm">
        <div className="flex items-center justify-between gap-2">
          <span><b>{prettyDate(date)}</b> 경기 {games.length}개 기준 <span className="muted">(프로토 배당 {withProto}개)</span></span>
          <button className="shrink-0 font-bold text-[var(--acc)]" onClick={goGames}>날짜 바꾸기</button>
        </div>
        {!withProto && <p className="mt-1 text-xs text-[var(--amber)]">이 날은 프로토 배당이 없어 조합 계산을 할 수 없어요.</p>}
      </section>

      {!msgs.length && (
        <section className="card text-sm">
          <b>이렇게 물어보세요</b>
          <div className="mt-2 flex flex-col gap-1.5">
            {EXAMPLES.map(q => <button key={q} onClick={() => ask(q)} className="rounded-xl bg-[#f1f2f4] px-3 py-2 text-left">{q}</button>)}
          </div>
          <p className="mt-2 text-xs muted">경기 번호는 경기 탭 목록 순서(위에서부터 1, 2, 3…)예요. 조합 숫자는 앱이 정확히 계산하고, AI가 쉽게 설명해요.</p>
        </section>
      )}

      {msgs.map((m, i) => (
        <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
          <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[0.95rem] leading-relaxed ${m.role === "user" ? "bg-[var(--acc)] text-white" : "card !rounded-2xl"}`}>
            {m.content ? <Rich s={m.content} /> : <span className="muted">생각하는 중…</span>}
          </div>
        </div>
      ))}
      {err && <p className="text-sm text-[var(--red)]">{err}</p>}
      <div ref={end} />

      <div className="sticky bottom-2 flex gap-2 rounded-2xl bg-white p-2 shadow-md">
        <textarea className="inp min-h-[2.75rem] flex-1 resize-none" rows={1} placeholder="질문을 입력하세요" value={text}
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(text); } }} />
        <button className="btn btn-fill shrink-0 !px-4" disabled={busy || !text.trim()} onClick={() => ask(text)}>{busy ? "…" : "보내기"}</button>
      </div>
      {!!msgs.length && <button className="w-full text-xs muted" disabled={busy} onClick={() => { if (confirm("대화를 지울까요?")) setMsgs([]); }}>대화 지우고 새로 시작</button>}
      <p className="text-xs muted">AI 답변은 참고용이에요. 결과를 예측하거나 보장하지 않아요. 도박 문제 상담 ☎ 1336</p>
    </div>
  );
}

/** **굵게**만 살린 간단 표시 */
function Rich({ s }: { s: string }) {
  return <>{s.split(/(\*\*[^*]+\*\*)/g).map((t, i) => t.startsWith("**") && t.endsWith("**") ? <b key={i}>{t.slice(2, -2)}</b> : t.replace(/^#+\s*/gm, ""))}</>;
}
