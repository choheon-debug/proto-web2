// The Odds API의 축구 리그 키와 한국어 이름
export const LEAGUES: { key: string; name: string }[] = [
  { key: "soccer_epl", name: "EPL" },
  { key: "soccer_spain_la_liga", name: "라리가" },
  { key: "soccer_germany_bundesliga", name: "분데스리가" },
  { key: "soccer_italy_serie_a", name: "세리에A" },
  { key: "soccer_france_ligue_one", name: "리그1" },
  { key: "soccer_korea_kleague1", name: "K리그1" },
  { key: "soccer_japan_j_league", name: "J리그" },
  { key: "soccer_uefa_champs_league", name: "챔피언스리그" },
  { key: "soccer_uefa_europa_league", name: "유로파리그" },
  { key: "soccer_efl_champ", name: "챔피언십" },
];
export const leagueName = (key: string) => LEAGUES.find(l => l.key === key)?.name ?? key;
