// 정밀 분석 진행: 경기 찾기(API-Football) → 사실 수집(AI 검색 2건 병렬) → 정리 → 팀 기록 계산(엔진) → 프로토 배당 판정·설명.
// 원본 proto-webapp의 runStandalone.computeFromFacts를 이 앱에 맞게 옮겼다. 바뀐 점:
//  - 해외 배당은 이 앱이 이미 가진 값(배팅사 중앙값)을 쓴다. 개장 배당은 저장하지 않으므로 현재 배당으로 둔다.
//  - 판정은 해외 배당이 아니라 "프로토 배당"으로 한다: 엔진의 같은 평가 함수에 프로토 배당을 넣고,
//    해외 대비 Edge 조건 대신 프로토 평균 손익(+2% 이상)으로 덜 불리를 정한다. 거르기 조건(자료 부족 리그, 모델·시장 괴리,
//    배당 1.40 미만, 믿을 만한 정도 2 이하)은 그대로 쓴다.
//  - 컵대회(챔스·유로파)는 지난 시즌 리그 기록이 의미 없어 시장 역산 prior를 쓴다.
//  - 선발 확정 여부는 API-Football 선발 명단으로도 확인한다.
import { leagueName } from "../leagues";
export { deepSupported } from "./leagues";
import { gameDate, kstTime } from "../time";
import { fairProbs } from "../odds";
import { handi2Win, handiProbs, underProb } from "../model";
import type { Extra, Match, Pick, Trio } from "../types";
import { authedFetch, isConfigured as footballReady } from "./apiFootball";
import { computeLeagueAverages, fetchRecentFixtures, fetchStandings, fetchTeamHomeCity, fetchTeamSeasonStats, restDaysAndGameCount } from "./collector";
import { fetchWeatherAtKickoff, geocodeCity } from "./geo";
import { haversineKm } from "./surrogates";
import { computeAnalysis, type AnalyzeInput, type TeamSeasonSnapshot } from "./analyze";
import { CONFIG, evaluate, scoreMatrix, type Grade, type Selection } from "./engine";
import { classifyPosition } from "./layer2";
import { extractFacts, narrate, searchAbsence, searchContext } from "./claudeDeep";
import type { MatchFactsBundle } from "./facts";

export class DeepError extends Error {}

import { AF } from "./leagues";
import { nameScore } from "../names";
export const deepReady = () => footballReady();

export type DeepPick = {
  label: string; pick: Pick; proto: number;
  q: number; pModel: number; p: number; ev: number; rs: number; kelly: number;
  verdict: "good" | "normal" | "avoid" | "excluded"; reasons: string[];
};
export type DeepResult = {
  at: string;
  fixture: { home: string; away: string; venue: string | null; city: string | null };
  grade: Grade; gradeNote: string | null; modelWeight: number;
  lambdas: { home: number; away: number }; topScores: { score: string; p: number }[];
  probs: { market: Trio; model: Trio; final: Trio };
  modelFailed: boolean; sanityGap: number;
  picks: DeepPick[];
  absent: { home: Absent[]; away: Absent[] };
  lineupConfirmed: boolean;
  referee: { name: string | null; homeWinRate: number | null };
  managerMonths: { home: number | null; away: number | null };
  rest: { home: number | null; away: number | null; home14: number; away14: number };
  distanceKm: number | null;
  weather: { precip: number; wind: number } | null;
  adjust: { home: string[]; away: string[] };
  sources: string[];
  summary: string | null;
};
type Absent = { name: string; position: string | null; reason: string | null; official: boolean; role: "ATTACK" | "GK_CB" | "OTHER" };

type Status = (s: { step: number; text?: string }) => void;

const AI = { searchAbsence, searchContext, extractFacts, narrate };

export async function runDeep(m: Match, proto: Trio | null, extra: Extra[], onStatus: Status, ai = AI): Promise<DeepResult> {
  const lg = AF[m.league];
  if (!lg) throw new DeepError("이 리그는 정밀 분석을 지원하지 않아요.");
  if (!m.odds) throw new DeepError("해외 배당이 없어 정밀 분석을 할 수 없어요.");
  const kickoff = new Date(m.kickoff), season = lg.season(kickoff);

  onStatus({ step: 0, text: "경기 찾는 중…" });
  const fx = await findFixture(m, lg.id, season);

  // 1~2단계: 사실 수집 (AI 웹 검색 2건 병렬)
  let nA = 0, nC = 0;
  const input = { home: m.home, away: m.away, kickoffKst: `${gameDate(m.kickoff)} ${kstTime(m.kickoff)}`, league: leagueName(m.league) };
  onStatus({ step: 1 });
  const [absText, ctxText] = await Promise.all([
    ai.searchAbsence(input, () => onStatus({ step: 1, text: `결장자 검색 중… (${++nA}회)` })),
    ai.searchContext(input, () => onStatus({ step: 2, text: `선발·주심·감독 검색 중… (${++nC}회)` })),
  ]);
  // 3단계: 정리
  onStatus({ step: 3 });
  const facts = await ai.extractFacts(absText, ctxText);

  // 4단계: 팀 기록 계산
  onStatus({ step: 4 });
  const standings = await fetchStandings(lg.id, season);
  const avg = computeLeagueAverages(standings);
  const homeRound = standings.find(s => s.teamId === fx.homeId)?.played ?? 1;
  const awayRound = standings.find(s => s.teamId === fx.awayId)?.played ?? 1;

  const awayCity = await fetchTeamHomeCity(fx.awayId).catch(() => null);
  let distanceKm: number | null = null;
  const venueGeo = fx.city ? await geocodeCity(fx.city).catch(() => null) : null;
  if (venueGeo && awayCity) {
    const g = await geocodeCity(awayCity.city, awayCity.country).catch(() => null);
    if (g) distanceKm = Math.round(haversineKm(venueGeo.coords, g.coords));
  }
  const weather = venueGeo ? await fetchWeatherAtKickoff(venueGeo.coords, m.kickoff).catch(() => null) : null;

  const from = new Date(kickoff.getTime() - 20 * 86400_000).toISOString().slice(0, 10), to = kickoff.toISOString().slice(0, 10);
  const [hr, ar] = await Promise.all([
    fetchRecentFixtures(fx.homeId, season, from, to).catch(() => []),
    fetchRecentFixtures(fx.awayId, season, from, to).catch(() => []),
  ]);
  const hl = restDaysAndGameCount(hr, kickoff), al = restDaysAndGameCount(ar, kickoff);

  // 시장 역산 prior (컵대회 또는 지난 시즌 기록이 없을 때 대신 씀)
  const lm = m.model;
  const mktPrior = lm ? {
    home: { att: lm.lh / avg.muHome, def: lm.la / avg.muAway },
    away: { att: lm.la / avg.muAway, def: lm.lh / avg.muHome },
  } : null;
  const [home, away] = await Promise.all([
    snapshot(fx.homeId, lg, season, homeRound, hl.restDays, hl.gamesInWindow, null, facts.home, mktPrior?.home),
    snapshot(fx.awayId, lg, season, awayRound, al.restDays, al.gamesInWindow, distanceKm, facts.away, mktPrior?.away),
  ]);
  home.name = m.home; away.name = m.away;

  // 선발 명단이 API에 올라왔으면 확정으로 본다
  const lineups = await authedFetch("/fixtures/lineups", { fixture: fx.id }).catch(() => null);
  const lineupConfirmed = facts.lineup.confirmed || (Array.isArray(lineups?.response) && lineups.response.length >= 2);
  const f2: MatchFactsBundle = { ...facts, lineup: { ...facts.lineup, confirmed: lineupConfirmed } };

  const marketOdds: AnalyzeInput["marketOdds"] = [
    { market: "1X2", selection: "HOME", odds: m.odds[0], oddsOpen: m.odds[0] },
    { market: "1X2", selection: "DRAW", odds: m.odds[1], oddsOpen: m.odds[1] },
    { market: "1X2", selection: "AWAY", odds: m.odds[2], oddsOpen: m.odds[2] },
  ];
  if (m.totals?.line === 2.5) marketOdds.push(
    { market: "OU25", line: "2.5", selection: "OVER", odds: m.totals.over, oddsOpen: m.totals.over },
    { market: "OU25", line: "2.5", selection: "UNDER", odds: m.totals.under, oddsOpen: m.totals.under });

  const isDerbyOrFinal = !!(f2.home.manager.isDerbyOrTitleOrRelegationRace || f2.away.manager.isDerbyOrTitleOrRelegationRace || f2.home.manager.isCupFinal || f2.away.manager.isCupFinal);
  const refOut = f2.referee.homeWinRate != null && Math.abs(f2.referee.homeWinRate - 0.5) >= 0.05;
  let result;
  try {
    result = computeAnalysis({
      home, away,
      league: { name: lg.name, muHome: avg.muHome, muAway: avg.muAway, gamesPlayedAvg: (homeRound + awayRound) / 2 },
      facts: f2, weather: weather ? { precipProbability: weather.precipProbability, windSpeedMs: weather.windSpeedMs } : null, hasXg: false,
      tier2: { xg: false, xga: false, ppda: false, refereeStats: f2.referee.name != null, expectedLineup: f2.lineup.home != null },
      marketOdds, refereeHomeWinRateOutlier: refOut, isDerbyOrFinal,
    });
  } catch (e) {
    throw new DeepError(`팀 기록 계산에 필요한 자료가 부족해요. (${(e as Error).message})`);
  }

  // 5단계: 프로토 배당 판정
  onStatus({ step: 5 });
  const w = CONFIG.modelWeight[result.grade];
  const market = fairProbs(m.odds);
  const mx = scoreMatrix(result.lambdas.home, result.lambdas.away);
  const dist = matrixDist(mx);
  const model: Trio = [dist.margin(d => d > 0), dist.margin(d => d === 0), dist.margin(d => d < 0)];
  const final = [0, 1, 2].map(i => w * model[i] + (1 - w) * market[i]) as Trio;

  const cands: { label: string; pick: Pick; proto: number; pModel: number; q: number | null; sel: Selection }[] = [];
  if (proto) ["승", "무", "패"].forEach((l, i) => cands.push({ label: l, pick: { kind: "1x2", pick: i }, proto: proto[i], pModel: model[i], q: market[i], sel: (["HOME", "DRAW", "AWAY"] as const)[i] }));
  for (const x of extra) {
    const hl2 = `핸디 ${x.line > 0 ? "+" : ""}${x.line}`;
    if (x.kind === "handi") {
      const q = lm ? handiProbs(lm, market, x.line) : null;
      const pm: Trio = [dist.margin(d => d + x.line > 0), dist.margin(d => d + x.line === 0), dist.margin(d => d + x.line < 0)];
      x.odds.forEach((o, i) => cands.push({ label: `${hl2} ${["승", "무", "패"][i]}`, pick: { kind: "handi", line: x.line, pick: i }, proto: o, pModel: pm[i], q: q?.[i] ?? null, sel: "AH_HOME" }));
    } else if (x.kind === "handi2") {
      const qw = lm ? handi2Win(lm, market, x.line) : null, pw = dist.margin(d => d + x.line > 0);
      x.odds.forEach((o, i) => cands.push({ label: `${hl2} ${i ? "패" : "승"}`, pick: { kind: "handi2", line: x.line, pick: i }, proto: o, pModel: i ? 1 - pw : pw, q: qw == null ? null : i ? 1 - qw : qw, sel: "AH_HOME" }));
    } else {
      const t = m.totals && m.totals.line === x.line ? m.totals : null;
      const qu = t ? (1 / t.under) / (1 / t.under + 1 / t.over) : lm ? underProb(lm, x.line) : null, pu = dist.total(n => n < x.line);
      x.odds.forEach((o, i) => cands.push({ label: `${i ? "오버" : "언더"} ${x.line}`, pick: { kind: "uo", line: x.line, pick: i }, proto: o, pModel: i ? 1 - pu : pu, q: qu == null ? null : i ? 1 - qu : qu, sel: i ? "OVER" : "UNDER" }));
    }
  }
  const picks: DeepPick[] = cands.filter(c => c.q != null).map(c => {
    const e = evaluate({ market: "1X2", selection: c.sel, odds: c.proto, oddsOpen: c.proto, pModel: c.pModel, q: c.q! }, result.grade, result.flags, result.tier2MissingFlag, undefined, result.modelFailed);
    const ev = e.p * c.proto - 1;
    const reasons: string[] = [];
    if (result.modelFailed) reasons.push("팀 기록 계산이 시장과 너무 달라 믿기 어려움");
    if (result.grade === "C") reasons.push("자료가 부족한 리그라 판정하지 않음");
    if (e.gap >= CONFIG.gapExclude) reasons.push(`팀 기록과 시장 차이가 너무 커서 믿기 어려움 (${(e.gap * 100).toFixed(0)}%p)`);
    if (c.proto < CONFIG.minOdds) reasons.push("배당이 1.40보다 낮음");
    if (e.rs < CONFIG.minRsToBet) reasons.push(`믿을 만한 정도가 낮음 (★${e.rs})`);
    const verdict = reasons.length ? "excluded" : ev >= 0.02 ? "good" : ev <= -0.06 ? "avoid" : "normal";
    return { label: c.label, pick: c.pick, proto: c.proto, q: c.q!, pModel: c.pModel, p: e.p, ev, rs: e.rs, kelly: e.kelly, verdict, reasons };
  });

  const engineView = {
    예상득점: { 홈: +result.lambdas.home.toFixed(2), 원정: +result.lambdas.away.toFixed(2) },
    확률: { 시장: market.map(r2), 팀기록: model.map(r2), 최종: final.map(r2) },
    보정: { 홈: plainAdjust(result.layer2.home), 원정: plainAdjust(result.layer2.away) },
    휴식일: { 홈: fin(hl.restDays), 원정: fin(al.restDays) },
    판정: picks.map(p => ({ 선택: p.label, 프로토배당: p.proto, 확률: r2(p.p), 판정: p.verdict })),
  };
  const summary = await ai.narrate(engineView, { home: f2.home, away: f2.away, lineupConfirmed });

  const absent = (t: MatchFactsBundle["home"]): Absent[] => t.absentPlayers.map(a => ({ name: a.name, position: a.position, reason: a.reason, official: a.officialConfirmed, role: classifyPosition(a.position) }));
  const months = (d: string | null) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / (30 * 86400_000))) : null);
  const sources = [...new Set([...f2.home.absentPlayers, ...f2.away.absentPlayers].map(a => a.sourceUrl).concat([f2.lineup.sourceUrl ?? "", f2.referee.sourceUrl ?? ""]).filter(u => /^https?:\/\//.test(u)))].slice(0, 12);

  return {
    at: new Date().toISOString(),
    fixture: { home: fx.home, away: fx.away, venue: fx.venue, city: fx.city },
    grade: result.grade, gradeNote: result.gradeNote ?? null, modelWeight: w,
    lambdas: result.lambdas, topScores: result.topScores, probs: { market, model, final },
    modelFailed: result.modelFailed, sanityGap: result.sanity.maxGap,
    picks, absent: { home: absent(f2.home), away: absent(f2.away) }, lineupConfirmed,
    referee: { name: f2.referee.name, homeWinRate: f2.referee.homeWinRate },
    managerMonths: { home: months(f2.home.manager.managerAppointedOn), away: months(f2.away.manager.managerAppointedOn) },
    rest: { home: fin(hl.restDays), away: fin(al.restDays), home14: hl.gamesInWindow, away14: al.gamesInWindow },
    distanceKm, weather: weather ? { precip: weather.precipProbability, wind: weather.windSpeedMs } : null,
    adjust: { home: plainAdjust(result.layer2.home), away: plainAdjust(result.layer2.away) },
    sources, summary,
  };
}

const r2 = (x: number) => +x.toFixed(2);
const fin = (x: number) => (Number.isFinite(x) ? x : null);

async function snapshot(teamId: number, lg: { id: number; cup?: boolean }, season: number, round: number, restDays: number, games14: number,
  distanceKm: number | null, facts: MatchFactsBundle["home"], mkt?: { att: number; def: number }): Promise<TeamSeasonSnapshot> {
  const stats = await fetchTeamSeasonStats(teamId, lg.id, season);
  let prior: Partial<TeamSeasonSnapshot> = {};
  if (round < 8) {
    if (lg.cup && mkt) prior = { lastSeasonMeaningless: true, marketImpliedPrior: mkt };
    else {
      try {
        const [prev, standingsPrev] = await Promise.all([fetchTeamSeasonStats(teamId, lg.id, season - 1), fetchStandings(lg.id, season - 1)]);
        const a = computeLeagueAverages(standingsPrev), mu = (a.muHome + a.muAway) / 2;
        prior = { lastSeasonIndices: { att: prev.gfPerGame / mu, def: prev.gaPerGame / mu } };
      } catch {
        prior = mkt ? { lastSeasonMeaningless: true, marketImpliedPrior: mkt } : { promoted: true };
      }
    }
  }
  const months = facts.manager.managerAppointedOn ? Math.floor((Date.now() - new Date(facts.manager.managerAppointedOn).getTime()) / (30 * 86400_000)) : null;
  return {
    name: "", round, gfPerGame: stats.gfPerGame, gaPerGame: stats.gaPerGame,
    managerTenureMonths: months, startingChangesLast5: null, summerKeyDepartures: facts.manager.summerKeyDepartures,
    restDays, gamesInLast14Days: games14, distanceKm, ...prior,
  };
}

/** 점수 행렬에서 점수차·합계 조건 확률 */
function matrixDist(mx: number[][]) {
  return {
    margin: (f: (d: number) => boolean) => mx.reduce((s, row, h) => s + row.reduce((t, p, a) => t + (f(h - a) ? p : 0), 0), 0),
    total: (f: (n: number) => boolean) => mx.reduce((s, row, h) => s + row.reduce((t, p, a) => t + (f(h + a) ? p : 0), 0), 0),
  };
}

/** 엔진 보정 메모를 쉬운 말로 */
function plainAdjust(notes: string[]) {
  return notes.map(n => {
    const f = Number(n.match(/×([\d.]+)/)?.[1] ?? 1), pct = `${f >= 1 ? "+" : "−"}${Math.abs(Math.round((f - 1) * 100))}%`;
    const what = /^공격 핵심/.test(n) ? "핵심 공격수 결장"
      : /^상대 주전 GK·CB (\d)/.test(n) ? `상대 골키퍼·중앙수비 ${n.match(/(\d)명/)?.[1]}명 결장`
      : /^부하 Red/.test(n) ? "휴식 부족 (상대는 충분)"
      : /^상대 부하 Red/.test(n) ? "상대가 휴식 부족"
      : /원정 이동|A매치/.test(n) ? (/A매치/.test(n) ? "A매치 직후" : "먼 원정 이동")
      : /^감독/.test(n) ? "감독 교체 직후"
      : /^강수/.test(n) ? "비·강풍 예보" : n;
    return `${what} → 예상 득점 ${pct}`;
  });
}

/** API-Football에서 같은 경기 찾기: 시작 시각(3시간 이내) + 팀 이름 비슷한 정도 */
async function findFixture(m: Match, leagueId: number, season: number) {
  const k = new Date(m.kickoff);
  const d = (n: number) => new Date(k.getTime() + n * 86400_000).toISOString().slice(0, 10);
  const data = await authedFetch("/fixtures", { league: leagueId, season, from: d(-1), to: d(1) }).catch(e => { throw new DeepError(`팀 기록 서버(API-Football) 문제: ${(e as Error).message}`); });
  type Fx = { id: number; homeId: number; awayId: number; home: string; away: string; venue: string | null; city: string | null; t: number };
  const list: Fx[] = (data.response ?? []).map((r: { fixture: { id: number; date: string; venue?: { name?: string; city?: string } }; teams: { home: { id: number; name: string }; away: { id: number; name: string } } }) => ({
    id: r.fixture.id, homeId: r.teams.home.id, awayId: r.teams.away.id, home: r.teams.home.name, away: r.teams.away.name,
    venue: r.fixture.venue?.name ?? null, city: r.fixture.venue?.city ?? null, t: new Date(r.fixture.date).getTime(),
  }));
  const known = m.afId ? list.find(f => f.id === m.afId) : null;   // 경기 목록에서 이미 맞춰 둔 번호
  if (known) return known;
  const near = list.filter(f => Math.abs(f.t - k.getTime()) <= 3 * 3600_000);
  const scored = near.map(f => ({ f, s: nameScore(m.home, f.home) + nameScore(m.away, f.away) })).sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (!best || (best.s < 0.5 && near.length > 1) || (best.s === 0 && Math.abs(best.f.t - k.getTime()) > 30 * 60_000))
    throw new DeepError("팀 기록 서버(API-Football)에서 이 경기를 찾지 못했어요.");
  return best.f;
}

