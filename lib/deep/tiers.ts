// src/pipeline/tiers.ts — docs/guideline-v9.1.md 3.1·3.3절: 데이터 계층(Tier)과 리그 커버리지 등급.
// 결정적 코드다. LLM은 사실만 모으고, 등급·게이트 판정은 여기서 한다(CLAUDE.md 절대 규칙 1·2).
import type { Grade } from './engine';

// 3.3 리그별 기본 등급(예시 목록). 실제 등급은 resolveGrade()에서 데이터 확보 여부로 다시 판정한다.
const A_LEAGUES = ['Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'UEFA Champions League', 'UEFA Europa League'];
const B_LEAGUES = ['K League 1', 'J1 League', 'MLS', 'Championship', 'Eredivisie', 'Primeira Liga'];

export function baseGradeForLeague(leagueName: string): Grade {
  if (A_LEAGUES.includes(leagueName)) return 'A';
  if (B_LEAGUES.includes(leagueName)) return 'B';
  return 'C';
}

// "A등급 리그라도 xG를 얻지 못하면 B로 강등"(3.3절). B 리그가 xG도 PPDA도 없는 경우는 대부분 정상(B 정의상
// PPDA는 원래 불가) — xG마저 없으면 한 단계 더 낮춰 C로 본다(xG 없이 득실만으로 분석하는 C와 동일한 상태이므로).
export function resolveGrade(leagueName: string, data: { hasXg: boolean; hasPpda: boolean }): { grade: Grade; downgradedFrom?: Grade; reason?: string } {
  const base = baseGradeForLeague(leagueName);
  if (base === 'A') {
    if (!data.hasXg) return { grade: 'B', downgradedFrom: 'A', reason: 'A등급 리그이나 xG 미확보(3.3절)' };
    return { grade: 'A' };
  }
  if (base === 'B') {
    if (!data.hasXg) return { grade: 'C', downgradedFrom: 'B', reason: 'B등급 리그이나 xG 미확보' };
    return { grade: 'B' };
  }
  return { grade: 'C' };
}

// 3.1 Tier 1(필수) 체크리스트. 하나라도 비면 "베팅 없음 — 필수 데이터 미확보"로 분석을 중단한다.
export interface Tier1Data {
  fixtureExists: boolean;
  kickoffKnown: boolean;
  venueKnown: boolean;
  marketOdds: boolean; // 1X2/OU/AH 배당 중 하나라도 확보
  leagueStanding: boolean;
  recentForm: boolean; // 최근 5~10경기 득실
  homeAwaySplit: boolean;
  headToHead: boolean;
  absentPlayers: boolean; // "결장자 없음 확인됨"도 포함 — 항목 자체를 확인했는지가 기준
}

export function checkTier1(data: Tier1Data): { ok: true } | { ok: false; missing: string[] } {
  const labels: Record<keyof Tier1Data, string> = {
    fixtureExists: '경기 존재 여부', kickoffKnown: '킥오프', venueKnown: '경기장',
    marketOdds: '승무패·OU·핸디캡 배당', leagueStanding: '리그 순위', recentForm: '최근 5~10경기 득실',
    homeAwaySplit: '홈/원정 성적', headToHead: '상대 전적', absentPlayers: '결장자(부상·징계) 확인',
  };
  const missing = (Object.keys(data) as (keyof Tier1Data)[]).filter(k => !data[k]).map(k => labels[k]);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// 3.1 Tier 2(고급). 미확보 항목이 있으면 RS 상한을 3으로 제한(engine.evaluate()의 tier2Missing 인자로 넘긴다).
export interface Tier2Data { xg: boolean; xga: boolean; ppda: boolean; refereeStats: boolean; expectedLineup: boolean }
export function tier2Missing(data: Tier2Data): boolean {
  return !data.xg || !data.xga || !data.refereeStats || !data.expectedLineup; // PPDA는 A등급만 기대값이라 제외
}
