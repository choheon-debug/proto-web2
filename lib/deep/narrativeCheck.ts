// lib/narrativeCheck.ts — 서술 문장 속 숫자가 engine_result·facts에 실제로 있는 값인지 대조.
// docs/spec.md 7절, CLAUDE.md 절대 규칙 2: "서술 결과는 저장 전에 문장 속 숫자를 모두 뽑아 engine_result와
// facts에 있는 값인지 대조한다. 없는 숫자가 하나라도 있으면 거부한다."

// 텍스트에서 숫자 토큰을 뽑는다. 12.34, 1,234, -3.16%, 1.847 같은 형태를 잡는다.
export function extractNumberTokens(text: string): string[] {
  return text.match(/-?\d[\d,]*\.?\d*%?/g) ?? [];
}

export function toCandidateValues(token: string): number[] {
  const isPercent = token.endsWith('%');
  const cleaned = token.replace(/,/g, '').replace(/%$/, '');
  const num = parseFloat(cleaned);
  if (Number.isNaN(num)) return [];
  // 퍼센트 표기는 0~1 소수로도 저장될 수 있어 두 형태 모두 후보로 둔다(예: "70%" ↔ 0.70).
  return isPercent ? [num, num / 100] : [num];
}

export interface NumberCheckResult { ok: boolean; unmatched: string[] }

export function checkNarrativeNumbers(text: string, allowed: number[], tolerance = 0.005): NumberCheckResult {
  const allowedFinite = allowed.filter(n => Number.isFinite(n));
  const tokens = extractNumberTokens(text);
  const unmatched: string[] = [];

  for (const token of tokens) {
    const candidates = toCandidateValues(token);
    if (candidates.length === 0) continue;
    const matched = candidates.some(c =>
      allowedFinite.some(a => Math.abs(a - c) <= tolerance || (a !== 0 && Math.abs(a - c) / Math.abs(a) <= tolerance)),
    );
    if (!matched) unmatched.push(token);
  }
  return { ok: unmatched.length === 0, unmatched };
}

// engine_result·facts 객체를 재귀로 훑어 숫자 값을 전부 모은다. 문자열은 "그 자체가 숫자"인 경우뿐 아니라
// layer2 근거 문장처럼 숫자가 섞인 자유 텍스트(예: "GK 1명 결장 → ×1.04")도 안에서 숫자를 뽑아 모은다 —
// 그래야 narrateReport()가 이 근거를 그대로 인용해도 "없는 숫자"로 오탐하지 않는다.
export function collectAllowedNumbers(...objects: unknown[]): number[] {
  const nums: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number') { nums.push(v); return; }
    if (typeof v === 'string' && v.trim() !== '') {
      if (!Number.isNaN(Number(v))) { nums.push(Number(v)); return; }
      for (const token of extractNumberTokens(v)) nums.push(...toCandidateValues(token));
      return;
    }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { Object.values(v).forEach(walk); }
  };
  objects.forEach(walk);
  return nums;
}
