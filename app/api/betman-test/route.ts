// GET /api/betman-test → 서버에서 베트맨에 접속이 되는지 시험 (자동 읽기 가능성 확인용)
export const runtime = "nodejs";

const TARGETS = [
  "https://www.betman.co.kr/main/mainPage/gamebuy/gameSlip.do",
  "https://www.betman.co.kr/",
];

export async function GET() {
  const results = await Promise.all(TARGETS.map(async url => {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
      const text = await res.text();
      return { url, status: res.status, bytes: text.length, title: text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null,
        hasOdds: /배당|odds/i.test(text), scripts: (text.match(/<script/gi) ?? []).length };
    } catch (e) {
      return { url, error: (e as Error).message };
    }
  }));
  return Response.json({ at: new Date().toISOString(), results });
}
