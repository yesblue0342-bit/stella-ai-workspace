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

export default { CLAUDE_MODELS, DEFAULT_MODEL, isValidModel, resolveModel, AgentRun, nextDelayMs, buildTranscript };
