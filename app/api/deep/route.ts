// POST /api/deep {match, proto, extra} → SSE: 단계(step) → 결과(정밀 분석)
import { z } from "zod";
import { claudeReady, ClaudeError } from "@/lib/claude";
import { DeepError, deepReady, deepSupported, runDeep, type DeepResult } from "@/lib/deep/run";
import type { Extra, Match, Trio } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const odds = z.number().min(1.01).max(1000);
const Body = z.object({
  match: z.object({
    id: z.string().max(200), league: z.string().max(80), kickoff: z.string().max(40), home: z.string().max(80), away: z.string().max(80),
    odds: z.array(odds).length(3).nullable(), books: z.number(),
    totals: z.object({ line: z.number(), under: odds, over: odds }).nullable().optional(),
    model: z.object({ lh: z.number(), la: z.number() }).nullable().optional(),
  }),
  proto: z.array(odds).length(3).nullable(),
  extra: z.array(z.union([
    z.object({ kind: z.literal("handi"), line: z.number(), odds: z.array(odds).length(3) }),
    z.object({ kind: z.literal("handi2"), line: z.number(), odds: z.array(odds).length(2) }),
    z.object({ kind: z.literal("uo"), line: z.number(), odds: z.array(odds).length(2) }),
  ])).max(12),
});
const cache = new Map<string, { at: number; r: DeepResult }>();

export async function POST(req: Request) {
  if (!claudeReady()) return Response.json({ error: "정밀 분석은 Anthropic 키가 필요해요." }, { status: 400 });
  if (!deepReady()) return Response.json({ error: "정밀 분석은 API-Football 키(API_FOOTBALL_KEY)가 필요해요. Vercel 설정에 넣어 주세요." }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "경기 정보가 맞지 않아요." }, { status: 400 });
  const m = parsed.data.match as Match, proto = parsed.data.proto as Trio | null, extra = parsed.data.extra as Extra[];
  if (!deepSupported(m.league)) return Response.json({ error: "이 리그는 정밀 분석을 지원하지 않아요." }, { status: 400 });
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const ck = JSON.stringify([m.id, proto, extra]);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const send = (o: object) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      const ping = setInterval(() => c.enqueue(enc.encode(": ping\n\n")), 15_000);
      try {
        const hit = cache.get(ck);
        const r = !refresh && hit && Date.now() - hit.at < 30 * 60_000 ? hit.r : await runDeep(m, proto, extra, s => send({ type: "step", ...s }));
        cache.set(ck, { at: Date.now(), r });
        send({ type: "result", result: r });
      } catch (e) {
        console.error(e);
        send({ type: "error", message: e instanceof DeepError || e instanceof ClaudeError ? e.message : `정밀 분석 중 문제가 생겼어요. (${(e as Error).message?.slice(0, 120)})` });
      } finally { clearInterval(ping); c.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
}
