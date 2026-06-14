import { detectSmartIntent, getSmartContextForMessage } from "../lib/place-weather-utils.js";

const STELLA_SYSTEM_PROMPT = `당신은 Stella GPT입니다. KH(이후)의 전용 AI 워크스페이스입니다.

## 답변 기본 형식 (중요)
- 기본: 핵심 요약 2-3줄 + 표(markdown table)로 정리
- 코드 수정/분석: 코드블록 + 간략 설명
- 상세 요청 시에만 긴 설명 제공
- 동문서답 절대 금지 - 질문에 정확히 답변

## GitHub 직접 수정 능력 (Vercel 환경변수 연동)
KH가 파일 수정을 요청하면 /api/github-read, /api/github-update를 직접 호출:

1. 파일 읽기: GET /api/github-read?path={파일경로}
2. 수정 후 커밋: POST /api/github-update { path, content, message }
3. Vercel 자동 배포 (GitHub push 후 자동)

저장소: yesblue0342-bit/stella-ai-workspace
배포: https://stella-ai-workspace.vercel.app
메인 파일: index.html (★ 이 파일이 실제 사용됨)

## 날씨/지도 처리
- 날씨: /api/weather?location={지역} 호출
- 국내 장소: 카카오맵 우선 → https://map.kakao.com/link/search/{장소명}
- 해외 장소: 구글맵 우선 → https://maps.google.com/?q={장소명}
- URL은 [텍스트](URL) 마크다운 링크로 표시

## 기술 스택
| 항목 | 내용 |
|---|---|
| Frontend | index.html (메인, Vanilla JS) |
| Backend | Vercel Serverless (Node.js ESM) |
| AI | OpenAI GPT + Anthropic Claude |
| 저장소 | Google Drive (데이터) + Azure SQL (인덱스) |
| 인증 | Drive 기반 auth/users/{id}.json |

## 핵심 API
| 경로 | 역할 |
|---|---|
| /api/chat | AI 채팅 |
| /api/auth | 회원가입/로그인 |
| /api/github-read | GitHub 파일 읽기 |
| /api/github-update | GitHub 파일 수정+커밋 |
| /api/stella | Drive/게시판/채팅 저장 |
| /api/weather | 날씨 |

## KH 정보
SAP QM/PP 프리랜서 컨설턴트, 소설가/시인/래퍼/무술가. Celltrion BISON 프로젝트 진행 중.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const message = body.message || "";
    
    // 날씨 요청 직접 처리
    const weatherKw = ["날씨","기온","우산","비","눈","weather","forecast"];
    if (weatherKw.some(w => message.toLowerCase().includes(w))) {
      // 지역명 추출 (송도, 서울, 인천 등)
      const locMatch = message.match(/([가-힣]{2,10}(?:시|구|군|동|읍|면|도)?)/);
      const location = locMatch ? locMatch[1] : "Seoul";
      const isDomestic = /[가-힣]/.test(location);
      try {
        const { default: weatherHandler } = await import("./weather.js");
        const fakeReq = { method:"GET", query:{ location }, body:{} };
        const result = await new Promise(resolve => {
          weatherHandler(fakeReq, {
            status(s){ return { json(d){ resolve({s,d}); } }; }
          });
        });
        const d = result?.d;
        if (d?.ok) {
          const temp = d.temperature ?? d.temp ?? "?";
          const feels = d.feels_like ?? d.feelsLike ?? "?";
          const humid = d.humidity ?? "?";
          const wind = d.wind ?? d.wind_speed ?? "?";
          const desc = d.description ?? d.weather ?? "";
          const mapLink = isDomestic
            ? `[카카오맵에서 보기](https://map.kakao.com/link/search/${encodeURIComponent(location)})`
            : `[Google Maps](https://maps.google.com/?q=${encodeURIComponent(location)}+weather)`;
          const answer = `**${location} 현재 날씨** ${desc}\n| 항목 | 값 |\n|---|---|\n| 기온 | ${temp}°C |\n| 체감 | ${feels}°C |\n| 습도 | ${humid}% |\n| 바람 | ${wind}m/s |\n\n${mapLink}`;
          return res.status(200).json({ ok:true, text: answer, provider:"weather" });
        }
      } catch(we) { /* 날씨 API 실패 시 AI가 대신 답변 */ }
    }
    const history = Array.isArray(body.history) ? body.history : [];
    const model = body.model || "gpt-4o-mini";
    const system = body.system || STELLA_SYSTEM_PROMPT;

    const searchContext = await prepareSearchContext(message);
    const prompt = buildSystemPrompt(system, searchContext);

    const provider = model.includes("claude") ? "claude" : "openai";
    const answer = provider === "claude"
      ? await callClaude({ model, system: prompt, history, message })
      : await callOpenAI({ model, system: prompt, history, message });

    return res.status(200).json({ ok: true, text: answer, provider, searchContext });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "chat error" });
  }
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

function buildSystemPrompt(system, searchContext) {
  let prompt = system;
  if (searchContext?.used && searchContext.context) {
    prompt += `\n\n[실시간 컨텍스트]\n${searchContext.context}`;
  }
  return prompt;
}

function resolveOpenAIModel(model) {
  const m = String(model || "").toLowerCase();
  // chatgpt-5.5-latest, gpt-5.5 계열 → gpt-4o (아직 API 미지원)
  if (m.includes("5.5") || m === "chatgpt-5.5-latest") return "gpt-4o";
  // gpt-5 → gpt-4o (API 미지원)
  if (m === "gpt-5") return "gpt-4o";
  // 정식 지원 모델
  if (m === "gpt-4.1") return "gpt-4.1";
  if (m === "gpt-4.1-mini") return "gpt-4.1-mini";
  if (m === "gpt-4o") return "gpt-4o";
  if (m === "gpt-4o-mini") return "gpt-4o-mini";
  // 기본값
  return "gpt-4o";
}

// 공식 Claude 모델 ID 정확 매핑 (2026-06 기준)
const CLAUDE_MODELS = {
  "claude-fable-5":            "claude-fable-5",
  "claude-opus-4-8":           "claude-opus-4-8",
  "claude-opus-4-7":           "claude-opus-4-7",
  "claude-opus-4-6":           "claude-opus-4-6",
  "claude-sonnet-4-6":         "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001"
};

function resolveClaudeModel(model) {
  const m = String(model || "").toLowerCase().trim();
  // 정확 매핑 우선
  if (CLAUDE_MODELS[m]) return CLAUDE_MODELS[m];
  // 키워드 폴백
  if (m.includes("fable"))  return "claude-fable-5";
  if (m.includes("opus")) {
    if (m.includes("4.8") || m.includes("4-8")) return "claude-opus-4-8";
    if (m.includes("4.7") || m.includes("4-7")) return "claude-opus-4-7";
    if (m.includes("4.6") || m.includes("4-6")) return "claude-opus-4-6";
    return "claude-opus-4-8"; // 최신 opus 기본값
  }
  if (m.includes("haiku"))  return "claude-haiku-4-5-20251001";
  if (m.includes("sonnet")) return "claude-sonnet-4-6";
  if (m.includes("claude")) return "claude-sonnet-4-6";
  return "claude-sonnet-4-6";
}

async function callOpenAI({ model, system, history, message }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const selectedModel = resolveOpenAIModel(model);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: selectedModel,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        ...history.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
        { role: "user", content: String(message || "") }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OpenAI API error");
  return data.choices?.[0]?.message?.content || "응답 없음";
}

async function callClaude({ model, system, history, message }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const modelMap = {
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-opus-4-8": "claude-opus-4-8",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001"
  };
  const selectedModel = modelMap[model] || "claude-sonnet-4-6";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: selectedModel,
      max_tokens: 4096,
      system,
      messages: [
        ...history.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
        { role: "user", content: String(message || "") }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content?.map((c) => c.text || "").join("\n") || "응답 없음";
}


