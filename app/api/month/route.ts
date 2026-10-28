// GET /api/month?m=2026-10 → 날짜별 경기 수 (달력 점)
import { monthCounts, oddsMock, OddsApiError } from "@/lib/oddsApi";

export async function GET(req: Request) {
  const m = new URL(req.url).searchParams.get("m") ?? "";
  if (!/^\d{4}-\d{2}$/.test(m)) return Response.json({ error: "달 형식이 맞지 않아요." }, { status: 400 });
  try {
    return Response.json({ counts: await monthCounts(m), mock: oddsMock() });
  } catch (e) {
    return Response.json({ error: e instanceof OddsApiError ? e.message : "경기 일정을 가져오지 못했어요." }, { status: 502 });
  }
}
