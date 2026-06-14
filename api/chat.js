import { detectSmartIntent, getSmartContextForMessage } from "../lib/place-weather-utils.js";

// ───────── 시스템 프롬프트 ─────────
const STELLA_SYSTEM_PROMPT = `당신은 Stella GPT입니다. KH(이후)의 전용 AI 워크스페이스입니다.

## 답변 형식 (Default - 반드시 준수)

모든 답변은 아래 구조를 기본으로 한다:

1. **핵심 요약** — 1~2문장으로 결론 먼저
2. **표(markdown table)** — 항목이 2개 이상이면 반드시 표로 정리
3. **보충 설명** — 필요 시 2~3줄 이내

❌ 절대 금지:
- 긴 번호 목록(1. 2. 3. 이어서 5줄 이상)
- 소제목(##) 남발
- 같은 내용 반복
- 설명만 하고 실행 안 함

✅ 상세 요청 시에만 (예: "자세히", "설명해줘", "왜"):
- 단계별 상세 서술 허용

## 실행 규칙
- "해줘", "수정해줘", "정리해줘" → 직접 실행 후 결과만 표시
- GitHub 작업: 서버가 자동 호출하므로 별도 설명 불필요
- 동문서답 금지

## 날씨/지도
- 국내: [카카오맵](https://map.kakao.com/link/search/장소명)
- 해외: [Google Maps](https://maps.google.com/?q=장소명)

## 저장소
- yesblue0342-bit/stella-ai-workspace
- 배포: https://stella-ai-workspace.vercel.app
- 메인파일: index.html

## KH 정보
SAP QM/PP 컨설턴트, Celltrion BISON 프로젝트, 소설가/시인/래퍼/무술가`;

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

// ───────── 날씨 직접 처리 (Google Maps API 사용) ─────────
async function handleWeather(message) {
  try {
    const { getWeatherContext } = await import("../lib/place-weather-utils.js");
    const ctx = await getWeatherContext(message);
    if (ctx?.context && !ctx.error) {
      return ctx.context;
    }
    if (ctx?.error) {
      // Google Maps API 실패 시 OpenWeather 폴백
      throw new Error(ctx.error);
    }
  } catch {
    // 폴백: OpenWeather API
    try {
      const locMatch = message.match(/([가-힣]{2,10}(?:시|구|군|동|읍|면|도)?)/);
      const location = locMatch ? locMatch[1] : "Seoul";
      const isDomestic = /[가-힣]/.test(location);
      const { default: weatherHandler } = await import("./weather.js");
      const result = await new Promise(resolve => {
        weatherHandler({ method:"GET", query:{ location }, body:{} }, {
          status(){ return { json(d){ resolve(d); } }; }
        });
      });
      if (result?.ok) {
        const temp = result.temperature ?? "?";
        const feels = result.feels_like ?? "?";
        const humid = result.humidity ?? "?";
        const wind = result.wind ?? "?";
        const desc = result.description ?? "";
        const mapLink = isDomestic
          ? `[카카오맵](https://map.kakao.com/link/search/${encodeURIComponent(location)})`
          : `[Google Maps](https://maps.google.com/?q=${encodeURIComponent(location)}+weather)`;
        return `**${location} 날씨** ${desc}\n| 항목 | 값 |\n|---|---|\n| 기온 | ${temp}°C |\n| 체감 | ${feels}°C |\n| 습도 | ${humid}% |\n| 바람 | ${wind}m/s |\n\n${mapLink}`;
      }
    } catch {}
  }
  return null;
}

// ───────── 메인 핸들러 ─────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = req.body || {};
    const message = String(body.message || "");
    const history = Array.isArray(body.history) ? body.history : [];
    const model = body.model || "gpt-4o-mini";
    const system = body.system || STELLA_SYSTEM_PROMPT;

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

    // ③ 일반 AI 처리
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

async function callOpenAI({ model, system, history, message }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const selectedModel = resolveOpenAIModel(model);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: selectedModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        ...history.slice(-12).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
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
        { role: "user", content: String(message || "") }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content?.map(c => c.text || "").join("\n") || "응답 없음";
}


