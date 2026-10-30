// engine.ts — Project Gem 퀀트 엔진 (지침 v9.1 기준, 결정적 계산만 수행)
// 원문: docs/guideline-v9.1.md 4~9단계, 5.3절. 수치가 다르면 원문을 따른다.
export type Grade = 'A' | 'B' | 'C';
export type Market = '1X2' | 'OU25' | 'BTTS' | 'AH';
export type Selection = 'HOME' | 'DRAW' | 'AWAY' | 'OVER' | 'UNDER' | 'YES' | 'NO' | 'AH_HOME' | 'AH_AWAY';

export const CONFIG = {
  version: 'v9.1',
  shrinkK: 10, shrinkKHighUncertainty: 15,
  xgWeight: 0.7,                       // xG 0.7 + 실제 득실 0.3 (양 팀 모두 xG가 있을 때만)
  adjustCap: 0.20,                     // Layer 2 팀당 누적 보정 상한 ±20%
  rho: -0.10, maxGoals: 8,             // Dixon-Coles, 0~8골
  modelWeight: { A: 0.6, B: 0.5, C: 0 } as Record<Grade, number>,
  rsCap: { A: 5, B: 4, C: 3 } as Record<Grade, number>,
  minEdge: { A: 0.05, B: 0.07, C: Infinity } as Record<Grade, number>,
  edgeAutoMultiplier: 1.5,             // 최근 정산 30건 평균 |P_model−Q| × 1.5 (CLAUDE.md에서 확인)
  gapExclude: 0.12,                    // |P_model − Q| ≥ 12%p 무조건 배제
  minOdds: 1.40, minRsToBet: 3,
  kellyFraction: 0.25, matchCap: 0.03, dailyCap: 0.10,
  observationUntilSettled: 30,         // 정산 30건 전에는 베팅액 0(관찰)
  sanityGap: 0.20,                     // 4단계 6항 검산: 1X2 최대 괴리 20%p 초과 → 재계산, 재실패 시 모델 산출 실패
  priorRoundCutoff: 8,                 // 8라운드 이상이면 prior = 1.0
  promotedPrior: { att: 0.85, def: 1.15 },
  reducedStageFactor: 0.5,             // 관찰 해제 후 3주 축소 단계
};
export type Status = '채택' | '베팅없음' | '관찰';

// ---------- Layer 1: 공격·수비 지수와 λ ----------
export interface TeamInput {
  n: number;                 // 이번 시즌 경기 수
  gfPerGame: number; gaPerGame: number;
  xgPerGame?: number; xgaPerGame?: number;
  priorAtt: number; priorDef: number;  // choosePrior() 결과
  highUncertainty: boolean;  // 감독 교체 3개월 이내, 주전 3명+ 이적, 승격팀, 8라운드 미만
}
export interface LeagueInput { muHome: number; muAway: number; }

// 4단계 3항: 수축 목표(prior) 선택
export type PriorSource = 'league-mean' | 'last-season' | 'promoted' | 'promoted-default' | 'market-implied';
export function choosePrior(o: {
  round: number; lastSeason?: { att: number; def: number }; promoted?: boolean;
  promotedConverted?: { att: number; def: number }; lastSeasonMeaningless?: boolean;
  marketImplied?: { att: number; def: number };
}): { att: number; def: number; source: PriorSource } {
  if (o.round >= CONFIG.priorRoundCutoff) return { att: 1, def: 1, source: 'league-mean' };
  if (o.lastSeasonMeaningless && o.marketImplied) return { ...o.marketImplied, source: 'market-implied' };
  if (o.promoted) return o.promotedConverted ? { ...o.promotedConverted, source: 'promoted' } : { ...CONFIG.promotedPrior, source: 'promoted-default' };
  if (o.lastSeason) return { ...o.lastSeason, source: 'last-season' };
  throw new Error('prior 미확보: 8라운드 미만인데 직전 시즌 지수도 시장 역산 prior도 없음');
}

// 4단계 1항: 8라운드 미만이면 리그 평균을 직전 시즌과 경기 수 비례로 결합
export function blendLeagueMeans(cur: LeagueInput & { games: number }, prev: LeagueInput & { games: number }, round: number): LeagueInput {
  if (round >= CONFIG.priorRoundCutoff) return { muHome: cur.muHome, muAway: cur.muAway };
  const w = cur.games / (cur.games + prev.games);
  return { muHome: w * cur.muHome + (1 - w) * prev.muHome, muAway: w * cur.muAway + (1 - w) * prev.muAway };
}

export function teamIndices(t: TeamInput, league: LeagueInput, useXg: boolean) {
  const mu = (league.muHome + league.muAway) / 2;
  const g = CONFIG.xgWeight;
  const att = useXg ? (g * t.xgPerGame! + (1 - g) * t.gfPerGame) / mu : t.gfPerGame / mu;
  const def = useXg ? (g * t.xgaPerGame! + (1 - g) * t.gaPerGame) / mu : t.gaPerGame / mu;
  const k = t.highUncertainty ? CONFIG.shrinkKHighUncertainty : CONFIG.shrinkK;
  const w = t.n / (t.n + k);                       // 수축 목표 = choosePrior()로 고른 prior
  return { att: w * att + (1 - w) * t.priorAtt, def: w * def + (1 - w) * t.priorDef, w };
}

export function baselineLambdas(home: TeamInput, away: TeamInput, league: LeagueInput) {
  const bothXg = [home, away].every(t => t.xgPerGame != null && t.xgaPerGame != null);
  const H = teamIndices(home, league, bothXg), A = teamIndices(away, league, bothXg);
  return { lamHome: league.muHome * H.att * A.def, lamAway: league.muAway * A.att * H.def, H, A, xgBlended: bothXg };
}

// ---------- Layer 2: 고정 보정표 적용(누적 ±20%) ----------
export function applyAdjustments(lam: number, factors: number[]) {
  const raw = factors.reduce((p, f) => p * f, 1);
  const capped = Math.min(1 + CONFIG.adjustCap, Math.max(1 - CONFIG.adjustCap, raw));
  return { lam: lam * capped, factor: capped };
}

// ---------- 7단계: 포아송 + Dixon-Coles 스코어 매트릭스 ----------
const pois = (k: number, l: number) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return Math.exp(-l) * l ** k / f; };
function tau(x: number, y: number, lh: number, la: number, rho: number) {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}
export function scoreMatrix(lh: number, la: number, rho = CONFIG.rho) {
  const N = CONFIG.maxGoals, m: number[][] = [];
  let z = 0;
  for (let h = 0; h <= N; h++) { m.push([]); for (let a = 0; a <= N; a++) { const p = pois(h, lh) * pois(a, la) * tau(h, a, lh, la, rho); m[h].push(p); z += p; } }
  return m.map(r => r.map(p => p / z));
}
export function marketProbs(m: number[][], ahLine = -0.5) {
  let home = 0, draw = 0, away = 0, over25 = 0, btts = 0, ahHome = 0, ahPush = 0;
  m.forEach((row, h) => row.forEach((p, a) => {
    if (h > a) home += p; else if (h === a) draw += p; else away += p;
    if (h + a > 2.5) over25 += p;
    if (h > 0 && a > 0) btts += p;
    const d = h - a + ahLine;                       // 홈 기준 핸디캡
    if (d > 0) ahHome += p; else if (d === 0) ahPush += p;
  }));
  const top = m.flatMap((row, h) => row.map((p, a) => ({ score: `${h}-${a}`, p }))).sort((x, y) => y.p - x.p).slice(0, 3);
  return { HOME: home, DRAW: draw, AWAY: away, OVER: over25, UNDER: 1 - over25, YES: btts, NO: 1 - btts,
           AH_HOME: ahHome, AH_PUSH: ahPush, AH_AWAY: 1 - ahHome - ahPush, top };
}

// ---------- 6단계: 마진 제거와 결합 ----------
export function devig(odds: number[]) {
  const inv = odds.map(o => 1 / o), s = inv.reduce((a, b) => a + b, 0);
  return { q: inv.map(x => x / s), margin: s - 1 };
}

// 4단계 6항 검산: 1X2 최대 괴리 > 20%p면 prior 재점검 후 재계산, 재실패 시 전 시장 제외
export function sanityCheck(pModel1x2: number[], q1x2: number[]) {
  const maxGap = Math.max(...pModel1x2.map((p, i) => Math.abs(p - q1x2[i])));
  return { maxGap, ok: maxGap <= CONFIG.sanityGap };
}

// ---------- 8~9단계: 가치, 견고함, 베팅액 ----------
export interface Candidate {
  market: Market; selection: Selection; odds: number; oddsOpen?: number;
  pModel: number; q: number;
}
export interface RsFlags { tier2: boolean; lineupConfirmed: boolean; noUncertainty: boolean; noJoker: boolean; }

// recentMeanGap: 최근 정산 30건 평균 |P_model−Q|. 누적 정산 30건 미만이면 넘기지 않는다(자동 조정 미적용).
export function evaluate(c: Candidate, grade: Grade, flags: RsFlags, tier2Missing: boolean, recentMeanGap?: number, modelFailed = false) {
  const reasons: string[] = [];
  const w = CONFIG.modelWeight[grade];
  const p = w * c.pModel + (1 - w) * c.q;
  const edge = p - c.q, gap = Math.abs(c.pModel - c.q);
  const threshold = Math.max(CONFIG.minEdge[grade], recentMeanGap != null ? CONFIG.edgeAutoMultiplier * recentMeanGap : 0);
  const conds = [flags.tier2, flags.lineupConfirmed, gap <= 0.10, flags.noUncertainty, flags.noJoker];
  let rs = Math.max(1, conds.filter(Boolean).length);
  rs = Math.min(rs, CONFIG.rsCap[grade], tier2Missing ? 3 : 5);
  if (modelFailed) reasons.push('모델 산출 실패(검산 20%p 초과)');
  if (grade === 'C') reasons.push('C등급 베팅 금지');
  if (gap >= CONFIG.gapExclude) reasons.push(`모델-시장 괴리 ${(gap * 100).toFixed(1)}%p ≥ 12%p`);
  if (edge < threshold) reasons.push(`Edge ${(edge * 100).toFixed(1)}%p < 임계 ${(threshold * 100).toFixed(1)}%p`);
  if (p * c.odds <= 1) reasons.push(`실배당 기준 P×O = ${(p * c.odds).toFixed(3)} ≤ 1`);
  if (c.odds < CONFIG.minOdds) reasons.push('배당 1.40 미만');
  if (rs < CONFIG.minRsToBet) reasons.push(`RS ${rs} ≤ 2`);
  if (c.oddsOpen == null) reasons.push('개장 배당 미확보');
  const kelly = Math.max(0, ((p * c.odds - 1) / (c.odds - 1)) * CONFIG.kellyFraction);
  const eligible = reasons.length === 0;
  // RS ≤ 2만 걸린 시장은 '관찰', 그 밖의 배제는 '베팅없음'
  const onlyRs = reasons.length === 1 && reasons[0].startsWith('RS');
  const status: Status = eligible ? '채택' : onlyRs ? '관찰' : '베팅없음';
  return { ...c, p, edge, gap, threshold, rs, breakeven: 1 / p, kelly, eligible, status, reasons };
}

// 5.3절 운용 단계
export type Stage = '관찰' | '축소' | '정상';
export function operatingStage(settled: number, modelBrier?: number, marketBrier?: number, meanClv?: number, reducedUntil?: Date, now = new Date()): Stage {
  if (settled < CONFIG.observationUntilSettled) return '관찰';
  if (modelBrier == null || marketBrier == null || modelBrier > marketBrier || !(meanClv != null && meanClv > 0)) return '관찰';
  return reducedUntil && now < reducedUntil ? '축소' : '정상';
}

// 9단계: 경기당 1베팅 + 로그 조회 기반 상한 강제
export function buildPortfolio(
  evals: ReturnType<typeof evaluate>[], bankroll: number,
  log: { matchAlreadyStaked: boolean; dayStakedKrw: number }, stage: Stage,
) {
  const pick = evals.filter(e => e.eligible).sort((a, b) => b.edge * b.rs - a.edge * a.rs)[0];
  if (!pick) return { pick: null, stake: 0, theoreticalStake: 0, status: '베팅없음' as Status };
  if (log.matchAlreadyStaked) return { pick, stake: 0, theoreticalStake: 0, status: '베팅없음' as Status, note: '같은 경기에 이미 베팅액 있음' };
  let stake = bankroll * pick.kelly * (pick.rs / 5);
  if (stage === '축소') stake *= CONFIG.reducedStageFactor;
  stake = Math.min(stake, bankroll * CONFIG.matchCap, Math.max(0, bankroll * CONFIG.dailyCap - log.dayStakedKrw));
  const theoretical = Math.round(stake / 100) * 100;                     // 관찰 단계에서도 notes에 남길 이론값
  if (stage === '관찰') return { pick, stake: 0, theoreticalStake: theoretical, status: '관찰' as Status };
  return { pick, stake: theoretical, theoreticalStake: theoretical, status: theoretical > 0 ? '채택' as Status : '베팅없음' as Status };
}

// ---------- 프로토 배당 비교 ----------
export function protoCheck(p: number, protoOdds: number) {
  const ev = p * protoOdds;
  return { breakeven: 1 / p, ev, keepsEdge: ev > 1, kelly: Math.max(0, ((ev - 1) / (protoOdds - 1)) * CONFIG.kellyFraction) };
}
