// The Odds API (https://the-odds-api.com) — 경기 일정과 해외 배당.
// 일정(events)은 무료 엔드포인트, 배당(odds)은 리그마다 1크레딧이라 그날 경기 있는 리그만 부르고 캐시한다.
// ODDS_API_KEY가 없으면 화면 확인용 목업을 돌려준다 (화면에 "예시" 표시).
import { LEAGUES } from "./leagues";
import { median } from "./odds";
import { gameDate, kstDayRange, kstMonthRange } from "./time";
import type { Match, Trio } from "./types";

const API = "https://api.the-odds-api.com/v4";
const key = () => (process.env.ODDS_API_KEY || "").trim();   // 붙여 넣을 때 섞인 공백·줄바꿈 제거
export const oddsMock = () => !key();

export class OddsApiError extends Error {}

type ApiEvent = { id: string; sport_key: string; commence_time: string; home_team: string; away_team: string };
type ApiOdds = ApiEvent & { bookmakers: { key: string; markets: { key: string; outcomes: { name: string; price: number }[] }[] }[] };

export const quota = { remaining: null as number | null, used: null as number | null };

const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(k: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await load();
  cache.set(k, { at: Date.now(), data });
  return data;
}

// 한꺼번에 많이 부르면 "너무 자주 요청" 429가 나서, 동시에 2개까지만 보낸다
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>(r => waiting.push(r));
  running++;
  try { return await job(); } finally { running--; waiting.shift()?.(); }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function call<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const qs = new URLSearchParams({ apiKey: key(), dateFormat: "iso", ...params });
  for (let attempt = 0; ; attempt++) {
    const res = await slot(() => fetch(`${API}${path}?${qs}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" }));
    const rem = res.headers.get("x-requests-remaining"), used = res.headers.get("x-requests-used");
    if (rem) quota.remaining = Number(rem);
    if (used) quota.used = Number(used);
    if (res.ok) return (await res.json()) as T;
    const body = await res.text();
    // 사용량을 다 쓴 경우는 응답 내용(OUT_OF_USAGE_CREDITS)으로 구분한다. 429만으로는 "너무 자주"일 수 있다.
    if (/OUT_OF_USAGE_CREDITS|usage quota/i.test(body) || quota.remaining === 0)
      throw new OddsApiError("해외 배당 무료 사용량을 이번 달에 다 썼어요. 다음 달에 다시 채워져요.");
    if (res.status === 401) throw new OddsApiError("해외 배당 키(ODDS_API_KEY)가 맞지 않아요. Vercel 설정을 확인해 주세요.");
    if (res.status === 429) {
      if (attempt < 3) { await sleep(1000 * 2 ** attempt); continue; }
      throw new OddsApiError("해외 배당 서버가 바빠요. 잠시 뒤 다시 눌러 주세요.");
    }
    console.warn(`[odds] ${res.status} ${path} ${body.slice(0, 200)}`);
    return null;   // 시즌이 아닌 리그 등은 건너뛴다
  }
}

/** 한 달 동안 날짜별 경기 수 (무료 엔드포인트) */
export async function monthCounts(month: string): Promise<Record<string, number>> {
  if (oddsMock()) return mockMonth(month);
  return cached(`m:${month}`, 6 * 3600_000, async () => {
    const range = kstMonthRange(month);
    // 이미 지난 날짜는 해외 배당 서비스에 없으므로, 시작을 지금(3시간 전)으로 당겨서 묻는다
    const now = new Date(Date.now() - 3 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
    if (range.to < now) return {};
    const from = range.from < now ? now : range.from, to = range.to;
    const lists = await Promise.all(LEAGUES.map(l =>
      call<ApiEvent[]>(`/sports/${l.key}/events`, { commenceTimeFrom: from, commenceTimeTo: to }).catch(e => { if (e instanceof OddsApiError) throw e; return null; })));
    const counts: Record<string, number> = {};
    for (const ev of lists.flat()) if (ev) counts[gameDate(ev.commence_time)] = (counts[gameDate(ev.commence_time)] ?? 0) + 1;
    return counts;
  });
}

/** 시험용: 리그마다 그날 경기를 몇 개 받아 오는지 (무료 엔드포인트만 씀) */
export async function leagueCheck(date: string) {
  const { from, to } = kstDayRange(date);
  return Promise.all(LEAGUES.map(async l => {
    const qs = new URLSearchParams({ apiKey: key(), dateFormat: "iso", commenceTimeFrom: from, commenceTimeTo: to });
    try {
      const res = await slot(() => fetch(`${API}/sports/${l.key}/events?${qs}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" }));
      const rem = res.headers.get("x-requests-remaining"); if (rem) quota.remaining = Number(rem);
      const body = await res.text();
      let count: number | null = null;
      try { const j = JSON.parse(body); if (Array.isArray(j)) count = j.length; } catch {}
      return { league: l.name, status: res.status, count, note: count == null ? body.slice(0, 160) : "" };
    } catch (e) { return { league: l.name, status: 0, count: null, note: (e as Error).message }; }
  }));
}

/** 그날(KST) 경기와 해외 배당 */
export async function dayMatches(date: string): Promise<Match[]> {
  if (oddsMock()) return mockDay(date);
  return cached(`d:${date}`, 3600_000, async () => {
    const { from, to } = kstDayRange(date);
    // 1) 무료 일정으로 그날 경기 있는 리그만 고른다
    const evs = await Promise.all(LEAGUES.map(l =>
      call<ApiEvent[]>(`/sports/${l.key}/events`, { commenceTimeFrom: from, commenceTimeTo: to }).then(r => r ?? [])));
    const all = evs.flat();
    const leagues = [...new Set(all.map(e => e.sport_key))];
    // 2) 그 리그만 배당 (리그당 1크레딧). 이미 시작한 경기는 배당이 없어서 일정만 보여 준다.
    const oddsLists = await Promise.all(leagues.map(k =>
      call<ApiOdds[]>(`/sports/${k}/odds`, { regions: "eu", markets: "h2h", oddsFormat: "decimal", commenceTimeFrom: from, commenceTimeTo: to }).then(r => r ?? [])));
    const byId = new Map(oddsLists.flat().map(o => [o.id, o]));
    return all.map(e => toMatch(e, byId.get(e.id))).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  });
}

type ApiScore = ApiEvent & { completed: boolean; scores: { name: string; score: string }[] | null };

/** 끝난 경기 점수 (최근 3일). 리그당 2크레딧이라 30분 캐시 */
export async function leagueScores(league: string) {
  if (oddsMock()) return [];
  return cached(`s:${league}`, 30 * 60_000, async () =>
    (await call<ApiScore[]>(`/sports/${league}/scores`, { daysFrom: "3" })) ?? []);
}

function toMatch(e: ApiEvent, o?: ApiOdds): Match {
  const rows: Trio[] = [];
  for (const b of o?.bookmakers ?? []) {
    const m = b.markets.find(x => x.key === "h2h");
    const price = (n: string) => m?.outcomes.find(x => x.name === n)?.price;
    const h = price(e.home_team), d = price("Draw"), a = price(e.away_team);
    if (h && d && a) rows.push([h, d, a]);
  }
  const odds = rows.length ? ([0, 1, 2].map(i => +median(rows.map(r => r[i])).toFixed(2)) as Trio) : null;
  return { id: e.id, league: e.sport_key, kickoff: e.commence_time, home: e.home_team, away: e.away_team, odds, books: rows.length };
}

/* ---------- 목업 (키가 없을 때 화면 확인용) ---------- */
const TEAMS: Record<string, string[]> = {
  soccer_epl: ["Arsenal", "Liverpool", "Chelsea", "Manchester United", "Manchester City", "Tottenham Hotspur", "Newcastle United", "Aston Villa", "Brighton", "Brentford"],
  soccer_spain_la_liga: ["Real Madrid", "Barcelona", "Atletico Madrid", "Sevilla", "Real Sociedad", "Villarreal"],
  soccer_korea_kleague1: ["Ulsan HD", "Pohang Steelers", "Jeonbuk Motors", "FC Seoul", "Gwangju FC", "Daejeon Citizen"],
};
const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function mockMonth(month: string) {
  const out: Record<string, number> = {};
  const days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  for (let d = 1; d <= days; d++) { const date = `${month}-${String(d).padStart(2, "0")}`; const n = mockDay(date).length; if (n) out[date] = n; }
  return out;
}
function mockDay(date: string): Match[] {
  const h = hash(date), wd = new Date(`${date}T00:00:00+09:00`).getUTCDay();
  if (![0, 3, 5, 6].includes((wd + 1) % 7) && h % 3) return [];
  const out: Match[] = [];
  Object.entries(TEAMS).forEach(([league, teams], li) => {
    const n = (h >> li) % 3;
    for (let i = 0; i < n; i++) {
      const s = hash(`${date}${league}${i}`), home = teams[s % teams.length], away = teams[(s >> 4) % teams.length];
      if (home === away) continue;
      const ph = 0.28 + ((s >> 8) % 30) / 100, pd = 0.24 + ((s >> 12) % 6) / 100, pa = Math.max(0.14, 1 - ph - pd);
      const odds = [ph, pd, pa].map(p => +(1 / (p * 1.05)).toFixed(2)) as Trio;
      const hour = league === "soccer_korea_kleague1" ? 7 : 14 + (i % 3) * 2;   // UTC
      out.push({ id: `mock-${date}-${league}-${i}`, league, kickoff: `${date}T${String(hour).padStart(2, "0")}:30:00Z`, home, away, odds, books: 12 });
    }
  });
  return out.filter(m => gameDate(m.kickoff) === date).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}
