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
  totals?: Totals | null;  // 해외 언더오버 (가장 많은 배팅사가 낸 기준점)
  model?: { lh: number; la: number } | null;
  afId?: number;           // API-Football 경기 번호 (배당·결과·정밀 분석용)   // 예상 득점 (해외 배당에 맞춘 값) — 핸디캡·언더오버 확률 추정용
};

export type Totals = { line: number; under: number; over: number };

/** 프로토 핸디캡(승·무·패, 홈 기준 핸디) · 언더오버(언더·오버) 배당 */
export type Extra =
  | { kind: "handi"; line: number; odds: Trio }
  | { kind: "handi2"; line: number; odds: [number, number] }   // 소수핸디캡 (예: +3.5) 승·패
  | { kind: "uo"; line: number; odds: [number, number] };

/** 채점에 쓰는 선택: 승무패(0승 1무 2패) · 핸디캡(0승 1무 2패) · 언더오버(0언더 1오버) */
export type Pick = { kind?: "1x2" | "handi" | "handi2" | "uo"; line?: number; pick: number };   // 소수핸디캡은 0승 1패

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
  match?: { id: string; league: string; kickoff: string; afId?: number; home?: string; away?: string } & Pick;
  score?: string;          // "2 : 1" (자동 채점 때 적음)
  auto?: boolean;          // 자동으로 채점됨
};

/** 🟢 판정 검증표: 앱이 덜 불리하다고 한 선택을 경기 시작 전 마지막 값으로 적어 두고, 끝나면 채점 */
export type Track = {
  key: string;             // 경기id:종류:기준점:선택
  date: string;            // 경기일 (KST)
  label: string;           // "Arsenal vs Chelsea · 핸디 -1 승"
  odds: number;            // 프로토 배당
  ev: number;              // 그때 계산한 평균 수익률
  est: boolean;            // 예상 득점 모델로 추정한 확률이었는지
  match: { id: string; league: string; kickoff: string; afId?: number; home?: string; away?: string } & Pick;
  result: "pending" | "win" | "lose";
  score?: string;
  src?: "deep";            // 정밀 분석 판정 (없으면 빠른 판정)
};
