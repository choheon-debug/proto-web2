// src/pipeline/collector.ts — API-Football에서 팀 통계·일정을 모아 engine.ts가 쓸 수 있는 형태로 정리한다.
// 2026-10-24 Pro 플랜으로 라이브 검증 완료(npm run check:collector-live, Arsenal 실제 데이터로 확인).
import { authedFetch } from './apiFootball';

export interface TeamSeasonStats {
  gamesPlayed: number; // engine.TeamInput.n
  gfPerGame: number;
  gaPerGame: number;
  form: string | null; // 최근 폼 문자열(예: "WWDLW")
}

export function parseTeamStatistics(raw: any): TeamSeasonStats {
  const played = raw.fixtures?.played?.total;
  const gf = raw.goals?.for?.average?.total;
  const ga = raw.goals?.against?.average?.total;
  if (played == null || gf == null || ga == null) {
    throw new Error('팀 통계 응답에 필수 필드(played/goals.for/goals.against)가 없음');
  }
  return { gamesPlayed: Number(played), gfPerGame: parseFloat(gf), gaPerGame: parseFloat(ga), form: raw.form ?? null };
}

export async function fetchTeamSeasonStats(teamId: number, leagueId: number, season: number): Promise<TeamSeasonStats> {
  const data = await authedFetch('/teams/statistics', { team: teamId, league: leagueId, season });
  if (!data.response || Object.keys(data.response).length === 0) {
    throw new Error(`팀(${teamId}) 시즌(${season}) 통계를 찾지 못함`);
  }
  return parseTeamStatistics(data.response);
}

export interface StandingRow {
  teamId: number;
  rank: number;
  played: number;
  points: number;
  homePlayed: number; homeGoalsFor: number;
  awayPlayed: number; awayGoalsFor: number;
}

export function parseStandings(raw: any): StandingRow[] {
  // response[0].league.standings는 리그 안에 여러 그룹(조별리그 등)이 있으면 2차원 배열이다.
  const groups: any[][] = raw[0]?.league?.standings ?? [];
  return groups.flat().map(row => ({
    teamId: row.team.id, rank: row.rank, played: row.all.played, points: row.points,
    homePlayed: row.home.played, homeGoalsFor: row.home.goals.for,
    awayPlayed: row.away.played, awayGoalsFor: row.away.goals.for,
  }));
}

export async function fetchStandings(leagueId: number, season: number): Promise<StandingRow[]> {
  const data = await authedFetch('/standings', { league: leagueId, season });
  return parseStandings(data.response);
}

// 4단계 1항: 리그 평균 홈/원정 득점 μH·μA. standings의 home/away 득점 합계·경기수 합계로 직접 구한다
// (API-Football에 "리그 평균" 전용 엔드포인트가 없어 standings에서 코드로 계산 — LLM에 맡기지 않는다).
export function computeLeagueAverages(standings: StandingRow[]): { muHome: number; muAway: number } {
  const homePlayed = standings.reduce((s, r) => s + r.homePlayed, 0);
  const homeGoals = standings.reduce((s, r) => s + r.homeGoalsFor, 0);
  const awayPlayed = standings.reduce((s, r) => s + r.awayPlayed, 0);
  const awayGoals = standings.reduce((s, r) => s + r.awayGoalsFor, 0);
  if (homePlayed === 0 || awayPlayed === 0) throw new Error('standings에 경기 기록이 없어 리그 평균을 구할 수 없음');
  return { muHome: homeGoals / homePlayed, muAway: awayGoals / awayPlayed };
}

export async function fetchLeagueAverages(leagueId: number, season: number): Promise<{ muHome: number; muAway: number }> {
  return computeLeagueAverages(await fetchStandings(leagueId, season));
}

// 팀 연고 도시(원정 이동 거리 계산용). API-Football /venues에는 좌표가 없어 geo.ts의 지오코딩과 묶어 쓴다.
export async function fetchTeamHomeCity(teamId: number): Promise<{ city: string; country: string } | null> {
  const data = await authedFetch('/teams', { id: teamId });
  const venue = data.response?.[0]?.venue;
  if (!venue?.city) return null;
  return { city: venue.city, country: data.response[0].team.country };
}

export interface RecentFixture { dateIso: string; teamId: number }

export function parseRecentFixtures(raw: any[], teamId: number): RecentFixture[] {
  return raw
    .filter(f => f.teams.home.id === teamId || f.teams.away.id === teamId)
    .map(f => ({ dateIso: f.fixture.date, teamId }))
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

// from/to: "YYYY-MM-DD". 부하(Green/Amber/Red) 계산에 쓸 "최근 14일간 경기 수·마지막 경기 이후 휴식일"을 구하려고 호출한다.
export async function fetchRecentFixtures(teamId: number, season: number, from: string, to: string): Promise<RecentFixture[]> {
  const data = await authedFetch('/fixtures', { team: teamId, season, from, to });
  return parseRecentFixtures(data.response ?? [], teamId);
}

// surrogates.loadRating()에 바로 넣을 수 있는 두 값을 뽑는다.
export function restDaysAndGameCount(fixtures: RecentFixture[], asOf: Date, windowDays = 14): { restDays: number; gamesInWindow: number } {
  const windowStart = new Date(asOf.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const inWindow = fixtures.filter(f => { const d = new Date(f.dateIso); return d >= windowStart && d < asOf; });
  const past = fixtures.filter(f => new Date(f.dateIso) < asOf).sort((a, b) => b.dateIso.localeCompare(a.dateIso));
  const lastGame = past[0];
  const restDays = lastGame ? Math.floor((asOf.getTime() - new Date(lastGame.dateIso).getTime()) / (24 * 60 * 60 * 1000)) : Infinity;
  return { restDays, gamesInWindow: inWindow.length };
}
