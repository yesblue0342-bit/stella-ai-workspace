// js/cc-app.js — Stella Agent Code(cc.html) 프런트엔드.
//
// cc.html(532줄)에서 추출. type="module" 이므로 여기 선언은 전역이 아니다 →
// HTML 인라인 on*= 핸들러에서 부를 수 없다(그래서 VFF 토글은 addEventListener 로 바인딩한다).

import { CLAUDE_MODELS, DEFAULT_MODEL, AgentRun, nextDelayMs, buildTranscript } from '/lib/agentcore.mjs';
import { getVffEnabled, setVffEnabled } from '/claude.client.js';

const $ = (id) => document.getElementById(id);
const MODEL_KEY = 'stella_cc_model';
let cur = null;       // { sessionId, model, budgetUsd, title, run, attempt, polling, stopped }

// ── 테마: Stella GPT와 동일한 body.dark 방식 + 'stella_theme' 키 공유 ──
// 흰색 모노크롬 라인 아이콘(stroke=currentColor) — 사이드바 바로가기와 톤 통일
const SVG_MOON='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const SVG_SUN='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
function applyTheme(){
  let t='dark'; try{ t=localStorage.getItem('stella_theme')||'dark'; }catch(e){}
  document.body.classList.toggle('dark', t!=='light');
  const b=$('themeToggle'); if(b) b.innerHTML = (t==='light')?SVG_MOON:SVG_SUN;
  const meta=document.querySelector('meta[name="theme-color"]'); if(meta) meta.setAttribute('content', t==='light'?'#ffffff':'#0d1117');
}
function toggleTheme(){
  const dark=document.body.classList.toggle('dark');
  try{ localStorage.setItem('stella_theme', dark?'dark':'light'); }catch(e){}
  const b=$('themeToggle'); if(b) b.innerHTML = dark?SVG_SUN:SVG_MOON;
  const meta=document.querySelector('meta[name="theme-color"]'); if(meta) meta.setAttribute('content', dark?'#0d1117':'#ffffff');
}
applyTheme();
$('themeToggle').addEventListener('click', toggleTheme);

// ── 레이아웃: 햄버거 토글 + 외부클릭 닫기 + 풀스크린 + 드래그 리사이저 ──
(function initLayout(){
  const body=document.body, side=document.querySelector('.side'), main=document.querySelector('.main');
  const isMobile=()=>window.matchMedia('(max-width:760px)').matches;
  const closeMobile=()=>body.classList.remove('side-open');
  // C1: 데스크톱 사이드바(세션 패널) — 기본 접힘으로 진입(메인 영역 넓게), 마지막 상태 localStorage 기억.
  const SIDECOLLAPSE_KEY='cc_sidecollapsed';
  function setSideCollapsed(on){ body.classList.toggle('side-collapsed', !!on); try{ localStorage.setItem(SIDECOLLAPSE_KEY, on?'1':'0'); }catch(e){} }
  (function applySideCollapsed(){ var on=true; try{ var v=localStorage.getItem(SIDECOLLAPSE_KEY); on=(v===null)?true:(v==='1'); }catch(e){} if(!isMobile()) body.classList.toggle('side-collapsed', !!on); })();
  function toggleSideDesktop(){ setSideCollapsed(!body.classList.contains('side-collapsed')); }
  function toggleSide(){ if(isMobile()) body.classList.toggle('side-open'); else toggleSideDesktop(); }
  // 햄버거(모바일): 상단 앱 전환 바 접기/펴기 → 넓은 화면 (기본 접힘, 상태 기억). 데스크톱: 사이드바 접기(기억)
  const NAVHIDE_KEY='cc_navhidden';
  (function applyNavHidden(){ var on=true; try{ var v=localStorage.getItem(NAVHIDE_KEY); on=(v===null)?true:(v==='1'); }catch(e){} body.classList.toggle('cc-navhidden', !!on); })();
  function toggleNavHidden(){ var on=body.classList.toggle('cc-navhidden'); try{ localStorage.setItem(NAVHIDE_KEY, on?'1':'0'); }catch(e){} }
  const hb=$('hambBtn'); if(hb) hb.addEventListener('click', e=>{ e.stopPropagation(); if(isMobile()) toggleNavHidden(); else toggleSideDesktop(); });
  const sessBtn=$('sessBtn'); if(sessBtn) sessBtn.addEventListener('click', e=>{ e.stopPropagation(); toggleSide(); });
  const bd=$('sideBackdrop'); if(bd) bd.addEventListener('click', closeMobile);
  if(main) main.addEventListener('click', ()=>{ if(isMobile()) closeMobile(); });
  document.addEventListener('click', e=>{
    if(!isMobile() || !body.classList.contains('side-open')) return;
    if((side&&side.contains(e.target)) || (hb&&hb.contains(e.target))) return;
    closeMobile();
  });
  // 풀스크린(코드 영역 최대화): 헤더+사이드바 숨김
  const fs=$('fsBtn'), fx=$('fsExit');
  const toggleFs=()=>body.classList.toggle('fullscreen-code');
  if(fs) fs.addEventListener('click', toggleFs);
  if(fx) fx.addEventListener('click', toggleFs);
  // 데스크톱 사이드바 너비 드래그 (영속)
  const rz=$('resizer');
  try{ const w=parseInt(localStorage.getItem('stella_cc_sidew')||'',10); if(w>=180&&w<=520&&side) side.style.width=w+'px'; }catch(e){}
  if(rz&&side) rz.addEventListener('mousedown', e=>{
    e.preventDefault(); const sx=e.clientX, sw=side.offsetWidth;
    const mv=ev=>{ side.style.width=Math.max(180,Math.min(520, sw+(ev.clientX-sx)))+'px'; };
    const up=()=>{ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); try{localStorage.setItem('stella_cc_sidew', String(side.offsetWidth));}catch(e){} };
    document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
  });
})();

// ── 모델 드롭다운 ──
(function initModels(){
  const sel = $('model');
  sel.innerHTML = CLAUDE_MODELS.map(m => `<option value="${m.id}">${m.label} — ${m.note}</option>`).join('');
  let saved = null; try { saved = localStorage.getItem(MODEL_KEY); } catch(e){}
  sel.value = (saved && CLAUDE_MODELS.some(m=>m.id===saved)) ? saved : DEFAULT_MODEL;
  sel.addEventListener('change', () => { try { localStorage.setItem(MODEL_KEY, sel.value); } catch(e){} });
})();

// ── 레포 선택기 (Hub와 동일한 /api/github?action=repos) — 에이전트가 작업할 GitHub 레포 인식 ──
// 선택한 레포는 start 시 세션에 github_repository 리소스로 마운트되어 에이전트가 clone/수정/push 한다.
const REPO_KEY = 'stella_cc_repo';
let ccRepos = [];
function selectedRepo(){
  const sel=$('repoSel'); if(!sel||!sel.value) return null;
  const r=ccRepos.find(x=>(x.owner+'/'+x.name)===sel.value);
  return r ? { full:r.owner+'/'+r.name, owner:r.owner, name:r.name, branch:r.default_branch||'main' } : null;
}
async function loadCcRepos(){
  const sel=$('repoSel'); if(!sel) return;
  try{
    const r=await fetch('/api/github?action=repos'); const d=await r.json();
    if(!d||!d.ok||!Array.isArray(d.repos)) throw new Error((d&&d.message)||'repos 로드 실패');
    ccRepos=d.repos;
    let saved=null; try{ saved=localStorage.getItem(REPO_KEY); }catch(e){}
    let def='';
    if(saved && ccRepos.some(x=>(x.owner+'/'+x.name)===saved)) def=saved;
    else { const z=ccRepos.find(x=>/^0program$/i.test(x.name)); if(z) def=z.owner+'/'+z.name; else if(ccRepos[0]) def=ccRepos[0].owner+'/'+ccRepos[0].name; }
    sel.innerHTML='<option value="">레포 없음(빈 샌드박스)</option>'+ccRepos.map(x=>{
      const full=x.owner+'/'+x.name;
      return '<option value="'+esc(full)+'"'+(full===def?' selected':'')+'>'+esc(full)+(x.private?' [비공개]':'')+'</option>';
    }).join('');
    if(def){ try{ localStorage.setItem(REPO_KEY, def); }catch(e){} }
    sel.addEventListener('change',()=>{ try{ localStorage.setItem(REPO_KEY, sel.value); }catch(e){} });
  }catch(e){ sel.innerHTML='<option value="">레포 목록 실패(빈 샌드박스로 진행)</option>'; }
}
loadCcRepos();

// ── VFF 토글 (cc.html: Claude 전용이므로 항상 표시) ──
// 이 파일은 module 이라 여기 선언은 전역이 아니다. 예전엔 cc.html 이
// onchange="onCcVffChange(this.checked)" 인라인 속성으로 함수를 불렀는데,
// 인라인 핸들러의 스코프 체인(element→form→document→window)에는 module 스코프가 없어
// 매 토글마다 ReferenceError 가 났고 선택이 저장되지 않았다 → addEventListener 로 바인딩한다.
// 읽기/쓰기 로직은 claude.client.js 의 공유 헬퍼를 쓴다(gpt/abap/cc 에 같은 코드가 흩어져 있었음).
(function initCcVff(){
  const t=$('ccVffToggle');
  if(!t) return;
  t.checked=getVffEnabled();
  t.addEventListener('change', (e)=>setVffEnabled(e.target.checked));
})();

// ── OMC(oh-my-claudecode) 멀티에이전트 모드 토글 (영속) ──
(function initOmc(){
  const cb = $('omc');
  try { cb.checked = localStorage.getItem('stella_cc_omc') === '1'; } catch(e){}
  cb.addEventListener('change', () => { try { localStorage.setItem('stella_cc_omc', cb.checked ? '1' : '0'); } catch(e){} });
})();

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function setStatus(html){ $('status').innerHTML = html || ''; }

// C2: 작업 결과 전문을 Google Drive(StellaGPT/0Program)에 {앱명}_{YYYYMMDD_HHMMSS}.txt로 자동 저장 + 토스트.
function showToast(msg, ok){
  const t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:'+(ok?'var(--ok,#1a7f37)':'var(--err,#b91c1c)')+';color:#fff;padding:9px 16px;border-radius:10px;font-size:.85rem;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:80vw;word-break:break-all';
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.transition='opacity .4s'; t.style.opacity='0'; setTimeout(()=>t.remove(),400); }, 2600);
}
async function saveResultToDrive(app, header, text, ext){
  if(!text || !String(text).trim()) return;
  try{
    const r=await fetch('/api/cc/save-drive',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ app:app||'StellaAgentCode', programName:((typeof cur!=='undefined'&&cur&&cur.title)||header), header:header, text:text, ext:(ext||'') })});
    const d=await r.json().catch(()=>({ok:false}));
    if(r.ok && d.ok){ const gh=d.github&&d.github.saved?'· 0Program ✓':(d.github?'· 0Program✗('+(d.github.reason||'')+')':''); showToast('Drive 저장 ✓ '+(d.name||'')+' '+gh, true); }
    else showToast('Drive 저장 실패: '+((d&&(d.message||d.error))||('HTTP '+r.status)), false);
  }catch(e){ showToast('Drive 저장 오류: '+(e&&e.message?e.message:e), false); }
}

function addUserBubble(text, attCount){
  const d = document.createElement('div'); d.className='bubble user'; d.textContent = text;
  if(attCount>0){ const b=document.createElement('div'); b.className='lbl'; b.style.marginTop='4px'; b.textContent='📎 이미지 '+attCount+'개 첨부'; d.appendChild(b); }
  const m=$('msgs'); const empty=m.querySelector('.empty'); if(empty) empty.remove();
  m.appendChild(d); m.scrollTop=m.scrollHeight;
}

// 이미지 첨부: base64 콘텐츠 블록으로 /api/cc/start|turn 에 전달. Vercel 본문 한도 보호용 개당 3.5MB 상한.
let pendingAtt=[];
const ATT_MAX=3.5*1024*1024;
// 첨부 인코딩 레이스 방지: 진행 중이면 전송 비활성 + "이미지 처리 중…", whenReady로 전송 전 대기.
let _ccRunning=false; // 세션 실행 중 여부(setUIBusy와 인코딩 상태 조율)
const attEnc = (window.makeAttachEncoder ? window.makeAttachEncoder(updateAttachBusy) : { encode:(f)=>window.readFileAsDataURL(f), pendingCount:()=>0, whenReady:()=>Promise.resolve() });
function updateAttachBusy(n){
  const sb=$('sendBtn'); if(sb) sb.disabled = _ccRunning || n>0;
  if(n>0) setStatus('이미지 처리 중…');
  else if(!_ccRunning) setStatus('');
}
function renderAttStrip(){
  const s=$('attachStrip'); if(!s) return;
  if(!pendingAtt.length){ s.style.display='none'; s.innerHTML=''; return; }
  s.style.display='flex';
  s.innerHTML=pendingAtt.map((a,i)=>'<span class="lbl" style="border:1px solid var(--line);border-radius:10px;padding:3px 8px">📎 '+esc(a.name)+' <a href="#" data-i="'+i+'" class="attDel" style="color:var(--err,#c00);text-decoration:none">✕</a></span>').join('');
  s.querySelectorAll('.attDel').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();pendingAtt.splice(+el.dataset.i,1);renderAttStrip();}));
}
function addFiles(files){
  for(const f of files){
    if(!f || !/^image\//.test(f.type)) continue;
    if(f.size>ATT_MAX){ setStatus('<span class="err">'+esc(f.name)+': 이미지가 3.5MB를 초과해 건너뜀</span>'); continue; }
    // base64 인코딩을 Promise로 await 가능하게 → onload 완료 후에만 pendingAtt에 적재(레이스 차단).
    attEnc.encode(f).then(s=>{ const i=s.indexOf(','); if(i<0) return; pendingAtt.push({ name:f.name||'image', media_type:f.type, data:s.slice(i+1) }); renderAttStrip(); })
      .catch(()=>{ setStatus('<span class="err">'+esc(f.name)+': 이미지 읽기 실패</span>'); });
  }
}

// 진행 렌더: 같은 run을 한 컨테이너에 다시 그림
function renderRun(run){
  let host = cur._host;
  if(!host){ host=document.createElement('div'); host.className='bubble'; $('msgs').appendChild(host); cur._host=host; }
  const toolIcon = (n) => n==='bash' ? '🔧' : (n==='write'||n==='str_replace'||n==='edit' ? '✏️' : (n==='read'||n==='view' ? '📄' : '🛠️'));
  let html = '';
  for(const t of run.tools){
    const inp = t.input!=null ? esc(JSON.stringify(t.input)).slice(0,160) : '';
    html += `<div class="step"><span class="nm"><span class="mi">${toolIcon(t.name)}</span> ${esc(t.name)}</span> ${inp}` +
            (t.result!=null ? `<span class="rs">${esc(typeof t.result==='string'?t.result:JSON.stringify(t.result)).slice(0,800)}</span>`:'') + `</div>`;
  }
  host.innerHTML = html;
  // 답변(프로그램)에 복사 단추: 코드펜스는 블록별 복사, 펜스 없으면 답변 전체 복사 단추 1개.
  if(run.text){
    const ans=document.createElement('div'); ans.className='answer';
    if(window.renderCodeWithCopy){ window.renderCodeWithCopy(ans, run.text); } else { ans.textContent=run.text; }
    if(window.ccCopyText && !ans.querySelector('pre')){
      ans.style.position='relative';
      const cb=document.createElement('button'); cb.type='button'; cb.className='code-copy-btn'; cb.textContent='복사'; cb.setAttribute('data-label','복사');
      const _txt=run.text; cb.addEventListener('click',function(e){ e.preventDefault(); window.ccCopyText(_txt||'', cb); });
      ans.appendChild(cb);
    }
    host.appendChild(ans);
  }
  $('msgs').scrollTop = $('msgs').scrollHeight;
}

async function poll(){
  if(!cur || cur.stopped) return;
  try{
    const r = await fetch('/api/cc/events?session='+encodeURIComponent(cur.sessionId)+'&after='+cur.run.cursor);
    const d = await r.json();
    if(d.events && d.events.length) cur.run.ingest(d.events);
    renderRun(cur.run);
    if(d.cost!=null) setStatus(`상태: ${cur.run.status} · 비용 약 $${Number(d.cost).toFixed(3)}${d.budget?(' / $'+Number(d.budget).toFixed(2)):''}`);
    if(cur.run.done){ return finish(); }
    cur.attempt++;
    cur._timer = setTimeout(poll, nextDelayMs(cur.attempt));
  }catch(e){
    cur.attempt++;
    if(cur.attempt>8){ setStatus('<span class="err">이벤트 폴링 실패: '+esc(e.message)+'</span>'); finish(true); return; }
    cur._timer = setTimeout(poll, nextDelayMs(cur.attempt));
  }
}

async function finish(failed){
  setUIBusy(false);
  const run = cur.run;
  if(run.status==='error') setStatus('<span class="err">종료: '+esc(run.error||'error')+'</span>');
  else setStatus('<span class="ok">완료 ✓</span>');
  // 트랜스크립트 Drive 저장 (best-effort)
  if(!failed){
    const md = buildTranscript({ title:cur.title, model:cur.model, prompt:cur.prompt, run });
    try{
      await fetch('/api/cc/save',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ session:cur.sessionId, markdown:md, title:cur.title, status:run.status })});
    }catch(e){}
    // PART B: 세션 완료 시 산출물 GitHub 자동 저장 (best-effort) + 수동 버튼 노출
    if(cur && cur.sessionId){ $('saveGhBtn').style.display=''; saveToGithub(true); }
    // C2: 결과 전문(.txt)도 StellaGPT/0Program에 자동 저장
    if(!window.shouldSaveSource||window.shouldSaveSource(md)) saveResultToDrive('StellaAgentCode', cur.prompt, md); // 소스 가드 통과 시에만 0Program 자동 저장
  }
  loadSessions();
}

// PART B: 세션 산출물을 Google Drive(StellaGPT/0Program)에 저장 (비공개) — auto/수동 공용
async function saveToGithub(auto){
  if(!cur || !cur.sessionId){ if(!auto) setStatus('<span class="err">세션이 없습니다</span>'); return; }
  const btn=$('saveGhBtn'); const prev=btn.textContent; btn.disabled=true; btn.textContent='저장 중…';
  try{
    const body={session:cur.sessionId};
    if(cur.program0Path) body.programPath=cur.program0Path; // 0Program #해시로 불러온 세션 — 매 턴 원경로로 되저장
    const r=await fetch('/api/cc/save-drive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.ok){
      const gh = d.github ? (d.github.saved ? ' · 0Program ✓' : ' · 0Program✗('+(d.github.reason||'')+')') : '';
      setStatus('<span class="ok">Drive 저장 ✓ '+(d.saved||0)+'개 파일'+gh+'</span>'+(d.folderLink?(' · <a href="'+esc(d.folderLink)+'" target="_blank" rel="noopener">폴더 열기</a>'):''));
    }
    else if(!auto){ setStatus('<span class="err">Drive 저장 실패: '+esc(d.message||d.error||'')+'</span>'); }
  }catch(e){ if(!auto) setStatus('<span class="err">Drive 저장 오류: '+esc(e.message)+'</span>'); }
  finally{ btn.disabled=false; btn.textContent=prev; }
}

function setUIBusy(busy){
  _ccRunning = busy;
  $('sendBtn').disabled = busy || (attEnc && attEnc.pendingCount()>0); // 인코딩 중이면 계속 비활성
  $('cancelBtn').style.display = busy ? 'block' : 'none';
  $('model').disabled = busy; $('budget').disabled = busy;
}

async function send(){
  const text = $('prompt').value.trim();
  // 첨부 인코딩이 끝날 때까지 대기 → base64 누락 없이 전송(레이스 방지).
  if(attEnc && attEnc.pendingCount()>0){ setStatus('이미지 처리 중…'); await attEnc.whenReady(); }
  const att = pendingAtt.slice().filter(a=>a && a.data); // base64 빈 항목 제외(가드)
  if(!text && !att.length) return;
  $('prompt').value=''; $('prompt').style.height='';
  pendingAtt=[]; renderAttStrip();
  const model = $('model').value;
  const budgetUsd = Math.max(0.01, Math.min(Number($('budget').value)||20, 50));

  if(cur && !cur.run.done){ return; } // 진행 중이면 무시(중단 후)
  addUserBubble(text, att.length);
  setUIBusy(true); setStatus('시작 중…');

  if(cur && cur.sessionId && cur.run && cur.run.done){
    // 같은 세션 후속 턴
    cur.run = new AgentRun(); cur.attempt=0; cur.stopped=false; cur._host=null; cur.prompt=text;
    try{
      const r=await fetch('/api/cc/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:cur.sessionId,prompt:text,attachments:att})});
      const d=await r.json(); if(!r.ok||d.error) throw new Error(d.message||d.error||'turn 실패');
      poll();
    }catch(e){ setStatus('<span class="err">'+esc(e.message)+'</span>'); setUIBusy(false); }
    return;
  }
  // 신규 세션
  cur = { sessionId:null, model, budgetUsd, title:text.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim().slice(0,60), run:new AgentRun(), attempt:0, polling:true, stopped:false, prompt:text, program0Path:pending0ProgramPath };
  pending0ProgramPath = null; // 이번 세션에 이관 완료 — 다음 신규 세션에 잘못 붙지 않도록 소비
  try{
    const rp=selectedRepo();
    const r=await fetch('/api/cc/start',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ model, prompt:text, title:cur.title, budgetUsd, omc: $('omc').checked, vff: getVffEnabled(), attachments:att, repo: rp?rp.full:undefined, branch: rp?rp.branch:undefined })});
    const d=await r.json(); if(!r.ok||d.error) throw new Error(d.message||d.error||'start 실패');
    cur.sessionId=d.sessionId; cur.model=d.model; cur.budgetUsd=d.budgetUsd;
    const repoTag = d.repoMounted ? (' · 📁 '+esc(d.repo))
      : (d.repoMountError ? (' · ⚠️'+esc(d.repoMountError)) : (rp?' · ⚠️레포 미마운트(빈 샌드박스)':''));
    setStatus('세션 '+d.sessionId.slice(0,12)+'… 진행 중'+repoTag); poll();
  }catch(e){ setStatus('<span class="err">'+esc(e.message)+'</span>'); setUIBusy(false); cur=null; }
}

async function cancel(){
  if(!cur || !cur.sessionId) return;
  setStatus('중단 요청…');
  try{ await fetch('/api/cc/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:cur.sessionId})}); }catch(e){}
}

async function loadSessions(){
  try{
    const r=await fetch('/api/cc/sessions'); const d=await r.json();
    const items=d.items||[];
    const host=$('sessionList');
    if(!items.length){ host.innerHTML='<div class="lbl" style="padding:8px">세션 없음</div>'; return; }
    host.innerHTML=items.map(x=>`<div class="sitem" data-id="${esc(x.id)}" data-model="${esc(x.model)}" data-title="${esc(x.title)}">
      <div class="t">${esc(x.title||'세션')}</div>
      <div class="m">${esc(x.model||'')} · ${esc(x.status||'')}${x.cost_usd?(' · $'+Number(x.cost_usd).toFixed(3)):''}</div></div>`).join('');
    host.querySelectorAll('.sitem').forEach(el=>el.addEventListener('click',()=>resume(el.dataset.id, el.dataset.model, el.dataset.title)));
    filterSessionList(); // 검색어가 입력된 채로 새로고침돼도 필터 유지
  }catch(e){ $('sessionList').innerHTML='<div class="lbl" style="padding:8px">목록 로드 실패</div>'; }
}

function resume(id, model, title){
  if(cur && cur._timer) clearTimeout(cur._timer);
  $('msgs').innerHTML='';
  cur = { sessionId:id, model:model||DEFAULT_MODEL, title:title||'세션', run:new AgentRun(), attempt:0, stopped:false, prompt:'(재개)' };
  $('saveGhBtn').style.display=''; // 재개 세션도 수동 GitHub 저장 가능
  setUIBusy(true); setStatus('세션 재개 — 이벤트 로드 중…'); poll();
}

// ── 입력: Enter 전송 / Shift+Enter 줄바꿈 / IME 보호 / 모바일 줄바꿈 ──
$('prompt').addEventListener('keydown', function(e){
  if(e.key==='Enter'||e.keyCode===13){
    if(e.isComposing||e.keyCode===229) return;
    if(e.shiftKey) return;
    const coarse=(window.matchMedia&&window.matchMedia('(pointer: coarse)').matches);
    if(coarse) return; // 모바일: 줄바꿈, 전송은 버튼
    e.preventDefault(); send();
  }
});
$('prompt').addEventListener('input',function(){ this.style.height='auto'; this.style.height=Math.min(this.scrollHeight,160)+'px'; });
$('sendBtn').addEventListener('click', send);
$('cancelBtn').addEventListener('click', cancel);
$('attachBtn').addEventListener('click', ()=>$('attachInput').click());
$('attachInput').addEventListener('change', e=>{ addFiles(e.target.files); e.target.value=''; });
$('prompt').addEventListener('paste', e=>{ const items=(e.clipboardData&&e.clipboardData.items)||[]; const imgs=[]; for(const it of items){ if(it.kind==='file'){ const f=it.getAsFile(); if(f&&/^image\//.test(f.type)) imgs.push(f); } } if(imgs.length){ e.preventDefault(); addFiles(imgs); } });
$('refreshBtn').addEventListener('click', loadSessions);
// 세션 검색 — 개발한 프로그램을 제목/모델/상태 텍스트로 빠르게 찾기(순수 클라이언트 필터)
function filterSessionList(){
  const q=($('sessSearch').value||'').trim().toLowerCase();
  $('sessionList').querySelectorAll('.sitem').forEach(el=>{
    el.style.display = (!q || (el.textContent||'').toLowerCase().includes(q)) ? '' : 'none';
  });
}
$('sessSearch').addEventListener('input', filterSessionList);
$('saveGhBtn').addEventListener('click', () => saveToGithub(false));

loadSessions();
if('serviceWorker' in navigator){ navigator.serviceWorker.register('/sw.js').catch(function(){}); }

// 0Program(GitHub) 소스 불러오기 — URL #ZAQMR0100 형태로 진입 시 자동 로드.
// 기존 /api/cc/save-drive의 action:'load-github'(0Program 전용, 서버측 GITHUB_TOKEN 재사용) 그대로 사용.
// 로드된 원경로는 pending0ProgramPath에 보관 → 다음 신규 세션에 이관되어 매 턴 자동으로 같은 경로에 되저장됨.
let pending0ProgramPath = null;
async function load0Program(programName){
  const name = String(programName||'').trim();
  if(!name) return;
  pending0ProgramPath = null; // 이전 로드의 잔여 경로가 실패/다른 파일 로드에 잘못 이관되지 않도록 매번 초기화
  setStatus('0Program 불러오는 중… '+esc(name));
  try{
    const r = await fetch('/api/cc/save-drive', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'load-github', programName:name, ext:'abap' }) });
    const d = await r.json();
    if(d.ok && d.exists){
      const fileBase = (d.path||'').split('/').pop() || (name+'.abap');
      pending0ProgramPath = d.path || null;
      const instruction = '[0Program 파일: '+fileBase+'] 아래 소스를 요청에 따라 수정한 뒤, 반드시 정확히 이 파일명으로 저장(작성)하세요: '+fileBase+'\n\n';
      const promptVal = $('prompt').value;
      $('prompt').value = (promptVal ? promptVal+'\n\n' : '') + instruction + d.text;
      $('prompt').dispatchEvent(new Event('input'));
      setStatus('<span class="ok">0Program 로드 ✓ '+esc(d.path||name)+'</span>');
    } else if(d.ok){
      setStatus('<span class="err">0Program에 해당 파일 없음: '+esc(name)+'</span>');
    } else {
      setStatus('<span class="err">0Program 로드 실패: '+esc(d.message||d.reason||'')+'</span>');
    }
  }catch(e){ setStatus('<span class="err">0Program 로드 오류: '+esc(e.message)+'</span>'); }
}
window.addEventListener('hashchange', ()=>{ const n=decodeURIComponent(location.hash.slice(1)); if(n) load0Program(n); });
if(location.hash) load0Program(decodeURIComponent(location.hash.slice(1)));
