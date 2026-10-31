// Claude: ① 경기 분석(웹 검색으로 부상·일정 확인 → 확률 소폭 보정) ② 배당표 사진 읽기
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { leagueName } from "./leagues";
import { gameDate, kstTime } from "./time";
import type { Match, Trio } from "./types";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
export const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);
export class ClaudeError extends Error {}
let client: Anthropic | null = null;
export const anthropic = () => (client ??= new Anthropic());
export const claudeReady = () => !!process.env.ANTHROPIC_API_KEY;

/* ---------- ① 경기 분석 ---------- */
const MAX_ADJ = 4;   // 결과마다 최대 ±4%p만 보정
export const AiSchema = z.object({
  adjust: z.array(z.number()).length(3),
  summary: z.string(),
  info: z.array(z.string()).max(6),
  form: z.object({ home: z.string(), away: z.string() }),
  sources: z.array(z.object({ title: z.string(), url: z.string() })).max(10),
});
export type AiResult = z.infer<typeof AiSchema>;

const SYSTEM = `당신은 축구 데이터 분석가다. 웹 검색으로 확인한 **최신 정보만** 쓴다. 한국어로, 쉬운 말로 쓴다.
해외 배당에서 구한 시장 확률이 주어진다. 시장 확률은 매우 정확하므로, 시장이 아직 반영하지 못했을 만한 **새 정보**(확정된 부상·결장, 주전 휴식 예고, 감독 교체, 비정상적 일정)가 있을 때만 확률을 조금 고친다.
- adjust: [홈승, 무, 원정승] 보정값(%p). 각각 -${MAX_ADJ}~+${MAX_ADJ}. 합은 0에 가깝게. 새 정보가 없으면 [0,0,0].
- summary: 결론 1~2문장 (왜 보정했는지, 또는 왜 안 했는지).
- info: 핵심 정보 3~5줄. 각 줄 50자 이내. 출처 없는 추측 금지.
- form: 각 팀 최근 5경기 결과를 W(승)/D(무)/L(패) 5글자로, 왼쪽이 가장 최근. 확인 못 하면 빈 문자열.
- sources: 참고한 기사 (제목, URL).
- "확실", "필승" 같은 표현, 베팅 권유 금지.
반드시 아래 JSON 하나만 \`\`\`json 코드 블록으로 출력한다.
{"adjust":[0,0,0],"summary":"","info":[],"form":{"home":"","away":""},"sources":[]}`;

export async function aiAnalyze(m: Match, market: Trio | null, onStatus: (s: string) => void): Promise<AiResult> {
  const user = [
    `경기: ${m.home}(홈) vs ${m.away}(원정)`,
    `리그: ${leagueName(m.league)} · 경기일 ${gameDate(m.kickoff)} · 킥오프 ${kstTime(m.kickoff)} KST`,
    market ? `시장 확률(해외 배당 기준): 홈승 ${(market[0] * 100).toFixed(1)}% · 무 ${(market[1] * 100).toFixed(1)}% · 원정승 ${(market[2] * 100).toFixed(1)}%` : "시장 확률: 없음 (해외 배당을 못 구함)",
    `오늘: ${new Date().toISOString()}`,
  ].join("\n");
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: user }];
  let searches = 0, toolType: "web_search_20260209" | "web_search_20250305" = "web_search_20260209";
  for (let round = 0; round < 4; round++) {
    let msg: Anthropic.Beta.BetaMessage;
    try {
      const stream = anthropic().beta.messages.stream({
        model: MODEL, max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages, tools: [{ type: toolType, name: "web_search", max_uses: 6 }],
        ...(FALLBACK_MODELS.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      stream.on("streamEvent", e => {
        if (e.type === "content_block_start" && e.content_block.type === "server_tool_use") onStatus(`부상·소식 검색 중… (${++searches}회)`);
      });
      msg = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && toolType === "web_search_20260209" && /web_search/.test(err.message)) { toolType = "web_search_20250305"; round--; continue; }
      throw toKorean(err);
    }
    if (msg.stop_reason === "refusal") throw new ClaudeError("이 경기는 분석할 수 없다는 응답을 받았어요.");
    if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
    const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map(b => b.text).join("");
    onStatus("정리 중…");
    return clampAdjust(await parseOrRepair(text));
  }
  throw new ClaudeError("검색이 너무 길어져 멈췄어요. 잠시 뒤 다시 해 주세요.");
}

function clampAdjust(r: AiResult): AiResult {
  const a = r.adjust.map(x => Math.max(-MAX_ADJ, Math.min(MAX_ADJ, Number.isFinite(x) ? x : 0)));
  const mean = (a[0] + a[1] + a[2]) / 3;   // 합이 0이 되게 맞춘다
  return { ...r, adjust: a.map(x => +(x - mean).toFixed(1)), form: { home: cleanForm(r.form.home), away: cleanForm(r.form.away) } };
}
const cleanForm = (s: string) => s.toUpperCase().replace(/[^WDL]/g, "").slice(0, 5);

async function parseOrRepair(text: string): Promise<AiResult> {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return AiSchema.parse(JSON.parse(block)); } catch {}
  try {   // 형식이 어긋나면 검색 없이 구조화 출력으로 한 번 다시 정리
    const res = await anthropic().messages.parse({
      model: MODEL, max_tokens: 8000,
      messages: [{ role: "user", content: `아래 분석을 스키마에 맞는 JSON으로 다시 정리해 주세요. 내용을 지어내지 마세요.\n\n${text}` }],
      output_config: { format: zodOutputFormat(AiSchema) },
    });
    return AiSchema.parse(res.parsed_output);
  } catch (err) {
    if (err instanceof Anthropic.APIError) throw toKorean(err);
    throw new ClaudeError("분석 결과 형식이 맞지 않아요. 다시 해 주세요.");
  }
}

/* ---------- ② 배당표 사진 읽기 ---------- */
const PhotoSchema = z.object({ rows: z.array(z.object({ id: z.string(), odds: z.array(z.number()).length(3) })) });

/** 프로토 배당표 사진에서 그날 경기들의 승·무·패 배당을 찾아 경기 id에 맞춘다 */
export async function readOddsPhoto(image: { type: string; data: string }, matches: Match[]) {
  const list = matches.map(m => `${m.id} | ${m.home}(홈) vs ${m.away}(원정) | ${leagueName(m.league)} ${kstTime(m.kickoff)}`).join("\n");
  try {
    const res = await anthropic().messages.parse({
      model: MODEL, max_tokens: 8000,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: image.type as "image/jpeg", data: image.data } },
        { type: "text", text: `이 사진은 프로토(베트맨) 배당표입니다. 아래 경기 목록과 같은 경기를 찾아 일반 승부식 승·무·패(홈 기준) 배당을 적어 주세요.
팀 이름은 한국어로 적혀 있을 수 있으니 영어 이름과 맞춰 주세요. 핸디캡·언더오버 줄은 빼고, 확실히 같은 경기만 넣으세요. 못 찾은 경기는 빼세요.

경기 목록 (id | 경기 | 리그 시간):
${list}` },
      ] }],
      output_config: { format: zodOutputFormat(PhotoSchema) },
    });
    const ids = new Set(matches.map(m => m.id));
    return (res.parsed_output?.rows ?? []).filter(r => ids.has(r.id) && r.odds.every(o => o >= 1.01 && o < 100)) as { id: string; odds: Trio }[];
  } catch (err) {
    throw toKorean(err);
  }
}

/* ---------- ③ 베트맨 경기 ↔ 해외 배당 경기 짝 맞추기 ---------- */
const PairSchema = z.object({ pairs: z.array(z.object({ b: z.string(), id: z.string() })) });
const NEAR = 20 * 60_000;   // 시작 시각 차이 20분 이내만 같은 경기 후보
const pairCache = new Map<string, Record<string, string>>();

/** 한국어 팀 이름(베트맨)과 영어 팀 이름(해외 배당)을 시작 시각 + 이름으로 짝 맞춘다. 결과: 베트맨 key → 경기 id */
export async function pairMatches(rows: { key: string; kickoff: string; league: string; home: string; away: string }[], matches: Match[]): Promise<Record<string, string>> {
  const near = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= NEAR;
  const cand = rows.filter(r => matches.some(m => near(r.kickoff, m.kickoff)));
  if (!cand.length) return {};
  const ck = cand.map(r => r.key).join(",") + "|" + matches.map(m => m.id).join(",");
  const hit = pairCache.get(ck);
  if (hit) return hit;
  const res = await anthropic().messages.parse({
    model: MODEL, max_tokens: 4000,
    messages: [{ role: "user", content: `프로토(베트맨) 경기 목록(한국어 팀 이름)과 해외 배당 경기 목록(영어 팀 이름)에서 **같은 경기**를 짝지어 주세요.
홈·원정이 같고 시작 시각이 거의 같아야 합니다. 확실한 것만 넣고, 애매하거나 상대가 없는 경기는 빼세요.

[프로토] key | 시작(KST) | 리그 | 홈 vs 원정
${cand.map(r => `${r.key} | ${kstTime(r.kickoff)} | ${r.league} | ${r.home} vs ${r.away}`).join("\n")}

[해외] id | 시작(KST) | 리그 | 홈 vs 원정
${matches.map(m => `${m.id} | ${kstTime(m.kickoff)} | ${leagueName(m.league)} | ${m.home} vs ${m.away}`).join("\n")}

b에는 프로토 key, id에는 해외 id를 적으세요.` }],
    output_config: { format: zodOutputFormat(PairSchema) },
  }).catch(err => { throw toKorean(err); });
  const byKey = new Map(cand.map(r => [r.key, r])), byId = new Map(matches.map(m => [m.id, m]));
  const out: Record<string, string> = {}, used = new Set<string>();
  for (const p of res.parsed_output?.pairs ?? []) {
    const r = byKey.get(p.b), m = byId.get(p.id);
    if (!r || !m || used.has(m.id) || out[r.key] || !near(r.kickoff, m.kickoff)) continue;   // 시각이 다르면 버린다
    out[r.key] = m.id; used.add(m.id);
  }
  pairCache.set(ck, out);
  return out;
}

export function toKorean(err: unknown): Error {
  if (err instanceof ClaudeError) return err;
  console.error(err);
  if (err instanceof Anthropic.APIError && /usage limits/i.test(String(err.message))) {
    const d = String(err.message).match(/regain access on (\d{4}-\d{2}-\d{2})/)?.[1];
    return new ClaudeError(`Anthropic 월 사용 한도에 닿았어요.${d ? ` ${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일에 다시 쓸 수 있어요.` : ""} 바로 쓰려면 Anthropic Console → Limits에서 한도를 올려 주세요.`);
  }
  if (err instanceof Anthropic.AuthenticationError) return new ClaudeError("Anthropic API 키가 맞지 않아요. Vercel의 ANTHROPIC_API_KEY를 확인해 주세요.");
  if (err instanceof Anthropic.PermissionDeniedError) return new ClaudeError("이 API 키로는 웹 검색을 쓸 수 없어요. Console 설정에서 웹 검색을 켜 주세요.");
  if (err instanceof Anthropic.RateLimitError) return new ClaudeError("요청이 많아 잠시 막혔어요. 1분 뒤 다시 해 주세요.");
  if (err instanceof Anthropic.BadRequestError && /credit|balance/i.test(err.message)) return new ClaudeError("Anthropic 크레딧이 부족해요. Console에서 충전해 주세요.");
  if (err instanceof Anthropic.APIError) return new ClaudeError("AI 서버에 문제가 있어요. 잠시 뒤 다시 해 주세요.");
  return new ClaudeError("분석 중 문제가 생겼어요. 잠시 뒤 다시 해 주세요.");
}
