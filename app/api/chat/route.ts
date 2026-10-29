// POST /api/chat {date, games, messages} → SSE: 답변 글자를 차례로
import { z } from "zod";
import { chat } from "@/lib/chat";
import { claudeReady, ClaudeError } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 120;

const trio = z.array(z.number()).length(3).nullable();
const Body = z.object({
  date: z.string().max(20),
  games: z.array(z.object({ id: z.string().max(200), league: z.string().max(40), time: z.string().max(20), home: z.string().max(80), away: z.string().max(80), over: trio, proto: trio, probs: trio })).max(80),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).min(1).max(20),
});

export async function POST(req: Request) {
  if (!claudeReady()) return Response.json({ error: "질문 기능은 Anthropic 키를 넣은 뒤에 쓸 수 있어요." }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") return Response.json({ error: "질문 내용이 맞지 않아요." }, { status: 400 });
  const { date, games, messages } = parsed.data;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const send = (o: object) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      try { await chat(date, games, messages, text => send({ type: "text", text })); send({ type: "done" }); }
      catch (e) { send({ type: "error", message: e instanceof ClaudeError ? e.message : "답변 중 문제가 생겼어요." }); }
      finally { c.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
}
