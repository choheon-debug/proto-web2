// POST /api/analyze {match} → SSE: 진행 상태 → 결과(시장 확률 + AI 보정 + 핵심 정보)
import { z } from "zod";
import { aiAnalyze, claudeReady, ClaudeError, type AiResult } from "@/lib/claude";
import { fairProbs } from "@/lib/odds";
import type { Match, Trio } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MatchSchema = z.object({
  id: z.string().max(200), league: z.string().max(80), kickoff: z.string().max(40),
  home: z.string().max(80), away: z.string().max(80),
  odds: z.array(z.number().min(1.01).max(1000)).length(3).nullable(), books: z.number(),
});
const cache = new Map<string, { at: number; ai: AiResult }>();

const MOCK_AI: AiResult = {
  adjust: [0, 0, 0], summary: "예시 분석이에요. 실제 분석은 Anthropic 키를 넣으면 나와요.",
  info: ["예시) 원정팀 주전 수비수 부상 결장 (구단 발표)", "예시) 홈팀 최근 홈 6경기 무패", "예시) 원정팀은 3일 전 유럽 대회 원정"],
  form: { home: "WWDWL", away: "WLDWD" }, sources: [],
};

export async function POST(req: Request) {
  const parsed = MatchSchema.safeParse((await req.json().catch(() => null))?.match);
  if (!parsed.success) return Response.json({ error: "경기 정보가 맞지 않아요." }, { status: 400 });
  const m = parsed.data as Match;
  const market = m.odds ? fairProbs(m.odds as Trio) : null;
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const send = (o: object) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      const ping = setInterval(() => c.enqueue(enc.encode(": ping\n\n")), 15_000);
      try {
        let ai: AiResult;
        const hit = cache.get(m.id);
        if (!claudeReady()) ai = MOCK_AI;
        else if (!refresh && hit && Date.now() - hit.at < 30 * 60_000) ai = hit.ai;
        else {
          send({ type: "status", message: "경기 정보 확인 중…" });
          ai = await aiAnalyze(m, market, message => send({ type: "status", message }));
          cache.set(m.id, { at: Date.now(), ai });
        }
        send({ type: "result", market, ai, mock: !claudeReady(), at: new Date().toISOString() });
      } catch (e) {
        send({ type: "error", message: e instanceof ClaudeError ? e.message : "분석 중 문제가 생겼어요." });
      } finally { clearInterval(ping); c.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
}
