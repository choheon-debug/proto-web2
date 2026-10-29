// POST /api/grade {bets:[{id, match:{id, league, kickoff, pick}}]} → 끝난 경기만 적중/실패와 점수
import { LEAGUES } from "@/lib/leagues";
import { leagueScores, OddsApiError } from "@/lib/oddsApi";

type Req = { id: string; match: { id: string; league: string; kickoff: string; pick: number; kind?: "1x2" | "handi" | "uo"; line?: number } };

/** 점수로 선택한 칸이 맞았나: 승무패·핸디캡은 (점수차 + 핸디)로 승0/무1/패2, 언더오버는 합계 < 기준점이면 언더0 */
function outcome(m: Req["match"], h: number, a: number) {
  if (m.kind === "uo") return h + a < (m.line ?? 2.5) ? 0 : 1;
  const d = h - a + (m.kind === "handi" ? m.line ?? 0 : 0);
  return d > 0 ? 0 : d === 0 ? 1 : 2;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const bets = (Array.isArray(body?.bets) ? body.bets : []).slice(0, 200) as Req[];
  const known = new Set(LEAGUES.map(l => l.key));
  const leagues = [...new Set(bets.map(b => b.match?.league).filter(l => known.has(l)))];
  try {
    const lists = await Promise.all(leagues.map(leagueScores));
    const byId = new Map(lists.flat().map(s => [s.id, s]));
    const results = bets.flatMap(b => {
      const s = byId.get(b.match?.id);
      if (!s?.completed || !s.scores) return [];
      const h = Number(s.scores.find(x => x.name === s.home_team)?.score), a = Number(s.scores.find(x => x.name === s.away_team)?.score);
      if (!Number.isFinite(h) || !Number.isFinite(a)) return [];
      return [{ id: b.id, result: outcome(b.match, h, a) === b.match.pick ? "win" : "lose", score: `${h} : ${a}` }];
    });
    return Response.json({ results });
  } catch (e) {
    return Response.json({ error: e instanceof OddsApiError ? e.message : "경기 결과를 가져오지 못했어요." }, { status: 502 });
  }
}
