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

  // 1) 페이지 안에 적힌 .do 주소 (자료를 부르는 주소 후보)
  try {
    const html = await (await fetch(`${BASE}/main/mainPage/gamebuy/gameSlip.do`, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(15_000) })).text();
    const urls = [...new Set(html.match(/\/[A-Za-z0-9_/]+\.do/g) ?? [])].filter(u => /game|buy|Psbl|inq|Inq/i.test(u)).slice(0, 25);
    out.push(`[페이지 속 주소] ${urls.join("  ")}`);
  } catch (e) { out.push(`[페이지] 실패 ${(e as Error).message}`); }

  // 2) 지금 살 수 있는 게임 목록
  const list = await post("/buyPsblGame/inqCacheBuyAbleGameInfoList.do", { _sbmInfo: { debugMode: "false" } });
  out.push(`[게임 목록] 응답 ${list.status} · ${list.bytes}자 · 키 ${keysOf(list.json).join(",")}${list.head ? ` · ${list.head}` : ""}`);
  const text = JSON.stringify(list.json ?? "");
  const proto = [...text.matchAll(/\{[^{}]*"G101"[^{}]*\}/g)].map(m => m[0]).slice(0, 3);
  out.push(`[프로토 승부식 항목] ${proto.length ? proto.join("\n") : clip(list.json, 500)}`);

  // 3) 회차 번호를 찾으면 그 회차 경기·배당
  const gmTs = proto.map(p => p.match(/"gmTs"\s*:\s*"?(\d+)/)?.[1]).find(Boolean);
  if (gmTs) {
    const info = await post("/buyPsblGame/gameInfoInq.do", { gmId: "G101", gmTs: Number(gmTs), gameYear: "", _sbmInfo: { debugMode: "false" } });
    const j = info.json as Record<string, unknown> | null;
    const sch = j?.compSchedules as { keys?: string[]; datas?: unknown[][] } | undefined;
    out.push(`[회차 ${gmTs}] 응답 ${info.status} · ${info.bytes}자 · 키 ${keysOf(j).join(",")}${info.head ? ` · ${info.head}` : ""}`);
    if (sch?.keys) out.push(`[경기표 칸] ${sch.keys.join(",")}\n[경기 수] ${sch.datas?.length ?? 0}\n[첫 줄] ${clip(sch.datas?.[0], 500)}\n[둘째 줄] ${clip(sch.datas?.[1], 500)}`);
    else out.push(`[내용 앞부분] ${clip(j, 800)}`);
  } else out.push("[회차] 프로토 승부식 회차 번호를 못 찾았어요");

  return new Response(out.join("\n\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
