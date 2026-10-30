// src/pipeline/surrogates.ts — docs/guideline-v9.1.md 3.2절 정성 등급(대리 지표). 전부 결정적 계산이다.
// "이동 거리는 경기장 좌표로, 부하는 일정 API로... 코드가 직접 계산한다. LLM에게 맡기지 않는다"(spec.md 7절).
export type LoadRating = 'Green' | 'Amber' | 'Red';
export type TravelBurden = 'Low' | 'Mid' | 'High';
export type Stability = 'Stable' | 'Transitional' | 'Unstable';

// 핵심 선수 부하: 휴식일 ≥4 & 최근 14일 ≤3경기 → Green, 휴식 ≤2 또는 14일간 ≥4경기 → Red, 그 외 Amber.
export function loadRating(restDays: number, gamesInLast14Days: number): LoadRating {
  if (restDays >= 4 && gamesInLast14Days <= 3) return 'Green';
  if (restDays <= 2 || gamesInLast14Days >= 4) return 'Red';
  return 'Amber';
}

const EARTH_RADIUS_KM = 6371;
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 원정 이동 부담: <300km Low, 300~1000km Mid, >1000km 또는 A매치 직후 High.
export function travelBurden(distanceKm: number, justAfterInternationalDuty: boolean): TravelBurden {
  if (justAfterInternationalDuty || distanceKm > 1000) return 'High';
  if (distanceKm >= 300) return 'Mid';
  return 'Low';
}

// 감독·라인업 안정성: 재임 ≥12개월 & 최근 5경기 선발 변동 ≤2명 → Stable,
// 재임 <3개월 또는 변동 ≥4명 → Unstable, 그 외 Transitional.
export function managerStability(tenureMonths: number, startingLineupChangesLast5: number): Stability {
  if (tenureMonths < 3 || startingLineupChangesLast5 >= 4) return 'Unstable';
  if (tenureMonths >= 12 && startingLineupChangesLast5 <= 2) return 'Stable';
  return 'Transitional';
}

// 4단계 5항 "불확실성 높음" 판정: 감독 교체 3개월 이내, 주전 3명 이상 이적, 승격팀, 8라운드 미만 중 하나라도.
export function isHighUncertainty(o: {
  managerTenureMonths: number | null; summerKeyDepartures: number | null; promoted: boolean; round: number;
}): boolean {
  return (
    (o.managerTenureMonths != null && o.managerTenureMonths < 3) ||
    (o.summerKeyDepartures != null && o.summerKeyDepartures >= 3) ||
    o.promoted ||
    o.round < 8
  );
}
