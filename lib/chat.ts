// 💬 질문: 그날 경기(해외·프로토 배당, 확률)를 주고 Claude와 대화. 조합 계산은 정확하게 하도록 계산 도구(combo)를 준다.
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeError } from "./claude";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export type ChatGame = { id: string; league: string; time: string; home: string; away: string; over: number[] | null; proto: number[] | null; probs: number[] | null };
export type ChatMsg = { role: "user" | "assistant"; content: string };

const OUT = ["승", "무", "패"];

const SYSTEM = `당신은 "프로토 분석" 앱의 상담 도우미다. 사용자는 한국의 합법 스포츠토토 "프로토 승부식"(베트맨)을 산다. 한국어로, 쉬운 말로, 짧게 답한다.
아래에 사용자가 고른 날짜의 축구 경기 목록이 있다. 각 경기: 번호, 리그, 시작 시각(KST), 홈 vs 원정, 해외 배당(승/무/패), 프로토 배당(승/무/패), 확률(승/무/패, 해외 배당에서 배팅사 몫을 뺀 값 + AI 보정).
규칙:
- 조합(여러 경기 묶음) 배당·확률·평균 손익은 반드시 combo 도구로 계산하고, 직접 암산하지 않는다.
- "평균 손익"은 많이 샀을 때 1만 원당 평균이다. 조합은 경기마다의 손해가 곱해져서 보통 더 불리해진다는 점을 숫자로 보여 준다.
- 적중 확률을 꼭 함께 알려 준다 (예: 10번 중 2번쯤).
- 프로토 승부식은 보통 2경기 이상 묶어 사고(한 경기만 살 수 있는 경기는 일부), 최대 10경기, 한 번에 최대 10만 원이다. 같은 경기 두 결과를 한 조합에 넣을 수 없다.
- 프로토 배당이 없는 경기는 계산할 수 없다고 말한다.
- "확실", "필승", "무조건" 같은 표현 금지. 결과를 예측해 주지 않는다. 사라고 권하지 않는다. 불법 사설·해외 사이트 안내 금지.
- 손실을 되찾으려 하거나 큰돈을 걸려는 말이 보이면 멈추기를 권하고 ☎1336(도박문제 상담, 24시간 무료)을 알려 준다.
- 표 대신 짧은 줄 목록을 쓴다. 휴대폰 화면이라 5~10줄 안팎으로.`;

const TOOLS: Anthropic.Tool[] = [{
  name: "combo",
  description: "경기 조합의 프로토 배당 곱, 적중 확률, 1만 원당 평균 손익을 계산한다. 여러 조합을 한 번에 계산할 수 있다.",
  input_schema: {
    type: "object",
    properties: {
      combos: {
        type: "array", description: "계산할 조합들",
        items: { type: "array", items: { type: "object", properties: { game: { type: "integer", description: "경기 번호" }, pick: { type: "string", enum: OUT } }, required: ["game", "pick"] } },
      },
    },
    required: ["combos"],
  },
}];

/** 조합 계산 (도구) */
export function combo(games: ChatGame[], picks: { game: number; pick: string }[]) {
  const seen = new Set<number>();
  let odds = 1, prob = 1;
  const lines: string[] = [];
  for (const p of picks) {
    const g = games[p.game - 1], i = OUT.indexOf(p.pick);
    if (!g || i < 0) return { error: `${p.game}번 경기를 찾을 수 없어요` };
    if (seen.has(p.game)) return { error: `${p.game}번 경기가 두 번 들어갔어요` };
    seen.add(p.game);
    if (!g.proto) return { error: `${p.game}번 경기는 프로토 배당이 없어요` };
    if (!g.probs) return { error: `${p.game}번 경기는 확률이 없어요 (해외 배당 없음)` };
    odds *= g.proto[i]; prob *= g.probs[i];
    lines.push(`${p.game}번 ${g.home} vs ${g.away} ${p.pick} (프로토 ${g.proto[i]}, 확률 ${(g.probs[i] * 100).toFixed(0)}%)`);
  }
  const ev = prob * odds - 1;
  return { picks: lines, protoOdds: +odds.toFixed(2), hitChance: `${(prob * 100).toFixed(1)}%`, per10k: Math.round(ev * 10000) };
}

const gameTable = (games: ChatGame[]) => games.map((g, n) =>
  `${n + 1}. ${g.league} ${g.time} | ${g.home} vs ${g.away} | 해외 ${g.over?.join("/") ?? "없음"} | 프로토 ${g.proto?.join("/") ?? "없음"} | 확률 ${g.probs?.map(x => (x * 100).toFixed(0) + "%").join("/") ?? "없음"}`).join("\n");

export async function chat(date: string, games: ChatGame[], history: ChatMsg[], onText: (t: string) => void) {
  const messages: Anthropic.MessageParam[] = history.map(m => ({ role: m.role, content: m.content }));
  const system = `${SYSTEM}\n\n[${date} 경기 ${games.length}개]\n${gameTable(games) || "경기 없음"}`;
  for (let round = 0; round < 5; round++) {
    let msg: Anthropic.Message;
    try {
      const stream = anthropic().messages.stream({ model: MODEL, max_tokens: 4000, system, messages, tools: TOOLS });
      stream.on("text", onText);
      msg = await stream.finalMessage();
    } catch (err) {
      console.error(err);
      if (err instanceof Anthropic.RateLimitError) throw new ClaudeError("요청이 많아 잠시 막혔어요. 1분 뒤 다시 해 주세요.");
      if (err instanceof Anthropic.BadRequestError && /credit|balance/i.test(err.message)) throw new ClaudeError("Anthropic 크레딧이 부족해요.");
      throw new ClaudeError("AI 서버에 문제가 있어요. 잠시 뒤 다시 해 주세요.");
    }
    if (msg.stop_reason !== "tool_use") return;
    messages.push({ role: "assistant", content: msg.content });
    const results: Anthropic.ToolResultBlockParam[] = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use").map(b => {
      const input = b.input as { combos?: { game: number; pick: string }[][] };
      const out = (input.combos ?? []).slice(0, 20).map(c => combo(games, c));
      return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) };
    });
    messages.push({ role: "user", content: results });
    onText("\n");
  }
}
