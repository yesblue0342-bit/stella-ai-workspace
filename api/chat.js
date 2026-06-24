import { detectSmartIntent, getSmartContextForMessage } from "../lib/place-weather-utils.js";
import { saveJsonToDrive, readJsonFromDrive, listJsonFromDrive, buildDriveContextForChat } from "../lib/drive-utils.js";
import { buildMemoryContext, saveMemory as saveMemoryAzure } from "../lib/memory-db.mjs";
// Stella GPT 답변 라우팅(루트 / 전용, body.route 게이트). 다른 앱(ABAP/Codex)은 미전송 → 영향 없음.
import { wantsTable, buildSystemPrompt as routeSystemPrompt, extractText } from "../lib/router.mjs";
// 이미지 직접 분석(vision): API별 올바른 이미지 블록 + 비전모델 보장 (포맷 불일치 회귀 방지).
import { visionImageBlock, ensureVisionModel, parseDataUrl } from "../lib/vision-format.mjs";

// OpenAI Responses API + web_search 호출 (실시간 질문). 응답 contract(text)는 호출부에서 유지.
async function callResponses({ model, system, history, message, images = [], search = false }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const input = [];
  for (const m of (Array.isArray(history) ? history : []).slice(-12)) {
    input.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") });
  }
  const imgs = (Array.isArray(images) ? images : []).filter((u) => u && String(u).startsWith("data:"));
  if (imgs.length) {
    // Responses API 정확한 이미지 블록(input_image + 문자열 image_url). 공유 util로 포맷 일치 보장.
    const blocks = imgs.map((u) => { const { base64, mediaType } = parseDataUrl(u); return visionImageBlock({ api: "responses", base64, mediaType }); });
    input.push({ role: "user", content: [{ type: "input_text", text: String(message || "") }, ...blocks] });
  } else {
    input.push({ role: "user", content: String(message || "") });
  }
  // 이미지가 있으면 비전 가능 모델 보장(텍스트전용이면 gpt-4o로 교체).
  const visModel = ensureVisionModel(model, imgs.length > 0, "openai");
  const bodyObj = { model: visModel, instructions: system, input };
  // ★ 직접 비전 우선: 이미지가 있으면 web_search 툴을 붙이지 않는다(툴 흐름으로 빠져 거부/빈응답 → OCR 폴백되는 문제 차단).
  if (search && !imgs.length) bodyObj.tools = [{ type: "web_search" }];
  const ctrl = new AbortController();
  // web_search는 응답이 길어질 수 있음 → 함수 maxDuration(300s, Fluid Compute) 직전까지 여유(290s).
  const timer = setTimeout(() => ctrl.abort(), 290000);
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(bodyObj),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return extractText(await r.json());
  } finally { clearTimeout(timer); }
}

// 이미지 base64 전송을 위해 body 크기 제한 상향
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb"
    }
  },
  maxDuration: 300
};

// ───────── 시스템 프롬프트 ─────────
const STELLA_SYSTEM_PROMPT = `You are Stella GPT, KH's personal AI workspace assistant. Reply in Korean.

[RESPONSE FORMAT - MANDATORY, NO EXCEPTIONS]
EVERY response MUST follow this exact structure:
1. One-line summary (결론 한 줄)
2. Markdown table if there are 2+ items (반드시 표)
3. Max 2 lines of additional notes if needed

FORBIDDEN in default mode:
- Numbered lists with 5+ items
- Multiple ## headings
- Long paragraphs
- Saying "I cannot access" - just do it or give the link

ALLOWED only when user says "자세히", "설명해줘", "왜", "상세히":
- Detailed prose explanation

[EXECUTION RULES]
- "해줘/수정해줘/정리해줘" → execute immediately, show result only
- GitHub: server auto-calls /api/github-read and /api/github-update
- Weather: call API directly, never say "cannot provide"
- No off-topic answers

[MAP LINKS]
- 국내: [카카오맵](https://map.kakao.com/link/search/장소명)
- 해외: [Google Maps](https://maps.google.com/?q=장소명)

[REPO] yesblue0342-bit/stella-ai-workspace | main file: index.html
[KH] SAP QM/PP consultant, Celltrion BISON project, novelist/poet/rapper/martial artist`;

// ───────── GitHub 의도 감지 ─────────
function detectGitHubIntent(message) {
  const m = message.toLowerCase();
  // auth 폴더 정리
  if ((m.includes("auth") && (m.includes("정리") || m.includes("폴더") || m.includes("중복"))) ||
      m.includes("auth-cleanup") || m.includes("auth cleanup")) {
    return { type: "auth_cleanup" };
  }
  // 파일 읽기
  const readMatch = message.match(/(?:읽어|불러|확인해|조회해|보여줘)[^\n]*?([a-zA-Z0-9_\-\/]+\.[a-zA-Z]{2,6})/);
  if (readMatch) return { type: "read", path: readMatch[1] };
  // 파일 수정/커밋
  const updateMatch = message.match(/(?:수정|고쳐|변경|커밋|배포)[^\n]*?([a-zA-Z0-9_\-\/]+\.[a-zA-Z]{2,6})/);
  if (updateMatch) return { type: "update_intent", path: updateMatch[1] };
  // GitHub 상태 확인
  if (m.includes("github") && (m.includes("확인") || m.includes("연결") || m.includes("상태"))) {
    return { type: "github_status" };
  }
  return null;
}

// ───────── GitHub API 호출 ─────────
async function callGitHubRead(path) {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://stella-ai-workspace.vercel.app";
  const r = await fetch(`${base}/api/github-read?path=${encodeURIComponent(path)}`);
  return r.json();
}

async function callGitHubUpdate(path, content, commitMsg) {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://stella-ai-workspace.vercel.app";
  const r = await fetch(`${base}/api/github-update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, message: commitMsg })
  });
  return r.json();
}

async function callAuthCleanup() {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://stella-ai-workspace.vercel.app";
  const r = await fetch(`${base}/api/auth-cleanup`, { method: "POST" });
  return r.json();
}

// ───────── 날씨 직접 처리 (Open-Meteo - 무료, 한국 완벽 지원) ─────────
const KR_CITIES = {
  "송도":{lat:37.3823,lng:126.6569},"인천":{lat:37.4563,lng:126.7052},
  "서울":{lat:37.5665,lng:126.9780},"강남":{lat:37.5172,lng:127.0473},
  "성남":{lat:37.4200,lng:127.1265},"판교":{lat:37.3947,lng:127.1112},
  "수원":{lat:37.2636,lng:127.0286},"부산":{lat:35.1796,lng:129.0756},
  "대전":{lat:36.3504,lng:127.3845},"대구":{lat:35.8714,lng:128.6014},
  "광주":{lat:35.1595,lng:126.8526},"울산":{lat:35.5384,lng:129.3114},
  "제주":{lat:33.4890,lng:126.4983},"익산":{lat:35.9483,lng:126.9576},
  "전주":{lat:35.8242,lng:127.1480},"청주":{lat:36.6424,lng:127.4890},
  "천안":{lat:36.8151,lng:127.1139},"포항":{lat:36.0190,lng:129.3435},
  "창원":{lat:35.2280,lng:128.6811},"고양":{lat:37.6584,lng:126.8320},
  "용인":{lat:37.2411,lng:127.1776},"평택":{lat:36.9921,lng:127.1128},
  "분당":{lat:37.3595,lng:127.1051},"일산":{lat:37.6761,lng:126.7769},
  "의정부":{lat:37.7382,lng:127.0337},"연수구":{lat:37.4108,lng:126.6780},
};

function wmoToKr(code) {
  const map = {
    0:"맑음",1:"대체로 맑음",2:"부분적으로 흐림",3:"흐림",
    45:"안개",48:"안개(서리)",
    51:"가벼운 이슬비",53:"이슬비",55:"짙은 이슬비",
    61:"가벼운 비",63:"비",65:"폭우",
    71:"가벼운 눈",73:"눈",75:"폭설",77:"싸라기눈",
    80:"소나기(약)",81:"소나기",82:"폭우 소나기",
    95:"뇌우",96:"우박 뇌우",99:"폭우 뇌우"
  };
  return map[code] || "정보없음";
}

// 날씨 자연어 요약 생성
function buildWeatherSummary(w) {
  const parts = [];
  // 기온 표현
  const t = Number(w.temp);
  let tempPhrase = "";
  if (t >= 30) tempPhrase = "매우 더운 날씨";
  else if (t >= 25) tempPhrase = "더운 편";
  else if (t >= 20) tempPhrase = "따뜻한 날씨";
  else if (t >= 15) tempPhrase = "선선한 날씨";
  else if (t >= 10) tempPhrase = "쌀쌀한 날씨";
  else if (t >= 5) tempPhrase = "추운 편";
  else if (t >= 0) tempPhrase = "추운 날씨";
  else tempPhrase = "매우 추운 날씨";

  const feelGap = Math.abs(Number(w.feels) - t);
  const feelNote = feelGap >= 3 ? `(체감은 ${Number(w.feels)>t?'더 높음':'더 낮음'})` : "";

  parts.push(`현재 ${w.desc} 상태로 ${tempPhrase}입니다${feelNote?' '+feelNote:''}.`);

  // 우산
  if (Number(w.precip) >= 50) parts.push("☔ **우산을 꼭 챙기세요.**");
  else if (Number(w.precip) >= 30) parts.push("☔ 우산을 챙기는 것을 권장합니다.");

  // 바람
  if (Number(w.wind) >= 10) parts.push("🌬 바람이 강하니 주의하세요.");

  // UV
  if (Number(w.uv) >= 8) parts.push("☀️ 자외선이 매우 강합니다. 선크림과 모자를 챙기세요.");
  else if (Number(w.uv) >= 6) parts.push("☀️ 자외선이 강한 편입니다.");

  // 습도
  if (Number(w.humid) >= 80) parts.push("💧 습도가 높아 무더울 수 있습니다.");
  else if (Number(w.humid) <= 30) parts.push("🏜 공기가 건조하니 수분 섭취에 유의하세요.");

  return `> ${parts.join(' ')}`;
}

async function handleWeather(message) {
  // 위치명 추출
  const locMatch = message.match(/([가-힣]{2,10}(?:시|구|군|동|읍|면|도)?)/);
  const locationName = locMatch ? locMatch[1] : "송도";
  const isDomestic = /[가-힣]/.test(locationName);

  // 1) 좌표 확보
  let lat = null, lng = null, resolvedName = locationName;
  for (const [city, coord] of Object.entries(KR_CITIES)) {
    if (locationName.includes(city) || city.includes(locationName)) {
      lat = coord.lat; lng = coord.lng; resolvedName = city;
      break;
    }
  }

  // 2) Google Places 지오코딩 폴백
  if (!lat || !lng) {
    const key = process.env.GOOGLE_WEATHER_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      try {
        const geoRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "places.displayName,places.location"
          },
          body: JSON.stringify({ textQuery: locationName, languageCode: "ko" })
        });
        const geoData = await geoRes.json();
        const place = geoData.places?.[0];
        if (place?.location) {
          lat = place.location.latitude;
          lng = place.location.longitude;
          resolvedName = place.displayName?.text || locationName;
        }
      } catch {}
    }
  }

  // 위치 못 찾으면 폴백
  if (!lat || !lng) {
    return `**${locationName}** 위치를 찾을 수 없습니다.

[네이버 날씨](https://search.naver.com/search.naver?query=${encodeURIComponent(locationName+" 날씨")}) | [Google 날씨](https://www.google.com/search?q=${encodeURIComponent(locationName+" 날씨")})`;
  }

  // 3) Open-Meteo API 호출
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max");
    url.searchParams.set("timezone", "Asia/Seoul");
    url.searchParams.set("forecast_days", "1");

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error("status " + r.status);
    const w = await r.json();
    const cur = w.current || {};
    const daily = w.daily || {};

    // 날씨 코드 → 한국어
    const wmo = {0:"맑음",1:"대체로 맑음",2:"부분적으로 흐림",3:"흐림",45:"안개",48:"서리 안개",51:"가벼운 이슬비",53:"이슬비",55:"강한 이슬비",61:"약한 비",63:"비",65:"강한 비",71:"약한 눈",73:"눈",75:"강한 눈",80:"약한 소나기",81:"소나기",82:"강한 소나기",95:"천둥번개",96:"천둥번개+우박"};
    const desc = wmo[cur.weather_code] || "정보 없음";
    const isDay = cur.is_day === 1;

    const temp = cur.temperature_2m?.toFixed(1) ?? "-";
    const feels = cur.apparent_temperature?.toFixed(1) ?? "-";
    const humid = cur.relative_humidity_2m ?? "-";
    const windSpeed = cur.wind_speed_10m?.toFixed(1) ?? "-";
    const tempMax = daily.temperature_2m_max?.[0]?.toFixed(1) ?? "-";
    const tempMin = daily.temperature_2m_min?.[0]?.toFixed(1) ?? "-";
    const precip = daily.precipitation_probability_max?.[0] ?? 0;
    const uv = daily.uv_index_max?.[0]?.toFixed(1) ?? "-";

    const umbrella = precip >= 60 ? "🌂 우산 필수" : precip >= 30 ? "☔ 우산 챙기면 좋음" : "☀️ 우산 불필요";
    const uvDesc = Number(uv) >= 8 ? "매우 높음" : Number(uv) >= 6 ? "높음" : Number(uv) >= 3 ? "보통" : "낮음";
    const humidDesc = Number(humid) > 70 ? "높음" : Number(humid) < 40 ? "건조" : "보통";
    const windDesc = Number(windSpeed) > 10 ? "강풍 주의" : Number(windSpeed) > 5 ? "바람 있음" : "약함";

    const mapLink = isDomestic
      ? `[네이버 날씨](https://search.naver.com/search.naver?query=${encodeURIComponent(resolvedName+" 날씨")})`
      : `[Google 날씨](https://www.google.com/search?q=${encodeURIComponent(resolvedName+" weather")})`;

    return [
      `**${resolvedName} 현재 날씨** — ${isDay?"☀️":"🌙"} ${desc}`,
      ``,
      buildWeatherSummary({resolvedName,desc,temp,feels,humid,wind:windSpeed,precip,uv,umbrella,windDesc,uvDesc,humidDesc}),
      ``,
      `| 항목 | 값 | 비고 |`,
      `|---|---|---|`,
      `| 🌡 기온 | ${temp}°C | 체감 ${feels}°C |`,
      `| 📊 최고/최저 | ${tempMax}°C / ${tempMin}°C | 오늘 |`,
      `| 💧 습도 | ${humid}% | ${humidDesc} |`,
      `| 🌬 바람 | ${windSpeed}m/s | ${windDesc} |`,
      `| 🌧 강수확률 | ${precip}% | ${umbrella} |`,
      `| ☀️ UV 지수 | ${uv} | ${uvDesc} |`,
      ``,
      `${mapLink}`
    ].join("\n");
  } catch(e) {
    return `**${resolvedName} 날씨** API 일시 오류\n\n[네이버 날씨](https://search.naver.com/search.naver?query=${encodeURIComponent(resolvedName+" 날씨")})`;
  }
}

// ───────── 메인 핸들러 ─────────
// ── G1 성능: 메모리 프롬프트 워밍 캐시 + 구간 타이밍 ──
// warm 서버리스 인스턴스 내 반복 요청에서 Azure SQL/Drive 메모리 fetch를 제거(가장 큰 반복 병목).
const _memCache = new Map(); // userId -> { prompt, ts }
const MEM_TTL_MS = 60000;
function invalidateMemoryCache(userId) { _memCache.delete(userId); }
async function getMemoryPrompt(userId, needsFullMemory) {
  const e = _memCache.get(userId);
  if (e && (Date.now() - e.ts) < MEM_TTL_MS) return { prompt: e.prompt, cached: true };
  let memoryPrompt = await buildMemoryContext(userId);        // Azure SQL 우선
  if (!memoryPrompt) {                                         // 빈값이면 Drive 폴백
    const memory = await loadMemory(userId, needsFullMemory);
    memoryPrompt = memoryToPrompt(memory);
  }
  _memCache.set(userId, { prompt: memoryPrompt || "", ts: Date.now() });
  return { prompt: memoryPrompt || "", cached: false };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = req.body || {};
    const message = String(body.message || "");
    let aiMessage = message;
    let actualDriveContext = null;
    const history = Array.isArray(body.history) ? body.history : [];
    const model = body.model || "gpt-4.1-mini";
    const system = body.system || STELLA_SYSTEM_PROMPT;
    const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
    const userId = String(body.userId || body.user_id || "").trim() || "anonymous";

    // STEP E: 용량 가드 — 이미지 base64 합산이 너무 크면(본문/비전 토큰 한도 초과) 직접 비전 전에 한국어 안내.
    //   프론트가 이미 1568px/JPEG로 다운스케일하므로 정상 첨부는 통과. 신규 청크 업로드는 만들지 않는다.
    const imgBytes = images.reduce((a, u) => a + (typeof u === "string" ? u.length : 0), 0);
    if (imgBytes > 18 * 1024 * 1024) {
      return res.status(200).json({ ok: true, provider: "vision-guard",
        text: "첨부 이미지 용량이 너무 큽니다(합산 ~18MB 초과). 캡쳐를 더 작게(텍스트 위주로 잘라서) 다시 올리거나, 이미지를 1~2장으로 줄여 주세요." });
    }

    // ── G1: 구간별 타이밍(병목 특정용). 응답 timings + 서버 로그로 남김 ──
    const _t0 = Date.now();
    const timings = {};
    const mark = (k) => { timings[k] = Date.now() - _t0; };
    // 메모리 로드를 검색/Drive와 병렬로 선(先)착수 (userId만 의존, 결과는 아래에서 await)
    const needsFullMemoryEarly = history.length === 0
      || /기억|메모리|이전|내 정보|나에 대해|알고 있|히스토리/.test(message.toLowerCase());
    const _memStart = Date.now();
    const memoryPromise = getMemoryPrompt(userId, needsFullMemoryEarly)
      .then(r => { timings.memoryMs = Date.now() - _memStart; timings.memoryCached = r.cached; return r.prompt; })
      .catch(() => { timings.memoryMs = Date.now() - _memStart; return ""; });

    // ① 날씨 직접 처리
    const weatherKw = ["날씨","기온","우산","weather","forecast"];
    if (weatherKw.some(w => message.toLowerCase().includes(w))) {
      const weatherResult = await handleWeather(message);
      if (weatherResult) {
        return res.status(200).json({ ok: true, text: weatherResult, provider: "weather" });
      }
    }

    // ② GitHub 직접 실행
    const ghIntent = detectGitHubIntent(message);
    if (ghIntent) {
      try {
        if (ghIntent.type === "auth_cleanup") {
          const r = await callAuthCleanup();
          const text = r.ok
            ? `✅ auth 폴더 정리 완료\n| 항목 | 내용 |\n|---|---|\n| 정리된 폴더 | ${r.message || "완료"} |\n| 유지된 폴더 ID | ${r.kept || "-"} |`
            : `❌ 정리 실패: ${r.error || r.message}`;
          return res.status(200).json({ ok: true, text, provider: "github" });
        }
        if (ghIntent.type === "read") {
          const r = await callGitHubRead(ghIntent.path);
          const preview = r.content ? r.content.slice(0, 500) : (r.error || "읽기 실패");
          const text = `📄 **${ghIntent.path}** 파일 내용 (앞 500자)\n\`\`\`\n${preview}\n\`\`\``;
          return res.status(200).json({ ok: true, text, provider: "github" });
        }
        if (ghIntent.type === "github_status") {
          const r = await callGitHubRead("package.json");
          const text = r.content
            ? `✅ GitHub 연결 정상\n| 항목 | 상태 |\n|---|---|\n| 저장소 | yesblue0342-bit/stella-ai-workspace |\n| Read | ✅ |\n| Commit | ✅ (GITHUB_TOKEN 등록됨) |\n| 자동배포 | ✅ (Vercel 연동) |`
            : `❌ GitHub 연결 실패: ${r.error || "토큰 확인 필요"}`;
          return res.status(200).json({ ok: true, text, provider: "github" });
        }
      } catch (ghErr) {
        // GitHub 실패 시 AI로 폴백
      }
    }

    // ③ 일반 AI 처리 - 키워드 기반 조건부 실행 (속도 최적화)
    const msg = message.toLowerCase();

    // [웹검색/날씨] 키워드가 있을 때만 실행
    const needsSearch  = /구글|검색|최신|뉴스|오늘|지금|현재|실시간/.test(msg);
    const needsWeather = /날씨|기온|우산|비|눈|더위|추위|forecast|weather/.test(msg);
    const needsDrive   = /내 드라이브|my drive|#폴더|드라이브|drive/.test(msg)
                      || /내 드라이브/.test(message) // 원문 대소문자 유지
                      || /^#/.test(String(message).trim()) // ★ #으로 시작하면 드라이브 읽기
                      || String(message).split(/\r?\n/).some(l => l.trim().startsWith("#"));
    const needsSapSearch = /sap|qa32|qm|pp|abap|inspection|bom|migo|mb51|검사|품질|공정|자재|트랜잭션/.test(msg);

    // 웹/날씨 검색 (조건부)
    let searchContext = { used: false };
    if (needsSearch || needsWeather) {
      try { searchContext = await prepareSearchContext(message); } catch(e) {}
    }

    // Drive 파일 읽기 (경로 지시어 있을 때만)
    let driveContext = null;
    if (needsDrive) {
      try {
        actualDriveContext = await buildDriveContextForChat(message);
        if (actualDriveContext?.prompt) {
          // Drive 파일 내용이 너무 크면 context 초과 방지를 위해 60,000자로 truncate
          let driveContent = actualDriveContext.prompt;
          if (driveContent.length > 60000) {
            driveContent = driveContent.slice(0, 60000) + "\n\n⚠️ 파일이 너무 커서 앞부분(60,000자)만 분석합니다. 전체 내용은 다운로드 버튼을 이용하세요.";
          }
          aiMessage = message + driveContent;
          const readNames = (actualDriveContext.files||[]).filter(f=>f.read).map(f=>f.name);
          const unreadNames = (actualDriveContext.files||[]).filter(f=>!f.read).map(f=>f.name);
          driveContext = [
            `선택 경로: ${actualDriveContext.path}`,
            `실제로 읽은 파일(${readNames.length}개): ${readNames.join(", ")||"없음"}`,
            `읽지 못한 파일: ${unreadNames.join(", ")||"없음"}`
          ].join("\n");
          // 파일을 하나도 못 읽었으면 명시
          if(readNames.length === 0){
            driveContext += "\n\n⚠️ 읽은 파일이 0개입니다. 절대 내용을 지어내지 말고 파일을 읽지 못했다고 답하세요.";
          }
        } else {
          // buildDriveContextForChat가 null 반환 = 경로 인식 실패
          driveContext = `⚠️ Drive 경로를 인식하지 못했습니다 (입력: "${String(message).slice(0,50)}"). 내용을 지어내지 말고, 정확한 폴더명으로 다시 시도하라고 안내하세요.`;
        }
      } catch(driveErr) {
        aiMessage = message + `\n\n[STELLA_GOOGLE_DRIVE_READ_ERROR]\n${driveErr.message}\n[/STELLA_GOOGLE_DRIVE_READ_ERROR]\n\nDrive 파일 내용을 읽지 못했습니다.`;
        driveContext = `Drive 읽기 오류: ${driveErr.message}`;
      }
    }

    // SAP/업무 키워드 있을 때만 Drive 검색 (최대 3개 요약)
    if (!driveContext && needsSapSearch) {
      driveContext = await searchDriveContext(message);
    }

    mark("contextMs"); // 검색+Drive 구간 종료 시점

    // ④ 메모리 로드 — 위에서 검색/Drive와 병렬 착수한 promise를 여기서 회수(추가 대기 최소화)
    // 메모리: Azure SQL 우선 → 빈값이면 Drive 폴백. warm 캐시(60s)로 반복 요청 fetch 제거.
    const memoryPrompt = await memoryPromise;
    mark("preModelMs"); // 모델 호출 직전까지 총 준비 시간
    const prompt = buildSystemPrompt(
      (memoryPrompt ? memoryPrompt + "\n\n" : "") + system,
      searchContext,
      driveContext
    );
    
    // 모델 기반으로 API 완전 분리 (Claude 선택 시 OpenAI 절대 미호출)
    const isClaudeModel = model.toLowerCase().includes("claude") || model.toLowerCase().includes("fable");
    // Stella GPT(루트 /) 라우팅: body.route 일 때만. 실시간 질문→web_search+gpt-4o, 일반→gpt-4o-mini.
    const routed = !!body.route && !isClaudeModel;
    let answer;
    let provider;
    const _modelStart = Date.now();
    if (routed) {
      const wantTable = wantsTable(message);
      // 메모리 노드(kh_memory) + Drive 컨텍스트는 extra 로 합쳐 보존. 표는 온디맨드.
      // 검색 게이트 제거: web_search를 항상 제공해 모델이 필요할 때 검색(맛집·장소·실시간 정확도 ↑, 환각 제거).
      const routeSys = routeSystemPrompt({ table: wantTable, extra: [memoryPrompt, driveContext].filter(Boolean).join("\n\n") });
      // #구글드라이브/드라이브 명령은 web_search보다 우선 → 그땐 검색 미제공(Drive 내용으로 답). 그 외엔 항상 web_search.
      const useSearch = !needsDrive;
      provider = useSearch ? "openai-search" : "openai";
      answer = await callResponses({ model: "gpt-4o", system: routeSys, history, message: aiMessage, images, search: useSearch });
      timings.routed = true; timings.searchAlways = useSearch; timings.driveFirst = needsDrive; timings.tableUsed = wantTable;
    } else if (isClaudeModel) {
      provider = "claude";
      answer = await callClaude({ model, system: prompt, history, message: aiMessage, images });
    } else {
      provider = "openai";
      answer = await callOpenAI({ model, system: prompt, history, message: aiMessage, images, bare: !!body.bare });
    }
    timings.modelMs = Date.now() - _modelStart;
    timings.totalMs = Date.now() - _t0;
    try { console.log("[chat timings]", provider, model, JSON.stringify(timings)); } catch(e) {}

    // ⑤ 메모리 업데이트 (비동기 - 응답 지연 없음)
    setImmediate(async () => {
      try {
        const newItems = await extractMemoryFromConversation({
          model, history, message: aiMessage, answer, isClaudeModel
        });
        if (newItems && Object.values(newItems).some(a => Array.isArray(a) && a.length > 0)) {
          await updateMemory(userId, newItems, isClaudeModel); // Drive(폴백 보존)
          invalidateMemoryCache(userId); // 새 메모리 반영 위해 워밍 캐시 무효화
          // Azure SQL에도 기록(우선 백엔드). 각 항목을 메모리 행으로 dedupe 저장. graceful.
          try {
            for (const [cat, arr] of Object.entries(newItems)) {
              if (!Array.isArray(arr)) continue;
              for (const item of arr) {
                const t = typeof item === "string" ? item : (item && (item.text || item.memory_text));
                if (t && String(t).trim()) await saveMemoryAzure(userId, { memory_text: String(t).trim(), category: cat, source: "ai_inferred" });
              }
            }
          } catch (e2) {}
        }
      } catch(e) { console.warn("[Memory] 업데이트 실패:", e.message); }
    });
    
    return res.status(200).json({
      ok: true,
      text: answer,
      provider,
      timings,
      searchContext,
      driveRead: actualDriveContext ? {
        path: actualDriveContext.path,
        files: (actualDriveContext.files || []).map(f => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          read: !!f.read,
          error: f.error || "",
          link: f.link || (f.id ? ((f.isFolder || f.mimeType === "application/vnd.google-apps.folder")
            ? `https://drive.google.com/drive/folders/${f.id}`
            : `https://drive.google.com/file/d/${f.id}/view`) : "")
        }))
      } : null
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "chat error" });
  }
}

// Drive StellaGPT 폴더 검색 (SAP/업무 관련 질문 시)
async function searchDriveContext(message) {
  try {
    const msg = String(message || "").toLowerCase();
    const driveKw = ["sap","qa32","qm","pp","abap","inspection","lot","bom","mr21","migo","mb51","검사","품질","공정","자재","트랜잭션"];
    if (!driveKw.some(k => msg.includes(k))) return null;
    const { searchDrive } = await import("../lib/drive-utils.js");
    const results = await searchDrive(message, { scope: "StellaGPT", pageSize: 5 }).catch(() => null);
    if (!results || !results.length) return null;
    return results.slice(0,3).map(r => `[Drive:${r.name}] ${(r.snippet||r.name).slice(0,200)}`).join("\n");
  } catch { return null; }
}

async function prepareSearchContext(message) {
  try {
    const smart = detectSmartIntent(message);
    if (smart === "place" || smart === "weather") {
      return await getSmartContextForMessage(message);
    }
  } catch (error) {
    return { used: false, error: error.message };
  }
  return { used: false };
}


// ═══════════════════════════════════════════════
// 메모리 노드 시스템 - KH 장기 기억
// Drive: StellaGPT/memory/{userId}_memory.json
// ═══════════════════════════════════════════════

const MEMORY_FOLDER = ["memory"];
const MAX_MEMORY_ITEMS = 50; // 항목별 최대 개수

// 메모리 로드 (기본 파일 + 폴더 내 추가 파일 모두 합치기)
// memory/ 폴더에 chatgpt_history.json, claude_memory.json 등 추가 파일을 넣으면 자동으로 합쳐짐
async function loadMemory(userId, fullScan = false) {
  const base = { userId, facts: [], patterns: [], preferences: [], context: [], updatedAt: null };

  // 1) 기본 메모리 파일 로드
  try {
    const data = await readJsonFromDrive({
      folderPath: MEMORY_FOLDER,
      fileName: `${userId}_memory`
    });
    if (data) {
      base.facts = Array.isArray(data.facts) ? data.facts : [];
      base.patterns = Array.isArray(data.patterns) ? data.patterns : [];
      base.preferences = Array.isArray(data.preferences) ? data.preferences : [];
      base.context = Array.isArray(data.context) ? data.context : [];
      base.updatedAt = data.updatedAt || null;
    }
  } catch(e) {}

  // 2) 폴더 내 추가 파일들 스캔 (fullScan=true 일 때만 - 속도 최적화)
  // 기본은 {userId}_memory.json 하나만 읽고, 필요할 때만 폴더 전체 스캔
  if (!fullScan) return base;
  try {
    const files = await listJsonFromDrive({ folderPath: MEMORY_FOLDER, pageSize: 50 });
    for (const f of files) {
      const fname = f.name.replace(/\.json$/i, "");
      // 기본 파일은 이미 읽었으므로 스킵
      if (fname === `${userId}_memory`) continue;
      try {
        const ext = await readJsonFromDrive({ folderPath: MEMORY_FOLDER, fileName: fname });
        if (!ext || !ext.data) continue;
        const d = ext.data;
        // 형식 1: {facts:[], patterns:[], preferences:[], context:[]} - 표준 형식
        if (Array.isArray(d.facts))       base.facts       = [...base.facts,       ...d.facts];
        if (Array.isArray(d.patterns))    base.patterns    = [...base.patterns,    ...d.patterns];
        if (Array.isArray(d.preferences)) base.preferences = [...base.preferences, ...d.preferences];
        if (Array.isArray(d.context))     base.context     = [...base.context,     ...d.context];
        // 형식 2: {memories: [...]} - ChatGPT 메모리 export 형식
        if (Array.isArray(d.memories)) {
          base.facts = [...base.facts, ...d.memories.map(m => typeof m === "string" ? m : (m.memory || m.text || JSON.stringify(m)))];
        }
        // 형식 3: {items: [...]} or {entries: [...]} - 기타 형식
        if (Array.isArray(d.items))   base.facts = [...base.facts,   ...d.items.map(m => typeof m === "string" ? m : JSON.stringify(m))];
        if (Array.isArray(d.entries)) base.facts = [...base.facts, ...d.entries.map(m => typeof m === "string" ? m : JSON.stringify(m))];
        // 형식 4: 단순 문자열 배열
        if (Array.isArray(d) && d.every(x => typeof x === "string")) base.facts = [...base.facts, ...d];
        console.log(`[Memory] 추가 파일 로드: ${fname}`);
      } catch(e2) {}
    }
  } catch(e) {}

  // 중복 제거 + MAX 적용
  const dedup = arr => [...new Set(arr.filter(Boolean))].slice(-MAX_MEMORY_ITEMS);
  base.facts       = dedup(base.facts);
  base.patterns    = dedup(base.patterns);
  base.preferences = dedup(base.preferences);
  base.context     = dedup(base.context);

  return base;
}

// 메모리 저장
async function saveMemory(userId, memory) {
  try {
    await saveJsonToDrive({
      folderPath: MEMORY_FOLDER,
      fileName: `${userId}_memory`,
      data: { ...memory, updatedAt: new Date().toISOString() }
    });
  } catch(e) { console.warn("[Memory] 저장 실패:", e.message); }
}

// 대화에서 기억할 정보 추출 (AI 활용)
async function extractMemoryFromConversation({ model, history, message, answer, isClaudeModel }) {
  try {
    const recentConv = [
      ...history.slice(-6).map(m => `${m.role === "assistant" ? "Stella" : "KH"}: ${String(m.content||"").slice(0,200)}`),
      `KH: ${String(message||"").slice(0,300)}`,
      `Stella: ${String(answer||"").slice(0,300)}`
    ].join("\n");

    const extractPrompt = `다음 대화에서 KH(사용자)에 대해 기억할 가치 있는 정보를 JSON으로 추출하세요.
추출 기준:
- facts: KH의 확실한 사실 (직업, 프로젝트, 위치, 가족 등)
- patterns: 반복되는 질문 패턴이나 업무 방식
- preferences: 선호도 (답변 형식, 관심사, 좋아하는 것)
- context: 현재 진행 중인 업무나 관심사

없으면 빈 배열. 새 정보만 추출 (기존과 중복 제외).
반드시 JSON만 반환:
{"facts":[],"patterns":[],"preferences":[],"context":[]}

대화:
${recentConv}`;

    let extracted;
    if (isClaudeModel) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, system: "JSON only.", messages: [{ role:"user", content: extractPrompt }] })
      });
      const d = await r.json();
      extracted = JSON.parse(d.content?.[0]?.text || "{}");
    } else {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0, max_tokens: 512, response_format: { type: "json_object" },
          messages: [{ role:"system", content:"JSON only." }, { role:"user", content: extractPrompt }] })
      });
      const d = await r.json();
      extracted = JSON.parse(d.choices?.[0]?.message?.content || "{}");
    }
    return extracted;
  } catch(e) { console.warn("[Memory] 추출 실패:", e.message); return null; }
}

// 메모리 업데이트 (중복 제거 + 최대 개수 유지)
async function updateMemory(userId, newItems, isClaudeModel) {
  const memory = await loadMemory(userId);
  const now = new Date().toISOString();
  
  const addUnique = (arr, newArr, maxN) => {
    if (!Array.isArray(newArr) || !newArr.length) return arr;
    const existing = new Set(arr.map(x => String(x).toLowerCase().trim()));
    const filtered = newArr.filter(x => x && !existing.has(String(x).toLowerCase().trim()));
    return [...arr, ...filtered].slice(-maxN);
  };

  if (newItems) {
    memory.facts = addUnique(memory.facts, newItems.facts, MAX_MEMORY_ITEMS);
    memory.patterns = addUnique(memory.patterns, newItems.patterns, 30);
    memory.preferences = addUnique(memory.preferences, newItems.preferences, 30);
    memory.context = addUnique(memory.context, newItems.context, 20);
  }
  
  await saveMemory(userId, memory);
  return memory;
}

// 메모리를 시스템 프롬프트용 텍스트로 변환
function memoryToPrompt(memory) {
  if (!memory) return "";
  const parts = [];
  if (memory.facts?.length) parts.push(`[KH 알려진 사실]\n${memory.facts.slice(-15).map(f=>"• "+f).join("\n")}`);
  if (memory.preferences?.length) parts.push(`[KH 선호도]\n${memory.preferences.slice(-10).map(f=>"• "+f).join("\n")}`);
  if (memory.context?.length) parts.push(`[현재 업무 맥락]\n${memory.context.slice(-8).map(f=>"• "+f).join("\n")}`);
  if (memory.patterns?.length) parts.push(`[질문 패턴]\n${memory.patterns.slice(-8).map(f=>"• "+f).join("\n")}`);
  if (!parts.length) return "";
  const updated = memory.updatedAt ? `(${memory.updatedAt.slice(0,10)} 기준)` : "";
  return `[=== KH 장기 메모리 ${updated} ===]\n${parts.join("\n\n")}\n[=== 메모리 끝 ===]`;
}

function buildSystemPrompt(system, searchContext, driveContext) {
  let prompt = system;
  if (searchContext?.used && searchContext.context) {
    prompt += `\n\n[실시간 컨텍스트]\n${searchContext.context}`;
  }
  if (driveContext) {
    prompt += `\n\n[Google Drive 실제 파일 내용]\n${driveContext}`;
    prompt += `\n\n[★ 절대 규칙 - Google Drive 응답]\n`
      + `1. 위 "실제로 읽은 파일" 목록에 있는 파일만 근거로 답하세요.\n`
      + `2. 파일을 하나도 읽지 못했거나 "읽기 오류"가 있으면, 절대 내용을 지어내지 말고 다음과 같이 답하세요: "해당 경로에서 파일을 읽지 못했습니다. 폴더명이 정확한지, Stella DB에 파일이 있는지 확인해 주세요."\n`
      + `3. 파일명(예: 개발_계획.docx, 기능_명세서.xlsx 같은 가상의 파일)을 추측해서 만들어내면 절대 안 됩니다.\n`
      + `4. 예시 표나 가상의 데이터를 만들지 마세요. 실제 읽은 내용이 없으면 없다고 하세요.`;
  }
  return prompt;
}

function resolveOpenAIModel(model) {
  const m = String(model || "").toLowerCase().trim();
  if (m.includes("5.5") || m === "chatgpt-5.5-latest") return "gpt-4o";
  if (m === "gpt-5") return "gpt-4o";
  if (m === "gpt-4.1") return "gpt-4.1";
  if (m === "gpt-4.1-mini") return "gpt-4.1-mini";
  if (m === "gpt-4o") return "gpt-4o";
  if (m === "gpt-4o-mini") return "gpt-4o-mini";
  return "gpt-4o";
}

const CLAUDE_MODELS = {
  "claude-fable-5": "claude-fable-5",
  "claude-opus-4-8": "claude-opus-4-8",
  "claude-opus-4-7": "claude-opus-4-7",
  "claude-opus-4-6": "claude-opus-4-6",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001"
};

function resolveClaudeModel(model) {
  const m = String(model || "").toLowerCase().trim();
  if (CLAUDE_MODELS[m]) return CLAUDE_MODELS[m];
  if (m.includes("fable")) return "claude-fable-5";
  if (m.includes("opus")) {
    if (m.includes("4.8") || m.includes("4-8")) return "claude-opus-4-8";
    if (m.includes("4.7") || m.includes("4-7")) return "claude-opus-4-7";
    if (m.includes("4.6") || m.includes("4-6")) return "claude-opus-4-6";
    return "claude-opus-4-8";
  }
  if (m.includes("haiku")) return "claude-haiku-4-5-20251001";
  if (m.includes("sonnet")) return "claude-sonnet-4-6";
  if (m.includes("claude")) return "claude-sonnet-4-6";
  return "claude-sonnet-4-6";
}

async function callOpenAI({ model, system, history, message, images = [], bare = false }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const imgs = (Array.isArray(images) ? images : []).filter(u => u && String(u).startsWith("data:"));
  // 이미지가 있으면 비전 가능 모델 보장(gpt-4.1-mini 등은 비전 지원이라 유지).
  const selectedModel = ensureVisionModel(resolveOpenAIModel(model), imgs.length > 0, "openai");
  // bare=true(예: Stella Codex 코딩 어시스턴트)는 "[표+요약]" 강제 형식 프리픽스를 생략
  const pfx = bare ? "" : "[표+요약 형식으로 답변] ";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: selectedModel,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        ...history.slice(-12).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
        { role: "user", content: imgs.length > 0
          ? [{ type:"text", text:pfx+String(message||"") },
             ...imgs.map(u=>{ const { base64, mediaType } = parseDataUrl(u); const b = visionImageBlock({ api:"chat", base64, mediaType }); b.image_url.detail = "auto"; return b; })]
          : pfx+String(message||"") }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OpenAI API error");
  return data.choices?.[0]?.message?.content || "응답 없음";
}

async function callClaude({ model, system, history, message, images = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const imgs = (Array.isArray(images) ? images : []).filter(u => u && String(u).startsWith("data:"));
  const selectedModel = ensureVisionModel(resolveClaudeModel(model), imgs.length > 0, "claude");
  // 55초 타임아웃 가드 (Vercel 60초 제한 직전 우아하게 처리)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);
  let response;
  try {
  response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: controller.signal,
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: selectedModel,
      max_tokens: 4096,
      system,
      messages: [
        ...history.slice(-12).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
        { role: "user", content: imgs.length > 0
          ? [...imgs.map(u=>{ const { base64, mediaType } = parseDataUrl(u); return visionImageBlock({ api:"claude", base64, mediaType }); }), { type:"text", text:String(message||"") }]
          : String(message||"") }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content?.map(c => c.text || "").join("\n") || "응답 없음";
  } catch(e) {
    if (e.name === "AbortError") throw new Error("응답 시간이 너무 깁니다. 질문을 더 짧게 해주세요.");
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}








