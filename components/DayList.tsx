"use client";
// 그날 경기 목록: 해외 배당 · 프로토 배당 나란히, 프로토 배당 직접 입력 / 배당표 사진으로 한 번에
import { useEffect, useRef, useState } from "react";
import { evaluate, TAG_UI, type Saved } from "@/lib/evaluate";
import { leagueName } from "@/lib/leagues";
import { OUTCOMES, type Match, type Trio } from "@/lib/types";
import { isLateNight, kstTime, prettyDate } from "@/lib/time";
import type { Day, ProtoMap } from "./App";

type Props = {
  date: string; day: Day | null; loading: boolean; err: string; proto: ProtoMap; saved: Record<string, Saved>;
  setProto: (m: Match, odds: Trio | null) => void; onOpen: (m: Match) => void; say: (t: string) => void;
};

export default function DayList({ date, day, loading, err, proto, saved, setProto, onOpen, say }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [bm, setBm] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: "" });
  const tried = useRef(new Set<string>());

  // 베트맨 프로토 배당 자동 읽기: 날짜마다 처음 열 때 한 번, 그 뒤에는 버튼으로
  const loadBetman = async () => {
    if (!day?.matches.length || day.mock) return;
    setBm({ busy: true, msg: "" });
    try {
      const res = await fetch("/api/betman", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, matches: day.matches }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      const rows = j.rows as { id: string; odds: Trio }[];
      rows.forEach(r => { const m = day.matches.find(x => x.id === r.id); if (m) setProto(m, r.odds); });
      setBm({ busy: false, msg: rows.length ? `베트맨에서 ${rows.length}경기 프로토 배당을 넣었어요` : j.betman ? "베트맨 경기와 맞는 경기를 찾지 못했어요" : "베트맨에 아직 이 날 축구 경기가 없어요 (발매 전)" });
    } catch (e) { setBm({ busy: false, msg: (e as Error).message || "베트맨 배당을 가져오지 못했어요" }); }
  };
  useEffect(() => {
    if (!day?.matches.length || day.mock || tried.current.has(date)) return;
    tried.current.add(date);
    loadBetman();
  }, [day, date]);   // eslint-disable-line react-hooks/exhaustive-deps

  const readPhoto = async (f: File) => {
    if (!day?.matches.length) return;
    setReading(true);
    try {
      const image = await shrink(f);
      const res = await fetch("/api/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, matches: day.matches }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      const rows = j.rows as { id: string; odds: Trio }[];
      rows.forEach(r => { const m = day.matches.find(x => x.id === r.id); if (m) setProto(m, r.odds); });
      say(rows.length ? `${rows.length}경기의 프로토 배당을 넣었어요. 맞는지 확인해 주세요` : "사진에서 이 날 경기를 찾지 못했어요");
    } catch (e) { say((e as Error).message || "사진을 읽지 못했어요"); }
    finally { setReading(false); }
  };

  return (
    <section>
      <div className="mx-1 mb-2 mt-4 flex items-baseline justify-between">
        <h2 className="text-lg font-extrabold">{prettyDate(date)} 경기</h2>
        <span className="text-xs muted">{day ? `${day.matches.length}경기${day.mock ? " · 예시" : ""}` : ""}</span>
      </div>
      {day?.mock && <p className="card mb-3 !bg-[var(--amber2)] text-sm text-[var(--amber)]">🧪 예시 경기·배당이에요. 해외 배당 키(ODDS_API_KEY)를 넣으면 실제 경기가 나와요.</p>}
      {loading && <p className="card text-center muted">경기를 불러오는 중…</p>}
      {err && <p className="card text-sm text-[var(--red)]">{err}</p>}
      {day && !day.matches.length && <p className="card text-center muted">이 날은 경기가 없어요.</p>}
      {!!day?.matches.length && !day.mock && (
        <div className="mb-2 flex items-center justify-between gap-2 text-sm">
          <span className="muted">{bm.busy ? "베트맨 프로토 배당 읽는 중…" : bm.msg}</span>
          <button className="shrink-0 font-bold text-[var(--acc)]" disabled={bm.busy} onClick={loadBetman}>↻ 베트맨</button>
        </div>
      )}
      {!!day?.matches.length && (
        <button className="btn btn-out mb-3 w-full text-sm" disabled={reading} onClick={() => file.current?.click()}>
          {reading ? "사진 읽는 중…" : "📷 프로토 배당표 사진으로 한 번에 넣기"}
        </button>
      )}
      <input ref={file} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readPhoto(f); }} />
      {day?.matches.map((m, i) => <MatchCard key={m.id} n={i + 1} m={m} proto={proto[m.id]?.odds ?? null} saved={saved[m.id]} setProto={o => setProto(m, o)} onOpen={() => onOpen(m)} />)}
    </section>
  );
}

function MatchCard({ n, m, proto, saved, setProto, onOpen }: { n: number; m: Match; proto: Trio | null; saved?: Saved; setProto: (o: Trio | null) => void; onOpen: () => void }) {
  const [edit, setEdit] = useState(false);
  const ev = evaluate(m, proto, saved);
  const tag = TAG_UI[ev.tag];
  const higher = ev.outcomes.map((o, i) => (o.higher ? OUTCOMES[i] : null)).filter(Boolean);
  const foot = !proto ? "프로토 배당을 넣으면 비교해 드려요"
    : !m.odds ? "해외 배당이 없어 비교할 수 없어요"
    : higher.length ? `${higher.join("·")}이(가) 해외보다 높아요` : "모든 배당이 해외보다 낮아요";

  return (
    <article className="card mb-2.5">
      <div className="flex items-center justify-between text-xs font-semibold muted">
        <span>{n}. {leagueName(m.league)} · {isLateNight(m.kickoff) ? "새벽 " : ""}{kstTime(m.kickoff)}</span><span className={`tag ${tag.cls}`}>{tag.label}</span>
      </div>
      <button onClick={onOpen} className="mb-2 mt-1 block w-full text-left text-[1.02rem] font-extrabold">{m.home} vs {m.away}</button>
      <div className="grid grid-cols-[3.4em_1fr_1fr_1fr] items-center gap-x-1.5 gap-y-1 text-sm num">
        <span />{OUTCOMES.map(o => <span key={o} className="text-center text-xs font-bold muted">{o}</span>)}
        <span className="text-xs font-bold muted">해외</span>
        {[0, 1, 2].map(i => <span key={i} className="rounded-lg bg-[#f4f5f7] py-1 text-center font-bold">{m.odds?.[i]?.toFixed(2) ?? "–"}</span>)}
        <span className="text-xs font-bold muted">프로토</span>
        {edit ? <ProtoInputs init={proto} onDone={o => { if (o !== undefined) setProto(o); setEdit(false); }} />
          : [0, 1, 2].map(i => {
              const o = ev.outcomes[i];
              return proto
                ? <button key={i} onClick={() => setEdit(true)} className={`rounded-lg py-1 text-center font-bold ${o.higher ? "bg-[var(--acc2)] text-[var(--acc)]" : o.higher === false ? "bg-[var(--red2)] text-[var(--red)]" : "bg-[#f4f5f7]"}`}>{proto[i].toFixed(2)}</button>
                : <button key={i} onClick={() => setEdit(true)} className="rounded-lg border-[1.5px] border-dashed border-[#c9ccd2] py-1 text-center text-xs muted">입력</button>;
            })}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs muted">
        <span>{foot}</span><button onClick={onOpen} className="font-bold text-[var(--acc)]">분석 ›</button>
      </div>
    </article>
  );
}

/** 프로토 배당 세 칸 입력 (승·무·패). 저장·지우기·취소 */
export function ProtoInputs({ init, onDone }: { init: Trio | null; onDone: (o: Trio | null | undefined) => void }) {
  const [v, setV] = useState(init ? init.map(String) : ["", "", ""]);
  const nums = v.map(x => parseFloat(x.replace(",", ".")));
  const ok = nums.every(n => n >= 1.01 && n < 100);
  return (
    <div className="col-span-3 flex flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        {v.map((x, i) => <input key={i} inputMode="decimal" className="inp text-center num" placeholder={OUTCOMES[i]} value={x} autoFocus={i === 0}
          onChange={e => setV(p => p.map((y, j) => (j === i ? e.target.value : y)))} />)}
      </div>
      <div className="flex gap-1.5 text-sm">
        <button className="btn btn-fill flex-1 !py-1.5" disabled={!ok} onClick={() => onDone(nums as Trio)}>저장</button>
        {init && <button className="btn btn-gray !py-1.5" onClick={() => onDone(null)}>지우기</button>}
        <button className="btn btn-gray !py-1.5" onClick={() => onDone(undefined)}>취소</button>
      </div>
    </div>
  );
}

/** 사진을 1600px 이하 JPEG로 줄인다 */
function shrink(f: File): Promise<{ type: string; data: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve({ type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.88).split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("사진을 열 수 없어요")); };
    img.src = url;
  });
}
