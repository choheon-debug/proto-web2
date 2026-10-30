// src/pipeline/analyze.ts — 지침 4~8단계를 engine.ts·tiers.ts·surrogates.ts·layer2.ts로 엮는 오케스트레이터.
// 여기서는 "분석"(확률·Edge·RS 산출)까지만 한다. 9단계 포트폴리오(경기당 1베팅, 노출 상한, 운용 단계)는
// betting_log.csv 조회가 필요해 아직 분리된 별도 모듈로 넘기지 않았다 — buildPortfolio()를 호출하는 쪽에서
// evaluations를 그대로 넘기면 된다(engine.ts의 buildPortfolio는 이미 완성돼 있음).
import {
  type TeamInput, type LeagueInput, type Grade, type Market, type Selection,
  choosePrior, blendLeagueMeans, baselineLambdas, applyAdjustments, scoreMatrix, marketProbs,
  devig, sanityCheck, evaluate, type RsFlags,
} from './engine';
import { resolveGrade, tier2Missing as computeTier2Missing, type Tier2Data } from './tiers';
import { isHighUncertainty, loadRating, type LoadRating, managerStability } from './surrogates';
import {
  attackingAbsenceFactor, opponentGkCbAbsenceFactor, loadFactor, awayTravelFactor,
  managerInstabilityFactor, weatherFactor, collectFactors, attackingAbsenceShare, gkCbAbsentCount,
} from './layer2';
import type { MatchFactsBundle } from './facts';

export interface TeamSeasonSnapshot {
  name: string;
  round: number; // 이번 시즌 경기 수
  gfPerGame: number; gaPerGame: number;
  xgPerGame?: number; xgaPerGame?: number;
  lastSeasonIndices?: { att: number; def: number };
  promoted?: boolean;
  promotedConverted?: { att: number; def: number };
  lastSeasonMeaningless?: boolean;
  marketImpliedPrior?: { att: number; def: number };
  managerTenureMonths: number | null;
  startingChangesLast5: number | null;
  summerKeyDepartures: number | null;
  restDays: number;
  gamesInLast14Days: number;
  distanceKm?: number | null; // 원정팀에만 의미 있음(홈 경기장으로부터)
  justAfterInternationalDuty?: boolean;
}

export interface LeagueSnapshot {
  name: string;
  muHome: number; muAway: number;
  gamesPlayedAvg: number; // 현재 시즌 리그 평균 경기 수(8라운드 미만 가중 결합용)
  prevSeason?: { muHome: number; muAway: number; games: number };
}

export interface WeatherSnapshot { precipProbability: number | null; windSpeedMs: number | null }

export interface MarketCandidateInput {
  market: Market; line?: string; selection: Selection; odds: number; oddsOpen?: number;
}

export interface AnalyzeInput {
  home: TeamSeasonSnapshot;
  away: TeamSeasonSnapshot;
  league: LeagueSnapshot;
  facts: MatchFactsBundle;
  weather: WeatherSnapshot | null;
  hasXg: boolean;
  tier2: Tier2Data;
  marketOdds: MarketCandidateInput[]; // 같은 market끼리는 devig()로 한 번에 묶인다(marketProbs가 쓰는 순서와 무관, selection으로 매칭)
  refereeHomeWinRateOutlier: boolean; // |주심 홈승률 - 리그 평균| >= 5%p (guideline 3.2절)
  isDerbyOrFinal: boolean;
  recentMeanGap?: number; // 정산 30건 이상일 때만 넘긴다(engine.evaluate의 자동 임계값 조정용)
}

export interface MarketEvaluation extends ReturnType<typeof evaluate> {
  pModelRaw: number; // marketProbs()가 그대로 낸 값(검산·표시용, evaluate()의 p와는 다름 — p는 w*pModel+(1-w)*q)
}

export interface AnalysisResult {
  grade: Grade;
  gradeNote?: string;
  lambdas: { home: number; away: number };
  xgBlended: boolean;
  priorSources: { home: string; away: string };
  layer2: { home: string[]; away: string[] };
  sanity: { ok: boolean; maxGap: number };
  modelFailed: boolean;
  topScores: { score: string; p: number }[];
  evaluations: MarketEvaluation[];
  // proto-web2 추가: 프로토 배당을 같은 기준으로 평가하려고 견고함 조건과 Tier2 결측 여부를 함께 돌려준다
  flags: RsFlags;
  tier2MissingFlag: boolean;
}

function toRsFlags(o: {
  tier2Missing: boolean; lineupConfirmed: boolean;
  homeHighUncertainty: boolean; awayHighUncertainty: boolean;
  homeStability: ReturnType<typeof managerStability>; awayStability: ReturnType<typeof managerStability>;
  badWeather: boolean; refereeOutlier: boolean; isDerbyOrFinal: boolean;
}): RsFlags {
  return {
    tier2: !o.tier2Missing,
    lineupConfirmed: o.lineupConfirmed,
    // guideline 8단계 조건4: 양 팀 모두 불확실성 높음 아님 + 감독·라인업 Stable
    noUncertainty: !o.homeHighUncertainty && !o.awayHighUncertainty && o.homeStability === 'Stable' && o.awayStability === 'Stable',
    // 조건5: 조커 변수(강수·강풍, 주심 이상치, 더비·결승) 없음
    noJoker: !o.badWeather && !o.refereeOutlier && !o.isDerbyOrFinal,
  };
}

export function computeAnalysis(input: AnalyzeInput): AnalysisResult {
  const { grade, reason: gradeNote } = resolveGrade(input.league.name, { hasXg: input.hasXg, hasPpda: false });

  const homeHighUnc = isHighUncertainty({
    managerTenureMonths: input.home.managerTenureMonths, summerKeyDepartures: input.home.summerKeyDepartures,
    promoted: !!input.home.promoted, round: input.home.round,
  });
  const awayHighUnc = isHighUncertainty({
    managerTenureMonths: input.away.managerTenureMonths, summerKeyDepartures: input.away.summerKeyDepartures,
    promoted: !!input.away.promoted, round: input.away.round,
  });

  const homePrior = choosePrior({
    round: input.home.round, lastSeason: input.home.lastSeasonIndices, promoted: input.home.promoted,
    promotedConverted: input.home.promotedConverted, lastSeasonMeaningless: input.home.lastSeasonMeaningless,
    marketImplied: input.home.marketImpliedPrior,
  });
  const awayPrior = choosePrior({
    round: input.away.round, lastSeason: input.away.lastSeasonIndices, promoted: input.away.promoted,
    promotedConverted: input.away.promotedConverted, lastSeasonMeaningless: input.away.lastSeasonMeaningless,
    marketImplied: input.away.marketImpliedPrior,
  });

  const minRound = Math.min(input.home.round, input.away.round);
  const league: LeagueInput = input.league.prevSeason
    ? blendLeagueMeans(
      { muHome: input.league.muHome, muAway: input.league.muAway, games: input.league.gamesPlayedAvg },
      { muHome: input.league.prevSeason.muHome, muAway: input.league.prevSeason.muAway, games: input.league.prevSeason.games },
      minRound,
    )
    : { muHome: input.league.muHome, muAway: input.league.muAway };

  const homeTeam: TeamInput = {
    n: input.home.round, gfPerGame: input.home.gfPerGame, gaPerGame: input.home.gaPerGame,
    xgPerGame: input.home.xgPerGame, xgaPerGame: input.home.xgaPerGame,
    priorAtt: homePrior.att, priorDef: homePrior.def, highUncertainty: homeHighUnc,
  };
  const awayTeam: TeamInput = {
    n: input.away.round, gfPerGame: input.away.gfPerGame, gaPerGame: input.away.gaPerGame,
    xgPerGame: input.away.xgPerGame, xgaPerGame: input.away.xgaPerGame,
    priorAtt: awayPrior.att, priorDef: awayPrior.def, highUncertainty: awayHighUnc,
  };

  const base = baselineLambdas(homeTeam, awayTeam, league);

  const homeLoad: LoadRating = loadRating(input.home.restDays, input.home.gamesInLast14Days);
  const awayLoad: LoadRating = loadRating(input.away.restDays, input.away.gamesInLast14Days);
  // 선발 변동 수를 모르면(null) Stable 조건(<=2명)도 Unstable 조건(>=4명)도 만족시키지 않는 중립값(3)으로 둔다
  // — 확인 못 한 데이터를 유리한 쪽(Stable)으로 밀어붙이지 않기 위함.
  const homeStability = managerStability(input.home.managerTenureMonths ?? 0, input.home.startingChangesLast5 ?? 3);
  const awayStability = managerStability(input.away.managerTenureMonths ?? 0, input.away.startingChangesLast5 ?? 3);

  const weather = weatherFactor(input.weather?.precipProbability ?? null, input.weather?.windSpeedMs ?? null);
  const badWeather = weather != null;

  const homeShare = attackingAbsenceShare(input.facts.home.absentPlayers);
  const awayShare = attackingAbsenceShare(input.facts.away.absentPlayers);
  const homeGkCbMissing = gkCbAbsentCount(input.facts.home.absentPlayers);
  const awayGkCbMissing = gkCbAbsentCount(input.facts.away.absentPlayers);

  const home2 = collectFactors([
    attackingAbsenceFactor(homeShare),
    opponentGkCbAbsenceFactor(awayGkCbMissing), // 상대(원정) GK·CB 결장 → 홈 공격 유리
    loadFactor(homeLoad, awayLoad),
    managerInstabilityFactor(input.home.managerTenureMonths, input.home.startingChangesLast5),
    weather,
  ]);
  const away2 = collectFactors([
    attackingAbsenceFactor(awayShare),
    opponentGkCbAbsenceFactor(homeGkCbMissing), // 상대(홈) GK·CB 결장 → 원정 공격 유리
    loadFactor(awayLoad, homeLoad),
    managerInstabilityFactor(input.away.managerTenureMonths, input.away.startingChangesLast5),
    awayTravelFactor(input.away.distanceKm ?? null, !!input.away.justAfterInternationalDuty),
    weather,
  ]);

  const homeAdj = applyAdjustments(base.lamHome, home2.factors);
  const awayAdj = applyAdjustments(base.lamAway, away2.factors);

  const matrix = scoreMatrix(homeAdj.lam, awayAdj.lam);
  const mp = marketProbs(matrix);

  const oneXTwo = input.marketOdds.filter(c => c.market === '1X2');
  let sanity: ReturnType<typeof sanityCheck> = { maxGap: 0, ok: true }; // 1X2 배당 3개가 없으면 검산 스킵(통과 처리)
  if (oneXTwo.length === 3) {
    const { q } = devig(oneXTwo.map(c => c.odds));
    const qBySelection = new Map(oneXTwo.map((c, i) => [c.selection, q[i]] as const));
    sanity = sanityCheck([mp.HOME, mp.DRAW, mp.AWAY], ['HOME', 'DRAW', 'AWAY'].map(s => qBySelection.get(s as Selection)!));
  }
  const modelFailed = !sanity.ok;

  const flags = toRsFlags({
    tier2Missing: computeTier2Missing(input.tier2),
    lineupConfirmed: input.facts.lineup.confirmed,
    homeHighUncertainty: homeHighUnc, awayHighUncertainty: awayHighUnc,
    homeStability, awayStability,
    badWeather, refereeOutlier: input.refereeHomeWinRateOutlier, isDerbyOrFinal: input.isDerbyOrFinal,
  });

  // market별로 odds를 묶어 devig → P_model과 짝지어 evaluate.
  const byMarket = new Map<string, MarketCandidateInput[]>();
  for (const c of input.marketOdds) {
    const key = c.market + (c.line ?? '');
    const list = byMarket.get(key);
    if (list) list.push(c); else byMarket.set(key, [c]);
  }
  const pModelBySelection: Record<Selection, number> = {
    HOME: mp.HOME, DRAW: mp.DRAW, AWAY: mp.AWAY, OVER: mp.OVER, UNDER: mp.UNDER,
    YES: mp.YES, NO: mp.NO, AH_HOME: mp.AH_HOME, AH_AWAY: mp.AH_AWAY,
  };

  const evaluations: MarketEvaluation[] = [];
  for (const group of byMarket.values()) {
    const { q } = devig(group.map(c => c.odds));
    group.forEach((c, i) => {
      const pModel = pModelBySelection[c.selection];
      const ev = evaluate(
        { market: c.market, selection: c.selection, odds: c.odds, oddsOpen: c.oddsOpen, pModel, q: q[i] },
        grade, flags, computeTier2Missing(input.tier2), input.recentMeanGap, modelFailed,
      );
      evaluations.push({ ...ev, pModelRaw: pModel });
    });
  }

  return {
    grade, gradeNote,
    lambdas: { home: homeAdj.lam, away: awayAdj.lam },
    xgBlended: base.xgBlended,
    priorSources: { home: homePrior.source, away: awayPrior.source },
    layer2: { home: home2.notes, away: away2.notes },
    sanity, modelFailed,
    topScores: mp.top,
    evaluations,
    flags,
    tier2MissingFlag: computeTier2Missing(input.tier2),
  };
}
