// lib/deep/apiFootball.ts — proto-webapp 분석 엔진에서 가져옴. API-Football(v3) 연동. docs/spec.md 11절, F1(날짜별 경기 조회).
// CLAUDE.md 절대 규칙 6: API 키는 서버 환경 변수에만 둔다(이 파일은 서버 전용 — 'use client' 없음, 브라우저에 번들되지 않음).
// CLAUDE.md 절대 규칙 3: 확인 안 된 값은 null + "확인되지 않음". 리그 ID를 추측해 하드코딩하지 않고
// 매번 /leagues?search= 로 실제 조회해 확인한다(결과는 과정 중 메모리 캐시만 함 — 재시작하면 다시 확인).

const DIRECT_BASE = 'https://v3.football.api-sports.io';
const RAPIDAPI_BASE = 'https://api-football-v1.p.rapidapi.com/v3';

function authConfig(): { base: string; headers: Record<string, string> } | null {
  const directKey = process.env.API_FOOTBALL_KEY?.trim();   // proto-web2: 붙여 넣을 때 섞인 공백·줄바꿈 제거
  if (directKey) return { base: DIRECT_BASE, headers: { 'x-apisports-key': directKey } };
  const rapidKey = process.env.RAPIDAPI_KEY;
  if (rapidKey) {
    return {
      base: RAPIDAPI_BASE,
      headers: { 'x-rapidapi-key': rapidKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' },
    };
  }
  return null;
}

export function isConfigured(): boolean {
  return authConfig() !== null;
}

// proto-web2: 같은 요청은 서버 메모리에 잠시 저장해 하루 호출 수를 아낀다 (선발 명단은 짧게)
const cache = new Map<string, { at: number; data: ApiFootballResponse }>();
const cacheMs = (path: string) => (path.includes('lineups') ? 5 * 60_000 : 3 * 3600_000);

interface ApiFootballResponse {
  response: any; // 엔드포인트마다 배열(목록)이거나 객체(예: /teams/statistics)라 any로 둔다. 호출 측이 형태를 안다.
  errors: unknown;
  results: number;
}

// 다른 파이프라인 모듈(src/pipeline/collector.ts)도 같은 인증 로직을 쓰도록 공개한다.
export async function authedFetch(path: string, params: Record<string, string | number>): Promise<ApiFootballResponse> {
  const cfg = authConfig();
  if (!cfg) throw new Error('API_FOOTBALL_KEY(또는 RAPIDAPI_KEY)가 설정되지 않았습니다.');
  // 키에 영문·숫자가 아닌 글자(예: 가려진 키를 복사한 "••••")가 있으면 요청 자체가 실패하므로 알아듣게 알려 준다
  if (Object.values(cfg.headers).some(v => /[^\x21-\x7e]/.test(v)))
    throw new Error('API_FOOTBALL_KEY 값에 점(•) 같은 이상한 글자가 있어요. API-Football 대시보드에서 키를 "보이게" 한 뒤 다시 복사해 Vercel에 넣어 주세요.');
  const url = new URL(cfg.base + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  // 원본(proto-webapp)엔 Next.js 전용 캐시 힌트(next: { revalidate: 0 })가 있었는데, Next.js 밖에서는
  // 타입 에러만 나고 의미가 없어 뺐다. 호출 앱이 Next.js라면 필요시 다시 추가해도 된다.
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < cacheMs(path)) return hit.data;
  const res = await fetch(url, { headers: cfg.headers, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`API-Football 요청 실패: ${res.status} ${res.statusText} (${path})`);
  const data = await res.json();
  // API-Football은 HTTP 200에도 요금제 제한 등을 data.errors로 돌려준다(예: "Free plans do not have
  // access to this season"). 조용히 빈 배열을 돌려주면 "경기 없음"과 "플랜 제한"을 구분할 수 없어 여기서 막는다.
  const errs = data.errors;
  const hasErrors = errs && (Array.isArray(errs) ? errs.length > 0 : Object.keys(errs).length > 0);
  if (hasErrors) throw new Error(`API-Football 오류(${path}): ${JSON.stringify(errs)}`);
  cache.set(key, { at: Date.now(), data });
  return data;
}

export interface LeagueMatch {
  id: number;
  name: string;
  country: string;
  type: string;
  logo?: string;
}

// 리그 ID는 하드코딩하지 않는다 — 검색 결과를 그대로 반환해 호출 측이 정확히 일치하는 항목을 고르게 한다.
export async function searchLeagues(name: string): Promise<LeagueMatch[]> {
  const data = await authedFetch('/leagues', { search: name });
  return data.response.map((r: any) => ({
    id: r.league.id, name: r.league.name, country: r.country?.name ?? '확인되지 않음', type: r.league.type,
    logo: r.league.logo,
  }));
}

const leagueIdCache = new Map<string, number>();

// 이름+국가로 정확히 하나만 매칭되면 그 ID를 쓰고, 애매하면 에러로 실패시켜(추정 금지) 호출 측이 설정을 고치게 한다.
export async function resolveLeagueId(name: string, country: string): Promise<number> {
  const cacheKey = `${name}|${country}`;
  const cached = leagueIdCache.get(cacheKey);
  if (cached != null) return cached;
  const matches = await searchLeagues(name);
  const exact = matches.filter(m => m.name === name && m.country === country);
  if (exact.length === 1) {
    leagueIdCache.set(cacheKey, exact[0].id);
    return exact[0].id;
  }
  throw new Error(
    `리그 ID를 확정할 수 없습니다: "${name}"(${country}) 검색 결과 ${matches.length}건 ` +
    `(${matches.map(m => `${m.name}/${m.country}#${m.id}`).join(', ') || '없음'}). ` +
    `lib/leagues.ts의 이름·국가 표기를 API-Football 응답과 맞춰 수정하세요.`,
  );
}

export interface Fixture {
  providerId: number;
  league: string;
  leagueId: number;
  home: string;
  away: string;
  homeTeamId: number;
  awayTeamId: number;
  kickoffUtc: string;
  venue: string | null;
  venueCity: string | null;
  status: string; // API-Football short status: NS(예정), FT(종료) 등
  scoreHome: number | null;
  scoreAway: number | null;
}

export async function fetchFixturesByDate(date: string, leagueId: number, season: number): Promise<Fixture[]> {
  const data = await authedFetch('/fixtures', { date, league: leagueId, season });
  return data.response.map((r: any) => ({
    providerId: r.fixture.id,
    league: r.league.name,
    leagueId: r.league.id,
    home: r.teams.home.name,
    away: r.teams.away.name,
    homeTeamId: r.teams.home.id,
    awayTeamId: r.teams.away.id,
    kickoffUtc: r.fixture.date,
    venue: r.fixture.venue?.name ?? null,
    venueCity: r.fixture.venue?.city ?? null,
    status: r.fixture.status.short,
    scoreHome: r.goals.home,
    scoreAway: r.goals.away,
  }));
}
