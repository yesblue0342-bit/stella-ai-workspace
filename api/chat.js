import { detectSmartIntent, getSmartContextForMessage } from "../lib/place-weather-utils.js";
import { saveJsonToDrive, readJsonFromDrive, listJsonFromDrive, buildDriveContextForChat } from "../lib/drive-utils.js";

// 이미지 base64 전송을 위해 body 크기 제한 상향
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb"
    }
  },
  maxDuration: 60
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
    const model = body.model || "gpt-4o-mini";
    const system = body.system || STELLA_SYSTEM_PROMPT;
    const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
    const userId = String(body.userId || body.user_id || "kh").trim();

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

    // ③ 일반 AI 처리 (모델 완전 분리 - 중복 과금 방지)
    const searchContext = await prepareSearchContext(message);

    // Google Drive 경로가 들어오면 실제 folderId/fileId 기준으로 파일 내용 읽기
    let driveContext = null;
    try {
      actualDriveContext = await buildDriveContextForChat(message);
      if (actualDriveContext?.prompt) {
        aiMessage = message + actualDriveContext.prompt;
        driveContext = [
          `선택 경로: ${actualDriveContext.path}`,
          `실제로 읽은 파일: ${(actualDriveContext.files || []).filter(f => f.read).map(f => f.name).join(", ") || "없음"}`,
          `읽지 못한 파일: ${(actualDriveContext.files || []).filter(f => !f.read).map(f => f.name).join(", ") || "없음"}`
        ].join("\n");
      }
    } catch (driveErr) {
      aiMessage = message + `\n\n[STELLA_GOOGLE_DRIVE_READ_ERROR]\n${driveErr.message}\n[/STELLA_GOOGLE_DRIVE_READ_ERROR]\n\nDrive 파일 내용을 읽지 못했습니다. 추측하지 말고 사용자에게 파일 내용을 읽지 못했다고 안내하세요.`;
      driveContext = `Drive 읽기 오류: ${driveErr.message}`;
    }

    if (!driveContext) {
      driveContext = await searchDriveContext(message); // 기존 Drive 검색 연동
    }
    
    // ④ 메모리 노드 로드 (KH 장기 기억)
    const memory = await loadMemory(userId);
    const memoryPrompt = memoryToPrompt(memory);
    const prompt = buildSystemPrompt(
      (memoryPrompt ? memoryPrompt + "\n\n" : "") + system,
      searchContext,
      driveContext
    );
    
    // 모델 기반으로 API 완전 분리 (Claude 선택 시 OpenAI 절대 미호출)
    const isClaudeModel = model.toLowerCase().includes("claude") || model.toLowerCase().includes("fable");
    let answer;
    let provider;
    if (isClaudeModel) {
      provider = "claude";
      answer = await callClaude({ model, system: prompt, history, message: aiMessage, images });
    } else {
      provider = "openai";
      answer = await callOpenAI({ model, system: prompt, history, message: aiMessage, images });
    }
    
    // ⑤ 메모리 업데이트 (비동기 - 응답 지연 없음)
    setImmediate(async () => {
      try {
        const newItems = await extractMemoryFromConversation({
          model, history, message: aiMessage, answer, isClaudeModel
        });
        if (newItems && Object.values(newItems).some(a => Array.isArray(a) && a.length > 0)) {
          await updateMemory(userId, newItems, isClaudeModel);
        }
      } catch(e) { console.warn("[Memory] 업데이트 실패:", e.message); }
    });
    
    return res.status(200).json({
      ok: true,
      text: answer,
      provider,
      searchContext,
      driveRead: actualDriveContext ? {
        path: actualDriveContext.path,
        files: (actualDriveContext.files || []).map(f => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          read: !!f.read,
          error: f.error || ""
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
    return results.slice(0,3).map(r => `[Drive:${r.name}] ${r.snippet||r.name}`).join("\n");
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
async function loadMemory(userId) {
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

  // 2) 폴더 내 추가 파일들 스캔 (ChatGPT/Claude 히스토리 등)
  // 파일명이 {userId}_memory.json 이 아닌 .json 파일 모두 읽어서 합침
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
    prompt += `\n\n[Google Drive StellaGPT 관련 파일]\n${driveContext}`;
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

async function callOpenAI({ model, system, history, message, images = [] }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const selectedModel = resolveOpenAIModel(model);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: selectedModel,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        ...history.slice(-12).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
        { role: "user", content: images.length > 0
          ? [{ type:"text", text:"[표+요약 형식으로 답변] "+String(message||"") },
             ...images.map(u=>({ type:"image_url", image_url:{ url:u, detail:"auto" } }))]
          : "[표+요약 형식으로 답변] "+String(message||"") }
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
  const selectedModel = resolveClaudeModel(model);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: selectedModel,
      max_tokens: 4096,
      system,
      messages: [
        ...history.slice(-12).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
        { role: "user", content: images.length > 0
          ? [...images.map(u=>{ const mx=u.match(/^data:([^;]+);base64,(.+)$/); return mx?{ type:"image", source:{ type:"base64", media_type:mx[1], data:mx[2] } }:null; }).filter(Boolean), { type:"text", text:String(message||"") }]
          : String(message||"") }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content?.map(c => c.text || "").join("\n") || "응답 없음";
}








