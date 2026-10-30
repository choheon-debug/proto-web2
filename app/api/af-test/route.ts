// GET /api/af-test?d=2026-10-31 → API-Football 일정·배당이 오는지, 해외 배당 경기와 짝이 맞는지 시험 (글자로)
import { authedFetch, isConfigured } from "@/lib/deep/apiFootball";
import { AF } from "@/lib/deep/leagues";
import { afFixtures, afSeason, pairFixture } from "@/lib/afData";
import { dayMatches } from "@/lib/oddsApi";
import { kstDayRange } from "@/lib/time";

export async function GET(req: Request) {
  const d = new URL(req.url).searchParams.get("d") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Response("날짜 형식이 맞지 않아요.");
  if (!isConfigured()) return new Response("API_FOOTBALL_KEY가 없어요.");
  const out: string[] = [];
  const { from, to } = kstDayRange(d), fromMs = new Date(from).getTime(), toMs = new Date(to).getTime();
  const status = await authedFetch("/status", {}).then(r => JSON.stringify(r.response).slice(0, 300)).catch(e => `실패: ${(e as Error).message}`);
  out.push(`[계정] ${status}`);
  const ms = await dayMatches(d).catch(e => { out.push(`[경기 목록] 실패: ${(e as Error).message}`); return []; });
  out.push(`[경기 목록] ${ms.length}경기 · 해외 배당 있는 경기 ${ms.filter(m => m.odds).length} · id 예: ${ms[0]?.id ?? "-"}`);
  for (const l of [...new Set(ms.map(m => m.league))].filter(x => AF[x])) {
    const fx = await afFixtures(l, fromMs, toMs).catch(e => { out.push(`[${l}] 일정 실패: ${(e as Error).message}`); return []; });
    const season = afSeason(l, fromMs), mine = ms.filter(m => m.league === l);
    const miss = mine.filter(m => !pairFixture(m, fx));
    out.push(`[${l}] 시즌 ${season} · 일정 ${fx.length} · 짝 ${mine.length - miss.length}/${mine.length} · 해외 배당 ${mine.filter(m => m.odds).length}/${mine.length}${miss[0] ? ` · 못 찾음 예: ${miss[0].home} vs ${miss[0].away}(${miss[0].kickoff.slice(5, 16)})${fx[0] ? ` / 일정 예: ${fx[0].home} vs ${fx[0].away}(${fx[0].kickoff.slice(5, 16)})` : ""}` : ""}`);
  }
  return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
