import { z } from "zod";
// lib/types/facts.ts — docs/spec.md 7절 "수집 호출"이 돌려주는 MatchFactsBundle 구조.
// 배당·xG·순위는 데이터 API 담당이라 여기 없다(spec 7절 수집 프롬프트 규칙 4번째 줄).
// 확인 못한 값은 null + missing[]에 이유. 추정치를 넣지 않는다(CLAUDE.md 절대 규칙 3).

export interface AbsentPlayer {
  name: string;
  position: string | null;
  reason: string | null;
  officialConfirmed: boolean;
  sourceUrl: string;
  // 이번 시즌 팀 득점(골+어시스트)에서 이 선수가 차지하는 비중(0~1). 출처에서 실제로 확인한 수치만 넣는다.
  // layer2.attackingAbsenceFactor()의 s 값으로 그대로 쓰인다(spec.md 7절). 확인 못하면 null.
  teamGoalContributionShare: number | null;
}

export interface LineupInfo {
  confirmed: boolean; // 공식 발표 여부(false면 예상 라인업)
  home: string[] | null;
  away: string[] | null;
  sourceUrl: string | null;
}

export interface RefereeInfo {
  name: string | null;
  cardsPerGame: number | null;
  penaltiesPerGame: number | null;
  homeWinRate: number | null; // 0~1
  sourceUrl: string | null;
}

export interface ManagerTeamContext {
  managerAppointedOn: string | null; // ISO date
  summerKeyDepartures: number | null;
  isDerbyOrTitleOrRelegationRace: boolean | null;
  isCupFinal: boolean | null;
}

export interface MatchFactsBundle {
  home: { team: string; absentPlayers: AbsentPlayer[]; manager: ManagerTeamContext };
  away: { team: string; absentPlayers: AbsentPlayer[]; manager: ManagerTeamContext };
  lineup: LineupInfo;
  referee: RefereeInfo;
  missing: { field: string; reason: string }[];
  collectedAt: string; // ISO datetime
  modelId: string;
}

// 사실 추출(구조화 출력)에 쓰는 zod 스키마. 위 타입과 짝을 이룬다 (원본의 JSON Schema를 zod로 옮김).
const AbsentSchema = z.object({
  name: z.string(), position: z.string().nullable(), reason: z.string().nullable(),
  officialConfirmed: z.boolean(), sourceUrl: z.string(), teamGoalContributionShare: z.number().nullable(),
});
const TeamSchema = z.object({
  team: z.string(),
  absentPlayers: z.array(AbsentSchema),
  manager: z.object({
    managerAppointedOn: z.string().nullable(), summerKeyDepartures: z.number().nullable(),
    isDerbyOrTitleOrRelegationRace: z.boolean().nullable(), isCupFinal: z.boolean().nullable(),
  }),
});
export const FactsSchema = z.object({
  home: TeamSchema, away: TeamSchema,
  lineup: z.object({ confirmed: z.boolean(), home: z.array(z.string()).nullable(), away: z.array(z.string()).nullable(), sourceUrl: z.string().nullable() }),
  referee: z.object({ name: z.string().nullable(), cardsPerGame: z.number().nullable(), penaltiesPerGame: z.number().nullable(), homeWinRate: z.number().nullable(), sourceUrl: z.string().nullable() }),
  missing: z.array(z.object({ field: z.string(), reason: z.string() })),
});
