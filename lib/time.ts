// 한국 시간(KST) 기준 날짜 계산
const KST = 9 * 3600_000;
export const kstDate = (iso: string | number | Date) => new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10);
export const kstTime = (iso: string) => new Date(new Date(iso).getTime() + KST).toISOString().slice(11, 16);
export const todayKst = () => kstDate(Date.now());
/* 경기일: 한국 시간 새벽 6시 전에 시작하는 경기는 전날 경기로 본다
   (예: 영국 토요일 오후 3시 = 한국 일요일 0시 → "토요일 밤 경기") */
const SHIFT = 6 * 3600_000;
export const gameDate = (iso: string) => kstDate(new Date(iso).getTime() - SHIFT);
/** 새벽(0~6시) 경기인지 */
export const isLateNight = (iso: string) => kstDate(iso) !== gameDate(iso);
const z = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");
/** 경기일 하루(그날 06:00 ~ 다음날 05:59 KST)를 UTC ISO 범위로 */
export function kstDayRange(date: string) {
  const from = new Date(new Date(`${date}T00:00:00+09:00`).getTime() + SHIFT);
  return { from: z(from), to: z(new Date(from.getTime() + 86_400_000 - 1000)) };
}
/** 경기일 기준 한 달 범위 */
export function kstMonthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(new Date(`${month}-01T00:00:00+09:00`).getTime() + SHIFT);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const to = new Date(new Date(`${next}T00:00:00+09:00`).getTime() + SHIFT - 1000);
  return { from: z(from), to: z(to) };
}
const WD = "일월화수목금토";
export function prettyDate(date: string) {
  const d = new Date(`${date}T00:00:00+09:00`);
  const k = new Date(d.getTime() + KST);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 (${WD[k.getUTCDay()]})`;
}
