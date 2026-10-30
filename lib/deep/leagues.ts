// 정밀 분석 지원 리그: The Odds API 리그 키 → API-Football 리그 (id, 엔진 등급표 이름, 시즌 계산). 화면에서도 쓰므로 서버 코드를 넣지 않는다.
/** The Odds API 리그 → API-Football 리그 (id, 엔진 등급표 이름, 시즌 계산) */
const FALL = (d: Date) => (d.getUTCMonth() + 1 >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);
const YEAR = (d: Date) => d.getUTCFullYear();
export const AF: Record<string, { id: number; name: string; season: (d: Date) => number; cup?: boolean }> = {
  soccer_epl: { id: 39, name: "Premier League", season: FALL },
  soccer_spain_la_liga: { id: 140, name: "La Liga", season: FALL },
  soccer_germany_bundesliga: { id: 78, name: "Bundesliga", season: FALL },
  soccer_italy_serie_a: { id: 135, name: "Serie A", season: FALL },
  soccer_france_ligue_one: { id: 61, name: "Ligue 1", season: FALL },
  soccer_efl_champ: { id: 40, name: "Championship", season: FALL },
  soccer_korea_kleague1: { id: 292, name: "K League 1", season: YEAR },
  soccer_japan_j_league: { id: 98, name: "J1 League", season: YEAR },
  soccer_uefa_champs_league: { id: 2, name: "UEFA Champions League", season: FALL, cup: true },
  soccer_uefa_europa_league: { id: 3, name: "UEFA Europa League", season: FALL, cup: true },
};
export const deepSupported = (league: string) => league in AF;
