// src/pipeline/layer2.ts — docs/spec.md 7절 "사실 → Layer 2 보정 매핑" 표를 그대로 코드화.
// LLM은 사실(누가 빠졌는지, 비중이 얼마인지)만 내고, 배수는 여기서 고정 공식으로 계산한다(spec.md 5절).
// 각 함수는 적용 안 되면 null을 돌려준다 — "확인되지 않음" 항목은 보정하지 않는다(guideline 5단계).
import type { LoadRating } from './surrogates';
import type { AbsentPlayer } from './facts';

export interface FactorResult { factor: number; note: string }

// 포지션 문자열(LLM이 수집한 facts.position, 자유 텍스트)을 공격/GK·CB로 분류한다. 코드 판정이라 LLM 판단이 아니다.
export type PositionRole = 'ATTACK' | 'GK_CB' | 'OTHER';
export function classifyPosition(position: string | null): PositionRole {
  if (!position) return 'OTHER';
  const p = position.toLowerCase();
  if (/goalkeeper|^gk|centre.?back|center.?back|^cb/.test(p)) return 'GK_CB';
  if (/forward|striker|winger|attacking midfield|^st$|^lw$|^rw$|^cf$|^am$/.test(p)) return 'ATTACK';
  return 'OTHER';
}

// 결장자 목록에서 Layer2 공식이 바로 쓸 수 있는 두 값을 뽑는다.
// 공격 핵심: 비중이 가장 큰 1명만 반영(동시 결장을 전부 더하면 ±20% 상한에 바로 부딪혀 과대 보정이 되므로,
// spec.md 7절 공식 자체가 "득점 관여 비중 s" 단수형임을 그대로 따른다).
export function attackingAbsenceShare(absentPlayers: AbsentPlayer[]): number | null {
  const shares = absentPlayers
    .filter(p => classifyPosition(p.position) === 'ATTACK' && p.teamGoalContributionShare != null)
    .map(p => p.teamGoalContributionShare!);
  return shares.length ? Math.max(...shares) : null;
}

export function gkCbAbsentCount(absentPlayers: AbsentPlayer[]): number {
  return absentPlayers.filter(p => classifyPosition(p.position) === 'GK_CB').length;
}

// 공격 핵심(ST·W·AM) 결장, 팀 득점 관여 비중 s(0~1) → λ × (1 − clamp(s/2, 0.05, 0.12))
export function attackingAbsenceFactor(scoringShare: number | null): FactorResult | null {
  if (scoringShare == null) return null;
  const cut = Math.min(0.12, Math.max(0.05, scoringShare / 2));
  const factor = 1 - cut;
  return { factor, note: `공격 핵심 결장(득점관여 ${(scoringShare * 100).toFixed(1)}%) → ×${factor.toFixed(3)}` };
}

// 상대 주전 GK·CB 결장 → 이 팀 λ × 1.04(1명) ~ 1.10(2명 이상)
export function opponentGkCbAbsenceFactor(opponentAbsentCount: number | null): FactorResult | null {
  if (opponentAbsentCount == null || opponentAbsentCount <= 0) return null;
  const factor = opponentAbsentCount >= 2 ? 1.10 : 1.04;
  return { factor, note: `상대 주전 GK·CB ${opponentAbsentCount}명 결장 → ×${factor}` };
}

// 이 팀 부하 Red & 상대 Green → ×0.95 / 이 팀 Green & 상대 Red → ×1.03
export function loadFactor(thisTeam: LoadRating | null, opponent: LoadRating | null): FactorResult | null {
  if (thisTeam == null || opponent == null) return null;
  if (thisTeam === 'Red' && opponent === 'Green') return { factor: 0.95, note: '부하 Red·상대 Green → ×0.95' };
  if (thisTeam === 'Green' && opponent === 'Red') return { factor: 1.03, note: '상대 부하 Red·이 팀 Green → ×1.03' };
  return null;
}

// 원정팀에만 적용: 이동 거리 1,000km 초과 또는 A매치 직후 → ×0.96
export function awayTravelFactor(distanceKm: number | null, justAfterInternationalDuty: boolean): FactorResult | null {
  if (distanceKm == null) return justAfterInternationalDuty ? { factor: 0.96, note: 'A매치 직후 → ×0.96' } : null;
  if (distanceKm > 1000 || justAfterInternationalDuty) {
    return { factor: 0.96, note: `원정 이동 ${distanceKm.toFixed(0)}km${justAfterInternationalDuty ? '·A매치 직후' : ''} → ×0.96` };
  }
  return null;
}

// 감독 부임 3개월 미만 또는 최근 5경기 선발 변동 4명 이상 → 이 팀 λ × 0.97
export function managerInstabilityFactor(tenureMonths: number | null, startingChangesLast5: number | null): FactorResult | null {
  const unstable = (tenureMonths != null && tenureMonths < 3) || (startingChangesLast5 != null && startingChangesLast5 >= 4);
  return unstable ? { factor: 0.97, note: '감독·라인업 Unstable → ×0.97' } : null;
}

// 강수 확률 70% 이상 또는 풍속 10m/s 이상 → 양 팀 λ × 0.97
export function weatherFactor(precipProbability: number | null, windSpeedMs: number | null): FactorResult | null {
  const bad = (precipProbability != null && precipProbability >= 0.70) || (windSpeedMs != null && windSpeedMs >= 10);
  return bad ? { factor: 0.97, note: '강수 70%↑ 또는 풍속 10m/s↑ → ×0.97' } : null;
}

// 팀 하나의 모든 Layer2 보정을 모아 engine.applyAdjustments()에 바로 넣을 수 있는 배열로 만든다.
export function collectFactors(results: (FactorResult | null)[]): { factors: number[]; notes: string[] } {
  const applied = results.filter((r): r is FactorResult => r != null);
  return { factors: applied.map(r => r.factor), notes: applied.map(r => r.note) };
}
