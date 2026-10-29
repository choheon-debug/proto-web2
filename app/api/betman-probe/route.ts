// GET /api/betman-probe → 베트맨이 배당 자료를 어디서 가져오는지 살펴보는 시험 (자동 읽기 만들기 전 조사용)
export const runtime = "nodejs";
export const preferredRegion = "icn1";

const BASE = "https://www.betman.co.kr";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function post(path: string, body: unknown) {
  try {
    const res = await fetch(BASE + path, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": UA, "Content-Type": "application/json; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Referer: `${BASE}/main/mainPage/gamebuy/gameSlip.do` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, bytes: text.length, json, head: json ? "" : text.slice(0, 200) };
  } catch (e) { return { status: 0, bytes: 0, json: null, head: (e as Error).message }; }
}

const keysOf = (o: unknown) => (o && typeof o === "object" ? Object.keys(o).slice(0, 20) : []);
const clip = (o: unknown, n = 600) => JSON.stringify(o)?.slice(0, n) ?? "";

export async function GET() {
  const out: string[] = [`서버 위치: ${process.env.VERCEL_REGION ?? "?"}`];

  // 1) 지금 살 수 있는 게임 목록 → 프로토 승부식(G101) 회차
  const list = await post("/buyPsblGame/inqCacheBuyAbleGameInfoList.do", { _sbmInfo: { debugMode: "false" } });
  const games = ((list.json as { protoGames?: { gmId: string; gmTs: number; saleEndDate?: number }[] } | null)?.protoGames ?? []).filter(g => g.gmId === "G101");
  out.push(`[게임 목록] 응답 ${list.status} · 프로토 승부식 회차 ${games.map(g => `${g.gmTs}(마감 ${g.saleEndDate ? new Date(g.saleEndDate).toISOString().slice(5, 16) : "?"})`).join(", ") || "없음"}`);

  // 2) 회차 경기·배당 — 주소 후보를 차례로 시험
  const gmTs = games[0]?.gmTs;
  if (gmTs) {
    const tries: [string, unknown][] = [
      ["/buyPsblGame/gameInfoInq.do", { gmId: "G101", gmTs, gameYear: "", _sbmInfo: { debugMode: "false" } }],
      ["/buyPsblGame/gameInfoInq.do", { gmId: "G101", gmTs: String(gmTs), _sbmInfo: { debugMode: "false" } }],
      ["/buyPsblGame/inqCacheGameInfo.do", { gmId: "G101", gmTs, _sbmInfo: { debugMode: "false" } }],
    ];
    for (const [path, body] of tries) {
      const info = await post(path, body);
      const j = info.json as Record<string, unknown> | null;
      out.push(`[${path} ${clip(body, 60)}] 응답 ${info.status} · ${info.bytes}자 · 키 ${keysOf(j).join(",")}${info.head ? ` · ${info.head}` : ""}`);
      const sch = j?.compSchedules as { keys?: string[]; datas?: unknown[][] } | undefined;
      if (sch?.keys) {
        const rows = sch.datas ?? [];
        const soccer = rows.filter(r => JSON.stringify(r).includes("SC")).length;
        out.push(`[경기표 칸] ${sch.keys.join(",")}\n[경기 수] ${rows.length} (SC 포함 ${soccer})\n[첫 줄] ${clip(rows[0], 700)}\n[둘째 줄] ${clip(rows[1], 700)}`);
        break;
      }
      if (info.bytes > 100) out.push(`[내용 앞부분] ${clip(j ?? info.head, 900)}`);
    }
  }

  return new Response(out.join("\n\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
