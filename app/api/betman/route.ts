// POST /api/betman {date, matches} → 베트맨 프로토 승부식 배당을 그날 경기에 맞춰 돌려준다
import { betmanRows, BetmanError, rowsForDay } from "@/lib/betman";
import { claudeReady, ClaudeError, pairMatches } from "@/lib/claude";
import type { Match } from "@/lib/types";

export const runtime = "nodejs";
export const preferredRegion = "icn1";   // 베트맨은 해외 접속을 막는다
export const maxDuration = 90;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const date = body?.date as string | undefined, matches = body?.matches as Match[] | undefined;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(matches)) return Response.json({ error: "날짜나 경기 목록이 비어 있어요." }, { status: 400 });
  try {
    const rows = rowsForDay(await betmanRows(), date);
    if (!rows.length || !matches.length) return Response.json({ rows: [], betman: rows.length });
    if (!claudeReady()) return Response.json({ error: "팀 이름 맞추기에 Anthropic 키가 필요해요." }, { status: 400 });
    const pairs = await pairMatches(rows, matches.slice(0, 80));
    const out = rows.filter(r => pairs[r.key]).map(r => ({ id: pairs[r.key], odds: r.odds, extra: r.extra }));
    return Response.json({ rows: out, betman: rows.length });
  } catch (e) {
    const msg = e instanceof BetmanError || e instanceof ClaudeError ? e.message : "베트맨 배당을 가져오지 못했어요.";
    return Response.json({ error: msg }, { status: 502 });
  }
}
