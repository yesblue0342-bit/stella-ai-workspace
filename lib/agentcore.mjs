// lib/agentcore.mjs — Stella Agent Code 핵심 로직 (Managed Agents API와 무관, 재사용)
// 프록시(api/cc/*)와 프론트(cc.html)에서 공용 사용. 정규화된 이벤트를 입력으로 가정.

export const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8',           label: 'Claude Opus 4.8',   tier: 'opus',   note: '최고 성능' },
  { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', tier: 'sonnet', note: '균형 (일상 코딩 권장)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  tier: 'haiku',  note: '빠름·저비용 (테스트용)' },
];
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export function isValidModel(id){ return CLAUDE_MODELS.some(m => m.id === id); }
export function resolveModel(id){ return isValidModel(id) ? id : DEFAULT_MODEL; }

// Managed Agents 이벤트를 정규화 형태로 받아 누적/중복제거/종료감지
// 정규화 이벤트: { seq:number, kind:'text'|'tool_use'|'tool_result'|'status', ... }
const TERMINAL_OK = ['idle','completed','done','finished','status_idle'];
export class AgentRun {
  constructor(){ this.cursor = 0; this.text = ''; this.tools = []; this.status = 'running'; this.error = null; }
  ingest(events){
    const fresh = (events || [])
      .filter(e => e && typeof e.seq === 'number' && e.seq > this.cursor)
      .sort((a,b) => a.seq - b.seq);
    for (const e of fresh){
      this.cursor = e.seq;
      if (e.kind === 'text') this.text += (e.text || '');
      else if (e.kind === 'tool_use') this.tools.push({ seq:e.seq, name:e.name, input:e.input ?? null, result:null });
      else if (e.kind === 'tool_result'){
        const t = [...this.tools].reverse().find(x => x.name === e.name && x.result === null);
        if (t) t.result = e.result; else this.tools.push({ seq:e.seq, name:e.name, input:null, result:e.result });
      } else if (e.kind === 'status'){
        const s = String(e.status || '').toLowerCase();
        if (TERMINAL_OK.includes(s)) this.status = 'idle';
        else if (s === 'error' || s === 'failed'){ this.status = 'error'; this.error = e.error || 'unknown'; }
        else this.status = s || this.status;
      }
    }
    return fresh.length;
  }
  get done(){ return this.status === 'idle' || this.status === 'error'; }
}
export function nextDelayMs(attempt){ return Math.min(800 + attempt * 400, 4000); }

export function buildTranscript({ title, model, prompt, run }){
  const lines = [];
  lines.push(`# ${title || 'Stella Agent Code 세션'}`);
  lines.push(`- 모델: ${model}`);
  lines.push(`- 상태: ${run.status}${run.error ? ' ('+run.error+')' : ''}`);
  lines.push('', '## 요청', prompt || '', '');
  if (run.tools.length){
    lines.push('## 에이전트 작업');
    for (const t of run.tools) lines.push(`- 🔧 **${t.name}** ${t.input ? '`'+JSON.stringify(t.input).slice(0,120)+'`' : ''}`);
    lines.push('');
  }
  lines.push('## 응답', run.text || '(텍스트 없음)');
  return lines.join('\n');
}

// ── OMC (oh-my-claudecode) 부트스트랩 ──
// OMC는 대화형 Claude Code CLI용 멀티에이전트 오케스트레이션 플러그인이다.
// Managed Agents 샌드박스(무제한 네트워킹+bash)에서 설치해 그 방법론을 적용하도록 시스템 프롬프트로 지시.
export const OMC_REPO = 'https://github.com/Yeachan-Heo/oh-my-claudecode';
export const OMC_NPM = 'oh-my-claude-sisyphus@latest';
const BASE_SYSTEM = 'You are Stella Agent Code, an autonomous coding agent running in a sandbox. Write clean, well-documented code, run and verify it, and explain results concisely. Reply in Korean when the user writes Korean.';

// OMC 체크 시: 멀티에이전트(OMC) + 무인 오토파일럿(ralph) 자동 테스트·오류수정 루프를 적용.
const OMC_DIRECTIVE =
  '[OMC mode] Use Oh My ClaudeCode (OMC), a multi-agent orchestration toolkit, for this task. ' +
  'First bootstrap OMC in the sandbox before working: run `npm install -g ' + OMC_NPM + '`; ' +
  'if that is unavailable, `git clone ' + OMC_REPO + ' /tmp/omc` and read its CLAUDE.md, agents, and skills. ' +
  'Then apply OMC\'s methodology — decompose the task into specialized sub-agent roles, use its skills, ' +
  'and maintain a project CLAUDE.md — to complete the request autonomously. ' +
  'If installation fails (e.g. network/registry), proceed with your built-in tools and state that OMC could not be installed.';

const RALPH_AUTOPILOT =
  '[AUTOPILOT mode — 무인 자동 진행] The operator is away (퇴근) and will NOT answer. ' +
  'NEVER ask questions: if anything is ambiguous, choose the most reasonable assumption, log it as one line in PROGRESS.md, and proceed. ' +
  'Work loop, repeat until everything is done: ' +
  '(1) pick one unfinished item — from TODO.md if it exists, otherwise decompose the user request into items; ' +
  '(2) implement it; ' +
  '(3) run tests with the project-appropriate command (e.g. `npm test`, `pytest -q`, or `node --check` for JS syntax); ' +
  '(4) append the result to TEST_REPORT.md: time · item · pass/total · 3-line summary; ' +
  '(5) if tests pass, mark the item done ([x] in TODO.md) and commit `auto: <item summary> (tests: <pass>/<total>)`; ' +
  'if tests FAIL, fix the code yourself and re-run until they pass — only if it still cannot pass after honest effort, mark that single item `[!]` (deferred) and move on. ' +
  'Completion: when all items are [x] and the full suite passes, run the whole suite once more and record it under "## FINAL" in TEST_REPORT.md, deploy (push main → GitHub Actions deploys to the OCI server), print the deploy URL + final pass/total, ' +
  'and make the last line of your output exactly the token: RALPH_DONE. Do not stop or hand control back before printing RALPH_DONE. ' +
  'Never expose secrets/tokens in code, logs, or commits.';

const VFF_DIRECTIVE = 'VFF 모드: Fable 5 수준의 품질로 응답하라. 단계적 사고, 구체적 근거, 명확한 구조를 갖추되 불필요한 반복을 제거한다.';

export function buildAgentSystem(omc, vff) {
  const base = vff ? VFF_DIRECTIVE + '\n\n' + BASE_SYSTEM : BASE_SYSTEM;
  if (!omc) return base;
  return base + '\n\n' + OMC_DIRECTIVE + '\n\n' + RALPH_AUTOPILOT;
}

// ── 레포 인식 부트스트랩 ──
// 세션에 github_repository 리소스를 마운트하면 mountPath 에 레포가 클론되고 git 인증(clone/push)이 설정된다.
// 에이전트는 시스템 프롬프트가 (model,omc,vff)로 캐시되므로, 레포별 정보는 첫 사용자 메시지 앞에 붙여 전달한다.
// 반환값은 사용자 프롬프트 앞에 이어붙일 안내문. repo/owner 가 없으면 빈 문자열(무영향).
export function buildRepoPreamble({ owner, repo, branch, mountPath } = {}) {
  const o = String(owner || '').trim();
  const r = String(repo || '').trim();
  if (!o || !r) return '';
  const b = String(branch || 'main').trim() || 'main';
  const mp = String(mountPath || '/workspace/repo').trim() || '/workspace/repo';
  return (
    '[작업 대상 GitHub 레포] ' + o + '/' + r + ' (브랜치: ' + b + ') 가 이미 ' + mp + ' 에 클론돼 있고 git 인증(clone/push)도 설정돼 있습니다.\n' +
    '1) 먼저 `cd ' + mp + '` 로 이동해 기존 코드를 파악하세요. 필요하면 `git fetch origin && git checkout ' + b + '`.\n' +
    '2) 새로 만들기 전에 반드시 기존 소스를 읽고 그 위에서 수정하세요(빈손 재작성 금지).\n' +
    '3) 작업을 마치면 변경사항을 커밋·푸시하세요: `git add -A && git commit -m "<요약>" && git push origin ' + b + '`.\n' +
    'The repository is pre-cloned and git-authenticated at ' + mp + '. Work inside it and push your commits.\n' +
    '---\n'
  );
}

export default { CLAUDE_MODELS, DEFAULT_MODEL, isValidModel, resolveModel, AgentRun, nextDelayMs, buildTranscript, OMC_REPO, OMC_NPM, buildAgentSystem, buildRepoPreamble };
