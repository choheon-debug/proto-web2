// POST /api/photo {image:{type,data}, matches} → 사진 속 프로토 배당을 그날 경기에 맞춰 돌려준다
import { claudeReady, ClaudeError, readOddsPhoto } from "@/lib/claude";
import type { Match } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!claudeReady()) return Response.json({ error: "사진 읽기는 Anthropic 키를 넣은 뒤에 쓸 수 있어요." }, { status: 400 });
  const body = await req.json().catch(() => null);
  const image = body?.image, matches = body?.matches as Match[] | undefined;
  if (!image || !/^image\/(jpeg|png|webp)$/.test(image.type) || typeof image.data !== "string" || !Array.isArray(matches) || !matches.length)
    return Response.json({ error: "사진이나 경기 목록이 비어 있어요." }, { status: 400 });
  if (image.data.length > 7_000_000) return Response.json({ error: "사진이 너무 커요." }, { status: 413 });
  try {
    return Response.json({ rows: await readOddsPhoto(image, matches.slice(0, 60)) });
  } catch (e) {
    return Response.json({ error: e instanceof ClaudeError ? e.message : "사진을 읽지 못했어요." }, { status: 500 });
  }
}
