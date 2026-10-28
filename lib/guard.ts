// 지킴이: 하루 베팅 한도, 한 달 손실 한도, 잃은 뒤 금액을 키우는 "복구 베팅" 감지
import type { Bet } from "./types";

export const profit = (b: Bet) => (b.result === "win" ? b.stake * (b.odds - 1) : b.result === "lose" ? -b.stake : 0);

export function monthStats(bets: Bet[], month: string) {
  const list = bets.filter(b => b.date.startsWith(month));
  const settled = list.filter(b => b.result === "win" || b.result === "lose");
  const staked = list.filter(b => b.result !== "void").reduce((a, b) => a + b.stake, 0);
  const returned = settled.filter(b => b.result === "win").reduce((a, b) => a + b.stake * b.odds, 0);
  const net = settled.reduce((a, b) => a + profit(b), 0);
  return { list, settled, staked, returned, net, loss: Math.max(0, -net) };
}

export type Check = { block: string | null; warn: string | null };

/** 새 베팅을 넣어도 되는지 */
export function checkBet(bets: Bet[], limits: { daily: number; monthlyLoss: number }, stake: number, date: string): Check {
  const month = date.slice(0, 7), s = monthStats(bets, month);
  if (limits.monthlyLoss > 0 && s.loss >= limits.monthlyLoss)
    return { block: `이번 달 손실이 한도(${limits.monthlyLoss.toLocaleString()}원)에 닿았어요. 이번 달은 여기서 멈춰요.`, warn: null };
  const today = bets.filter(b => b.date === date && b.result !== "void").reduce((a, b) => a + b.stake, 0);
  if (limits.daily > 0 && today + stake > limits.daily)
    return { block: `오늘 베팅 한도(${limits.daily.toLocaleString()}원)를 넘어요. 오늘 이미 ${today.toLocaleString()}원을 걸었어요.`, warn: null };
  let warn: string | null = null;
  // 최근 확정된 2건이 연속 실패이고, 이번 금액이 직전보다 크면 복구 베팅 경고
  const recent = bets.filter(b => b.result === "win" || b.result === "lose").slice(0, 2);
  if (recent.length === 2 && recent.every(b => b.result === "lose") && stake > recent[0].stake)
    warn = "연속으로 잃은 뒤 금액을 키우고 있어요. 잃은 돈을 되찾으려는 베팅은 손실을 더 키우기 쉬워요.";
  else if (limits.monthlyLoss > 0 && s.loss >= limits.monthlyLoss * 0.8)
    warn = `이번 달 손실이 한도의 80%를 넘었어요 (${s.loss.toLocaleString()} / ${limits.monthlyLoss.toLocaleString()}원).`;
  return { block: null, warn };
}
