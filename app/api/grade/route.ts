// POST /api/grade {bets:[{id, match:{id, league, kickoff, pick}}]} → 끝난 경기만 적중/실패와 점수
import { LEAGUES } from "@/lib/leagues";
import { leagueScores, OddsApiError } from "@/lib/oddsApi";

type Req = { id: string; match: { id: string; league: string; kickoff: string; pick: number } };

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const bets = (Array.isArray(body?.bets) ? body.bets : []).slice(0, 50) as Req[];
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
      const outcome = h > a ? 0 : h === a ? 1 : 2;
      return [{ id: b.id, result: outcome === b.match.pick ? "win" : "lose", score: `${h} : ${a}` }];
    });
    return Response.json({ results });
  } catch (e) {
    return Response.json({ error: e instanceof OddsApiError ? e.message : "경기 결과를 가져오지 못했어요." }, { status: 502 });
  }
}
