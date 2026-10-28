// GET /api/day?d=2026-10-31 → 그날 경기와 해외 배당
import { dayMatches, oddsMock, OddsApiError, quota } from "@/lib/oddsApi";

export async function GET(req: Request) {
  const d = new URL(req.url).searchParams.get("d") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return Response.json({ error: "날짜 형식이 맞지 않아요." }, { status: 400 });
  try {
    return Response.json({ matches: await dayMatches(d), mock: oddsMock(), quota });
  } catch (e) {
    return Response.json({ error: e instanceof OddsApiError ? e.message : "경기와 배당을 가져오지 못했어요." }, { status: 502 });
  }
}
