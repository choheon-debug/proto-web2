// 팀 이름 비교 (영어 이름끼리, 표기가 조금 달라도: "Man Utd" ↔ "Manchester United")
const STOP = new Set(["fc", "cf", "afc", "sc", "ac", "club", "de", "the", "calcio", "1"]);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\butd\b/g, "united").replace(/\bman\b/g, "manchester").replace(/[^a-z0-9 ]/g, " ")
  .split(/\s+/).filter(w => w && !STOP.has(w));
/** 0~1: 같은 단어 비율 (한쪽 이름이 다른 쪽에 들어 있으면 1) */
export function nameScore(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if (!x.length || !y.length) return 0;
  if (x.join(" ").includes(y.join(" ")) || y.join(" ").includes(x.join(" "))) return 1;
  const sx = new Set(x), hit = y.filter(w => sx.has(w) || [...sx].some(v => v.length >= 4 && (v.startsWith(w) || w.startsWith(v)))).length;
  return hit / Math.max(x.length, y.length);
}
