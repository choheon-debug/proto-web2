// GET /api/af-test?d=2026-10-31 → API-Football 일정·배당이 오는지, 해외 배당 경기와 짝이 맞는지 시험 (글자로)
import { authedFetch, isConfigured } from "@/lib/deep/apiFootball";
import { AF } from "@/lib/deep/leagues";
import { afFixtures, pairFixture } from "@/lib/afData";
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
  for (const l of ["soccer_epl", ...new Set(ms.map(m => m.league))].filter((x, i, a) => a.indexOf(x) === i && AF[x]).slice(0, 4)) {
    const lg = AF[l], season = lg.season(new Date(fromMs));
    const fx = await afFixtures(l, fromMs, toMs).catch(e => { out.push(`[${l}] 일정 실패: ${(e as Error).message}`); return []; });
    out.push(`[${l}] 시즌 ${season} · API-Football 일정 ${fx.length}경기 ${fx.slice(0, 2).map(f => `${f.home} vs ${f.away}(${f.kickoff.slice(5, 16)})`).join(", ")}`);
    const mine = ms.filter(m => m.league === l);
    out.push(`  짝 맞춤 ${mine.filter(m => pairFixture(m, fx)).length}/${mine.length}${mine[0] ? ` · 예: ${mine[0].home} vs ${mine[0].away}(${mine[0].kickoff.slice(5, 16)}) → ${pairFixture(mine[0], fx)?.id ?? "못 찾음"}` : ""}`);
    for (const date of [...new Set([from.slice(0, 10), to.slice(0, 10)])]) {
      const r = await authedFetch("/odds", { league: lg.id, season, date }).then(x => {
        const a = x as unknown as { results: number; paging?: unknown; response: { fixture: { id: number }; bookmakers: { name?: string; bets: { name: string }[] }[] }[] };
        const f = a.response?.[0];
        return `결과 ${a.results} · 쪽 ${JSON.stringify(a.paging)} · 첫 경기 ${f?.fixture.id ?? "-"} 배팅사 ${f?.bookmakers.length ?? 0} · 종류 ${f?.bookmakers[0]?.bets.slice(0, 6).map(b => b.name).join("/") ?? "-"}`;
      }).catch(e => `실패: ${(e as Error).message}`);
      out.push(`  배당 ${date}: ${r}`);
    }
  }
  return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
