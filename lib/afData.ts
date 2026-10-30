// API-Football(Pro, 하루 7,500회)로 일정·해외 배당·경기 결과를 가져온다.
// The Odds API 무료 한도(월 500크레딧)가 금방 바닥나서, 배당과 결과는 이쪽을 먼저 쓴다.
// 배당: /odds (여러 배팅사) → 승무패·언더오버 중앙값. 결과: /fixtures의 정규시간(90분) 점수 — 프로토 기준과 같다.
import { authedFetch, isConfigured } from "./deep/apiFootball";
import { AF } from "./deep/leagues";
import { modelOf } from "./model";
import { median } from "./odds";
import { nameScore } from "./names";
import type { Match, Totals, Trio } from "./types";

export const afReady = () => isConfigured();

export type AfFixture = { id: number; league: string; t: number; kickoff: string; home: string; away: string; status: string; ft: [number | null, number | null] };

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// 리그마다 실제로 경기가 나온 시즌 번호 (J리그처럼 시즌 방식이 바뀐 리그는 계산값과 다를 수 있다)
const seasonFound = new Map<string, number>();
/** 시즌 번호: 계산값 → 경기가 없으면 앞뒤 해도 시험해 맞는 값을 기억 */
export function afSeason(league: string, ms: number) {
  const key = `${league}:${AF[league].season(new Date(ms))}`;
  return seasonFound.get(key) ?? AF[league].season(new Date(ms));
}

/** 리그의 기간 내 경기 (UTC 날짜 from~to) */
export async function afFixtures(league: string, fromMs: number, toMs: number): Promise<AfFixture[]> {
  const lg = AF[league];
  if (!lg) return [];
  const base = lg.season(new Date(fromMs)), key = `${league}:${base}`;
  const tries = seasonFound.has(key) ? [seasonFound.get(key)!] : [base, base + 1, base - 1];
  let data: Awaited<ReturnType<typeof authedFetch>> | null = null;
  for (const season of tries) {
    data = await authedFetch("/fixtures", { league: lg.id, season, from: ymd(fromMs), to: ymd(toMs) });
    if (data.response?.length) { seasonFound.set(key, season); break; }
  }
  if (!data) return [];
  type R = { fixture: { id: number; date: string; status: { short: string } }; teams: { home: { name: string }; away: { name: string } }; goals: { home: number | null; away: number | null }; score?: { fulltime?: { home: number | null; away: number | null } } };
  return ((data.response ?? []) as R[]).map(r => ({
    id: r.fixture.id, league, t: new Date(r.fixture.date).getTime(), kickoff: new Date(r.fixture.date).toISOString(),
    home: r.teams.home.name, away: r.teams.away.name, status: r.fixture.status.short,
    ft: [r.score?.fulltime?.home ?? r.goals.home, r.score?.fulltime?.away ?? r.goals.away] as [number | null, number | null],
  })).filter(f => f.t >= fromMs && f.t <= toMs);
}

/** 리그·날짜(UTC)별 배당 → 경기 id → 승무패·언더오버 (여러 배팅사 중앙값) */
async function afOdds(league: string, dates: string[]) {
  const lg = AF[league], out = new Map<number, { odds: Trio | null; books: number; totals: Totals | null }>();
  if (!lg) return out;
  type V = { value: string; odd: string };
  type R = { fixture: { id: number }; bookmakers: { bets: { name: string; values: V[] }[] }[] };
  for (const date of dates) {
    const season = afSeason(league, new Date(`${date}T12:00:00Z`).getTime());
    for (let page = 1; page <= 5; page++) {
      const data = await authedFetch("/odds", { league: lg.id, season, date, page }).catch(() => null);
      if (!data) break;
      for (const r of (data.response ?? []) as R[]) {
        const rows: Trio[] = [], tot = new Map<number, { u: number[]; o: number[] }>();
        for (const b of r.bookmakers ?? []) {
          const mw = b.bets.find(x => x.name === "Match Winner");
          const v = (n: string) => Number(mw?.values.find(x => x.value === n)?.odd);
          const h = v("Home"), d = v("Draw"), a = v("Away");
          if (h > 1 && d > 1 && a > 1) rows.push([h, d, a]);
          for (const x of b.bets.find(y => y.name === "Goals Over/Under")?.values ?? []) {
            const mm = x.value.match(/^(Over|Under) ([\d.]+)$/);
            if (!mm) continue;
            const line = Number(mm[2]), e = tot.get(line) ?? { u: [], o: [] };
            (mm[1] === "Over" ? e.o : e.u).push(Number(x.odd));
            tot.set(line, e);
          }
        }
        // 언더오버는 2.5 기준을 우선, 없으면 배팅사가 가장 많은 기준점
        const lines = [...tot].filter(([, e]) => e.u.length && e.o.length).sort((a, b) => (a[0] === 2.5 ? -1 : b[0] === 2.5 ? 1 : b[1].u.length - a[1].u.length));
        const totals = lines[0] ? { line: lines[0][0], under: +median(lines[0][1].u).toFixed(2), over: +median(lines[0][1].o).toFixed(2) } : null;
        out.set(r.fixture.id, { odds: rows.length ? ([0, 1, 2].map(i => +median(rows.map(x => x[i])).toFixed(2)) as Trio) : null, books: rows.length, totals });
      }
      const p = (data as unknown as { paging?: { current: number; total: number } }).paging;
      if (!p || p.current >= p.total) break;
    }
  }
  return out;
}

/** 같은 경기 찾기: 시작 시각 20분 이내 + 팀 이름 */
export function pairFixture<T extends { kickoff: string; home: string; away: string }>(m: T, list: AfFixture[]) {
  const t = new Date(m.kickoff).getTime();
  const near = list.filter(f => Math.abs(f.t - t) <= 20 * 60_000);
  const best = near.map(f => ({ f, s: nameScore(m.home, f.home) + nameScore(m.away, f.away) })).sort((a, b) => b.s - a.s)[0];
  if (!best) return null;
  return best.s >= 0.5 || near.length === 1 ? best.f : null;
}

/** 경기들에 API-Football 해외 배당을 채운다 (리그별로 경기 목록 1번 + 날짜별 배당) */
export async function fillOddsFromAf(matches: Match[], fromMs: number, toMs: number): Promise<Match[]> {
  const leagues = [...new Set(matches.map(m => m.league))].filter(l => AF[l]);
  const dates = [...new Set([ymd(fromMs), ymd(toMs)])];
  const per = await Promise.all(leagues.map(async l => {
    const fx = await afFixtures(l, fromMs, toMs).catch(() => []);
    const od = fx.length ? await afOdds(l, dates) : new Map();
    return { l, fx, od };
  }));
  return matches.map(m => {
    const g = per.find(p => p.l === m.league);
    const f = g && pairFixture(m, g.fx);
    const o = f && g!.od.get(f.id);
    if (!f) return m;
    if (!o?.odds) return { ...m, afId: f.id };
    return { ...m, afId: f.id, odds: o.odds, books: o.books, totals: o.totals, model: modelOf(o.odds, o.totals) };
  });
}

/** The Odds API를 못 쓸 때: API-Football 일정만으로 경기 목록 (id는 "af-번호") */
export async function afDayMatches(fromMs: number, toMs: number): Promise<Match[]> {
  const lists = await Promise.all(Object.keys(AF).map(l => afFixtures(l, fromMs, toMs).catch(() => [])));
  const ms: Match[] = lists.flat().map(f => ({ id: `af-${f.id}`, afId: f.id, league: f.league, kickoff: f.kickoff, home: f.home, away: f.away, odds: null, books: 0, totals: null, model: null }));
  return fillOddsFromAf(ms, fromMs, toMs);
}

/** 끝난 경기 결과 (정규시간 점수). 이름은 경기 id가 없을 때 찾기용 */
export async function afResult(q: { afId?: number; league: string; kickoff: string; home?: string; away?: string }): Promise<[number, number] | null> {
  const t = new Date(q.kickoff).getTime();
  const list = await afFixtures(q.league, t - 86400_000, t + 86400_000).catch(() => []);
  const f = q.afId ? list.find(x => x.id === q.afId) : q.home && q.away ? pairFixture({ kickoff: q.kickoff, home: q.home, away: q.away }, list) : null;
  if (!f || !["FT", "AET", "PEN"].includes(f.status) || f.ft[0] == null || f.ft[1] == null) return null;
  return [f.ft[0], f.ft[1]];
}
