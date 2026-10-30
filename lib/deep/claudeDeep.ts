// 정밀 분석의 AI 부분 (proto-webapp 분석 엔진의 lib/claude.ts를 이 앱의 SDK 방식으로 옮김).
// AI는 사실 수집(출처 URL 필수)과 문장 설명만 한다. 확률·판정 숫자는 엔진 코드가 계산한다.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, ClaudeError, FALLBACK_MODELS, MODEL, toKorean } from "../claude";
import { FactsSchema, type MatchFactsBundle } from "./facts";
import { checkNarrativeNumbers, collectAllowedNumbers } from "./narrativeCheck";

export type FactsInput = { home: string; away: string; kickoffKst: string; league: string };

const absencePrompt = (i: FactsInput) => `너는 축구 경기 데이터 조사원이다. 확률·예측·추천을 만들지 않는다. 결과를 자유 텍스트로 정리해라.
다음 경기(${i.home} vs ${i.away}, ${i.kickoffKst} KST, ${i.league})의 "결장·출전 의문 선수"만 집중 조사해라.
홈팀·원정팀 각각: 이름, 포지션(영어: Goalkeeper/Centre-Back/Forward/Winger 등), 결장 사유, 구단 공식 발표 여부,
이번 시즌 팀 득점(골+어시스트)에서 이 선수가 차지하는 비중(0~1, 실제 확인 가능할 때만).
- 모든 값에 실제로 연 페이지의 URL을 붙여라. 검색 스니펫만 본 값은 쓰지 않는다.
- 확인 못한 건 "확인 안 됨"이라고 적어라(추정하지 않는다).
- 다른 시즌·다른 경기 수치를 섞지 않는다. 페이지의 시즌 표기를 확인한다.`;

const contextPrompt = (i: FactsInput) => `너는 축구 경기 데이터 조사원이다. 확률·예측·추천을 만들지 않는다. 결과를 자유 텍스트로 정리해라.
다음 경기(${i.home} vs ${i.away}, ${i.kickoffKst} KST, ${i.league})에 대해 아래만 조사해라:
1. 공식 또는 예상 라인업(확정 여부 표기)
2. 주심 배정과 시즌 경기당 카드·페널티 수, 그 주심 경기의 홈팀 승률
3. 각 팀 감독 부임일, 여름 이적 주전 이탈 수, 더비·우승/강등 경쟁·컵 결승 여부
- 모든 값에 실제로 연 페이지의 URL을 붙여라. 검색 스니펫만 본 값은 쓰지 않는다.
- 확인 못한 건 "확인 안 됨"이라고 적어라(추정하지 않는다).
- 배당·xG·순위는 조사하지 않는다(데이터 API가 담당).`;

/** 웹 검색으로 조사해 자유 텍스트를 받는다 (검색 도구 버전 대체, pause_turn 이어 받기) */
async function searchText(system: string, user: string, maxUses: number, onSearch: () => void): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: user }];
  let toolType: "web_search_20260209" | "web_search_20250305" = "web_search_20260209";
  for (let round = 0; round < 4; round++) {
    let msg: Anthropic.Beta.BetaMessage;
    try {
      const stream = anthropic().beta.messages.stream({
        model: MODEL, max_tokens: 6000, system, messages,
        tools: [{ type: toolType, name: "web_search", max_uses: maxUses, blocked_domains: ["bet365.com"] }],
        ...(FALLBACK_MODELS.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      stream.on("streamEvent", e => { if (e.type === "content_block_start" && e.content_block.type === "server_tool_use") onSearch(); });
      msg = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && toolType === "web_search_20260209" && /web_search/.test(err.message)) { toolType = "web_search_20250305"; round--; continue; }
      throw toKorean(err);
    }
    if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
    return msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map(b => b.text).join("\n");
  }
  throw new ClaudeError("검색이 너무 길어져 멈췄어요. 잠시 뒤 다시 해 주세요.");
}

export const searchAbsence = (i: FactsInput, onSearch: () => void) =>
  searchText(absencePrompt(i), `${i.home} vs ${i.away} 결장자를 조사해줘.`, 8, onSearch);
export const searchContext = (i: FactsInput, onSearch: () => void) =>
  searchText(contextPrompt(i), `${i.home} vs ${i.away} 경기 맥락(라인업·주심·감독)을 조사해줘.`, 6, onSearch);

/** 두 조사 결과에서 정해진 형식만 뽑는다 (검색 없음) */
export async function extractFacts(absence: string, context: string): Promise<MatchFactsBundle> {
  try {
    const res = await anthropic().messages.parse({
      model: MODEL, max_tokens: 6000,
      system: "아래 두 조사 결과(결장자 조사, 경기 맥락 조사)에서 지정된 형식에 맞는 값만 뽑아낸다. 조사 결과에 없는 값은 null로 둔다. 새 사실을 만들지 않는다. homeWinRate와 teamGoalContributionShare는 0~1 소수로 적는다. managerAppointedOn은 YYYY-MM-DD.",
      messages: [{ role: "user", content: `[결장자 조사]\n${absence}\n\n[경기 맥락 조사]\n${context}` }],
      output_config: { format: zodOutputFormat(FactsSchema) },
    });
    if (!res.parsed_output) throw new ClaudeError("조사 결과를 정리하지 못했어요. 다시 해 주세요.");
    return { ...res.parsed_output, collectedAt: new Date().toISOString(), modelId: MODEL };
  } catch (err) { throw toKorean(err); }
}

/** 계산된 숫자만 써서 쉬운 말로 2~3문장. 없는 숫자가 들어가면 한 번 다시, 그래도 안 되면 생략(null) */
export async function narrate(engine: unknown, facts: unknown): Promise<string | null> {
  const allowed = collectAllowedNumbers(engine, facts);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await anthropic().messages.parse({
        model: MODEL, max_tokens: 1500,
        system: `너는 축구 경기 분석 결과를 쉬운 한국어로 설명한다. 입력 JSON에 있는 숫자만 인용한다. 새 숫자·새 확률·추천을 만들지 않는다.
2~3문장으로, 누가 빠졌는지·휴식·예상 득점이 왜 그렇게 나왔는지를 설명한다. 어려운 용어(λ, Edge, xG, RS, 1X2, BTTS, Layer, 포아송)는 쓰지 않는다.
"확실", "필승" 같은 표현과 구매 권유는 하지 않는다. 숫자를 쓰면 입력에 있는 값과 정확히 같게 쓴다(반올림 금지).`,
        messages: [{ role: "user", content: JSON.stringify({ engine, facts }) }],
        output_config: { format: zodOutputFormat(z.object({ summary: z.string() })) },
      });
      const text = res.parsed_output?.summary?.trim();
      if (text && checkNarrativeNumbers(text, allowed).ok) return text;
    } catch { return null; }
  }
  return null;
}
