// src/pipeline/geo.ts — 좌표·날씨. spec.md 7절: "이동 거리는 경기장 좌표로, 날씨는 날씨 API로 코드가 직접
// 계산한다. LLM에게 맡기지 않는다." API-Football의 /venues 응답에는 위경도가 없어(2026-10-24 실제 호출로
// 확인) Open-Meteo 지오코딩으로 도시명 → 좌표를 구한다. 둘 다 키 불필요.
export interface LatLon { lat: number; lon: number }

// 도시명이 같은 지명이 여러 나라에 있을 수 있어(런던 등) countryHint로 맞는 결과를 고른다.
// 확실히 맞는 결과가 없으면 null — 거리 계산을 생략하고 "확인되지 않음"으로 둔다(추정 금지).
export async function geocodeCity(city: string, countryHint?: string): Promise<{ coords: LatLon; matched: boolean } | null> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', city);
  url.searchParams.set('count', '10');
  url.searchParams.set('language', 'en');
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`geocoding 요청 실패: ${res.status}`);
  const data = await res.json();
  const results: any[] = data.results ?? [];
  if (results.length === 0) return null;
  if (!countryHint) return { coords: { lat: results[0].latitude, lon: results[0].longitude }, matched: results.length === 1 };
  const hint = countryHint.toLowerCase();
  const match = results.find(r => r.country?.toLowerCase().includes(hint) || r.admin1?.toLowerCase().includes(hint) || hint.includes(r.country?.toLowerCase() ?? '\u0000'));
  if (match) return { coords: { lat: match.latitude, lon: match.longitude }, matched: true };
  return { coords: { lat: results[0].latitude, lon: results[0].longitude }, matched: false };
}

export interface WeatherAtKickoff { precipProbability: number; windSpeedMs: number }

// forecast API는 과거 며칠~미래 16일 정도만 지원한다. 범위 밖이면 null(확인되지 않음).
export async function fetchWeatherAtKickoff(coords: LatLon, kickoffIso: string): Promise<WeatherAtKickoff | null> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(coords.lat));
  url.searchParams.set('longitude', String(coords.lon));
  url.searchParams.set('hourly', 'precipitation_probability,wind_speed_10m');
  url.searchParams.set('wind_speed_unit', 'ms');
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('past_days', '3');
  url.searchParams.set('forecast_days', '14');
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`날씨 요청 실패: ${res.status}`);
  const data = await res.json();
  const times: string[] = data.hourly?.time ?? [];
  const target = kickoffIso.slice(0, 13); // "YYYY-MM-DDTHH"
  const idx = times.findIndex(t => t.startsWith(target));
  if (idx === -1) return null;
  const precip = data.hourly.precipitation_probability[idx];
  const wind = data.hourly.wind_speed_10m[idx];
  if (precip == null || wind == null) return null;
  return { precipProbability: precip / 100, windSpeedMs: wind };
}
