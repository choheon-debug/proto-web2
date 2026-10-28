// 한국 시간(KST) 기준 날짜 계산
const KST = 9 * 3600_000;
export const kstDate = (iso: string | number | Date) => new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10);
export const kstTime = (iso: string) => new Date(new Date(iso).getTime() + KST).toISOString().slice(11, 16);
export const todayKst = () => kstDate(Date.now());
/** KST 하루(00:00~24:00)를 UTC ISO 범위로 */
export function kstDayRange(date: string) {
  const from = new Date(`${date}T00:00:00+09:00`);
  return { from: from.toISOString().replace(/\.\d+Z$/, "Z"), to: new Date(from.getTime() + 86_400_000 - 1000).toISOString().replace(/\.\d+Z$/, "Z") };
}
/** KST 한 달 범위 */
export function kstMonthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(`${month}-01T00:00:00+09:00`);
  const to = new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+09:00`);
  to.setUTCMonth(to.getUTCMonth() + 1);
  return { from: from.toISOString().replace(/\.\d+Z$/, "Z"), to: new Date(to.getTime() - 1000).toISOString().replace(/\.\d+Z$/, "Z") };
}
const WD = "일월화수목금토";
export function prettyDate(date: string) {
  const d = new Date(`${date}T00:00:00+09:00`);
  const k = new Date(d.getTime() + KST);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 (${WD[k.getUTCDay()]})`;
}
