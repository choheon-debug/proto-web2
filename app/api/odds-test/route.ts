// GET /api/odds-test?d=2026-10-31 → 리그별 경기 수와 응답 상태 (연결 확인용, 크레딧 안 씀)
import { leagueCheck, oddsMock } from "@/lib/oddsApi";
import { kstDayRange } from "@/lib/time";

export async function GET(req: Request) {
  const d = new URL(req.url).searchParams.get("d") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return Response.json({ error: "날짜 형식이 맞지 않아요." }, { status: 400 });
  if (oddsMock()) return Response.json({ error: "ODDS_API_KEY가 없어요." });
  return Response.json({ date: d, range: kstDayRange(d), leagues: await leagueCheck(d) });
}
