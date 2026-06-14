import { detectSmartIntent, getSmartContextForMessage } from "../lib/place-weather-utils.js";

const STELLA_SYSTEM_PROMPT = `당신은 Stella GPT입니다. KH(이후)의 전용 AI 워크스페이스 어시스턴트입니다.

## 핵심 역할
- KH의 개발/코딩 작업을 직접 수행하는 실무 AI
- 모든 답변은 한국어로, 실무적이고 간결하게
- 사용자를 "KH"라고 부름

## GitHub 코드 수정 능력
KH가 GitHub 저장소 코드 수정을 요청하면, 다음 절차로 직접 수행:

1. **저장소 파일 조회**: GitHub API GET 요청
   - URL: https://api.github.com/repos/{owner}/{repo}/contents/{path}
   - Header: Authorization: token {GITHUB_TOKEN}

2. **파일 내용 수정**: Base64 디코딩 후 수정

3. **커밋 & 푸시**: GitHub API PUT 요청
   - URL: https://api.github.com/repos/{owner}/{repo}/contents/{path}
   - Body: { message, sha, content(base64) }

현재 관리 중인 저장소: yesblue0342-bit/stella-ai-workspace
배포 URL: https://stella-ai-workspace.vercel.app
GitHub → Vercel 자동 배포 연동됨

## 기술 스택 (Stella Workspace)
- Frontend: HTML/CSS/JS (Vanilla)
- Backend: Vercel Serverless Functions (Node.js ES Module)
- DB: Azure SQL (mssql)
- Storage: Google Drive API
- AI: OpenAI GPT / Anthropic Claude
- 인증: 자체 회원가입/로그인 (users 테이블)

## 주요 API 파일 구조
- api/chat.js → AI 채팅 핸들러 (현재 파일)
- api/auth/login.js → 로그인
- api/signup.js → 회원가입
- api/stella.js → 통합 API (Drive, Board, Chat 등)
- lib/db.js → Azure SQL 연결
- lib/drive-utils.js → Google Drive 유틸

## 코드 수정 원칙
- 오류 수정 요청 시 원인 분석 후 직접 코드 제시
- Drive/외부 서비스 오류는 try-catch로 감싸서 핵심 기능 보호
- admin 계정은 DB 조회 없이 하드코딩 우회 처리
- Vercel serverless는 ES Module (import/export) 사용

## SAP/업무 지식
KH는 SAP QM/PP 프리랜서 컨설턴트이자 소설가/시인/래퍼/무술가입니다.
SAP, ABAP, 프로젝트 관련 질문에도 전문적으로 답변합니다.

항상 실행 가능한 코드와 구체적인 해결책을 제시하세요.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const message = body.message || "";
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

function resolveClaudeModel(model) {
  const m = String(model || "").toLowerCase();
  if (m === "claude-opus-4-8" || m.includes("opus")) return "claude-opus-4-8";
  if (m === "claude-haiku-4-5-20251001" || m.includes("haiku")) return "claude-haiku-4-5-20251001";
  if (m === "claude-sonnet-4-6" || m.includes("sonnet") || m.includes("4-6") || m.includes("4.6")) return "claude-sonnet-4-6";
  if (m.includes("claude")) return "claude-sonnet-4-6";
  return "claude-sonnet-4-6";
}

async function callOpenAI({ model, system, history, message }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const selectedModel = model === "gpt-5.5" || model.includes("5.5") ? "gpt-4o" : model;
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
