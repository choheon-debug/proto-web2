// 베트맨(betman.co.kr) 프로토 승부식 배당 자동 읽기.
// 베트맨은 해외 접속을 막아서, 이 파일을 쓰는 API는 서울 서버(icn1)에서 돌아야 한다 (vercel.json regions).
// 1) 판매 중인 게임 목록에서 프로토 승부식(G101) 회차를 찾고 2) 회차마다 경기표를 받아 축구 일반 승무패 줄만 고른다.
import { gameDate } from "./time";
import type { Extra, Trio } from "./types";

const BASE = "https://www.betman.co.kr";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export class BetmanError extends Error {}

export type BetmanRow = { key: string; round: number; kickoff: string; league: string; home: string; away: string; odds: Trio | null; extra: Extra[] };

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": UA, "Content-Type": "application/json; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Referer: `${BASE}/main/mainPage/gamebuy/gameSlip.do` },
      body: JSON.stringify({ ...(body as object), _sbmInfo: { debugMode: "false" } }),
    });
  } catch {
    throw new BetmanError("베트맨에 접속하지 못했어요. 잠시 뒤 다시 해 주세요.");
  }
  if (!res.ok) throw new BetmanError(`베트맨 응답이 이상해요 (${res.status}).`);
  try { return (await res.json()) as T; } catch { throw new BetmanError("베트맨 자료 형식이 바뀐 것 같아요. 직접 입력이나 사진으로 넣어 주세요."); }
}

type Schedules = { keys?: string[]; datas?: unknown[][] };

/** 회차 경기표에서 축구 줄만 골라 경기별로 묶는다: 일반 승무패 + 핸디캡(승·무·패) + 언더오버 */
export function parseSchedules(round: number, sch: Schedules): BetmanRow[] {
  const keys = sch.keys ?? [];
  const at = (name: string) => keys.indexOf(name);
  const need = ["itemCode", "gameDate", "leagueName", "homeName", "awayName", "winAllot", "drawAllot", "loseAllot", "handi", "betTypNm", "matchSeq"];
  if (need.some(n => at(n) < 0)) throw new BetmanError("베트맨 자료 형식이 바뀐 것 같아요. 직접 입력이나 사진으로 넣어 주세요.");
  const byMatch = new Map<string, BetmanRow>();
  const ok = (o: number) => o >= 1.01 && o < 100;   // 발매 전·취소 경기는 배당이 0
  for (const r of sch.datas ?? []) {
    const v = (n: string) => (at(n) >= 0 ? r[at(n)] : undefined);
    if (v("itemCode") !== "SC") continue;
    const kickoff = new Date(Number(v("gameDate"))).toISOString(), home = String(v("homeName") ?? ""), away = String(v("awayName") ?? "");
    const mk = `${kickoff}|${home}|${away}`;
    const row = byMatch.get(mk) ?? { key: `${round}-${v("matchSeq")}`, round, kickoff, league: String(v("leagueName") ?? ""), home, away, odds: null, extra: [] };
    const type = String(v("betTypNm") ?? ""), w = Number(v("winAllot")), d = Number(v("drawAllot")), l = Number(v("loseAllot"));
    if (type === "승무패" && Number(v("handi")) === 0) {
      if (ok(w) && ok(d) && ok(l)) row.odds = [w, d, l];
    } else if (type.includes("핸디")) {
      const line = Number(v("winHandi"));   // 홈팀에 더하는 핸디 (예: -1)
      if (Number.isInteger(line) && line !== 0 && ok(w) && ok(d) && ok(l)) row.extra.push({ kind: "handi", line, odds: [w, d, l] });
    } else if (/언더|오버/.test(type)) {
      // 기준점은 x.5인 값, 언더/오버 칸은 글자로 구분 (U·언더 / O·오버)
      const line = ["handi", "winHandi", "drawHandi", "loseHandi"].map(n => Math.abs(Number(v(n)))).find(x => x % 1 === 0.5);
      const wt = String(v("winTxt") ?? ""), lt = String(v("loseTxt") ?? "");
      const isU = (t: string) => /U|언더/i.test(t), isO = (t: string) => /O|오버/i.test(t);
      const pair = isU(wt) && isO(lt) ? [w, l] : isO(wt) && isU(lt) ? [l, w] : null;
      if (line && pair && pair.every(ok)) row.extra.push({ kind: "uo", line, odds: pair as [number, number] });
    } else continue;
    byMatch.set(mk, row);
  }
  return [...byMatch.values()].filter(r => r.odds || r.extra.length);
}

let cache: { at: number; rows: BetmanRow[] } | null = null;

/** 판매 중인 모든 프로토 승부식 회차의 축구 승무패 배당 (10분 캐시) */
export async function betmanRows(): Promise<BetmanRow[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.rows;
  const list = await post<{ protoGames?: { gmId: string; gmTs: number }[] }>("/buyPsblGame/inqCacheBuyAbleGameInfoList.do", {});
  const rounds = [...new Set((list.protoGames ?? []).filter(g => g.gmId === "G101").map(g => g.gmTs))];
  const lists = await Promise.all(rounds.map(async gmTs =>
    parseSchedules(gmTs, (await post<{ compSchedules?: Schedules }>("/buyPsblGame/gameInfoInq.do", { gmId: "G101", gmTs, gameYear: "" })).compSchedules ?? {})));
  // 같은 경기가 두 회차에 있으면 나중 회차 배당을 쓴다
  const byMatch = new Map<string, BetmanRow>();
  for (const r of lists.flat().sort((a, b) => a.round - b.round)) byMatch.set(`${r.kickoff}|${r.home}|${r.away}`, r);
  const rows = [...byMatch.values()];
  cache = { at: Date.now(), rows };
  return rows;
}

export const rowsForDay = (rows: BetmanRow[], date: string) => rows.filter(r => gameDate(r.kickoff) === date);
