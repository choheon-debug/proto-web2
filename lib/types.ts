// 승·무·패 세 가지 결과 (홈 기준)
export type Trio = [number, number, number];
export const OUTCOMES = ["승", "무", "패"] as const;

export type Match = {
  id: string;
  league: string;          // The Odds API 리그 키
  kickoff: string;         // ISO (UTC)
  home: string;
  away: string;
  odds: Trio | null;       // 해외 배당 (배팅사 중앙값)
  books: number;           // 배당을 낸 배팅사 수
};

export type Analysis = {
  probs: Trio;             // 최종 확률 (0~1)
  marketProbs: Trio;       // 시장 확률
  adjust: Trio;            // AI 보정 (%p)
  summary: string;         // 한두 문장 결론 이유
  info: string[];          // 핵심 정보 3~5줄
  form: { home: string; away: string };   // 최근 5경기 "WWDLW" (W승 D무 L패, 왼쪽이 최근)
  sources: { title: string; url: string }[];
  at: string;
};

export type Bet = {
  id: string;
  date: string;            // YYYY-MM-DD (KST, 건 날)
  label: string;           // "아스널 vs 리버풀 · 승" 또는 "3폴더 조합"
  odds: number;
  stake: number;
  kind: "value" | "gut";   // 🟢 분석대로 / 🎲 감으로
  result: "pending" | "win" | "lose" | "void";
  // 경기 분석 화면에서 넣은 기록만: 경기가 끝나면 자동 채점에 쓴다
  match?: { id: string; league: string; kickoff: string; pick: 0 | 1 | 2 };
  score?: string;          // "2 : 1" (자동 채점 때 적음)
  auto?: boolean;          // 자동으로 채점됨
};
