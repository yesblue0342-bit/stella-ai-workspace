const fs = require('fs');

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
const before = s;

s = s.replace(/<!-- stella-fixed-[^>]*-->/, '<!-- stella-fixed-2026-06-13-clean-download-table-ocr-sidebar-v3 -->');

// 1) 검색 선택 UI는 제거하고, 백엔드는 자동 검색값만 보낸다.
s = s.replace(/<span>검색<\/span><select id="searchProviderSelect">[\s\S]*?<\/select>/g, '');

// 2) 로그인은 로그아웃 전까지 유지한다.
s = s.replace(/\/\* persistent-login-fix \*\/[\s\S]*?\/\* \/persistent-login-fix \*\//, [
  '/* persistent-login-fix */',
  'function nowMs(){return Date.now()}',
  'function saveSessionUser(u){write(K.session,{id:u.id,user:u,savedAt:nowMs()})}',
  'function loadSessionUser(){const ss=read(K.session,null);if(!ss||!ss.id)return null;const list=allUsers();return list.find(u=>u.id===ss.id)||ss.user||null}',
  '/* /persistent-login-fix */'
].join('\n'));

// 3) CSS 보강 블록은 중복 제거 후 1회만 삽입한다.
s = s.replace(/\/\* stella-rich-render-fix \*\/[\s\S]*?\/\* \/stella-rich-render-fix \*\//g, '');
const cssFix = [
  '/* stella-rich-render-fix */',
  '.bubble table{width:100%;border-collapse:collapse;margin:12px 0;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:.94rem}.bubble th,.bubble td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top}.bubble th{background:#f8fafc;font-weight:900}.bubble pre{background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:12px;overflow:auto;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.86rem;margin:10px 0}.bubble h1,.bubble h2,.bubble h3{margin:16px 0 8px;line-height:1.35}.bubble ul,.bubble ol{margin:8px 0 12px 24px}.download-tools:empty{display:none}.download-tools{margin:0 0 12px}.side-search-wrap{display:flex;gap:6px;align-items:center;padding:10px 16px 4px}.side-search-wrap .side-search{width:100%;margin:0}.search-icon-btn{width:42px;height:42px;border:1px solid #d1d5db;border-radius:14px;background:#fff;font-weight:900}',
  '@media(min-width:901px){.app.sidebar-collapsed{grid-template-columns:minmax(0,1fr)!important}.app.sidebar-collapsed .sidebar{display:none!important}.app.sidebar-collapsed .main{grid-column:1 / -1;width:100%}.hamb{display:grid!important;place-items:center!important}.sidebar{transform:none!important;position:relative!important;width:auto!important;max-width:none!important;box-shadow:none!important}.app.sidebar-collapsed .sidebar{display:none!important}}',
  '/* /stella-rich-render-fix */'
].join('\n');
s = s.replace('</style>', cssFix + '\n</style>');

// 4) 게시판 검색 입력창 보강.
s = s.replace('<input class="side-search" id="sideSearch" placeholder="게시글/채팅 검색">', '<div class="side-search-wrap"><input class="side-search" id="sideSearch" placeholder="게시글/회의록/채팅 검색"><button class="search-icon-btn" id="sideSearchBtn" type="button">⌕</button></div>');

// 5) 모델 목록 / 자동검색 함수 블록을 통째로 정상화한다. 기존 깨진 formatSearchReferences까지 제거된다.
const modelSearchBlock = String.raw`function ensureModelOptions(){const sel=$('#modelSelect');if(!sel)return;const cur=sel.value||'gpt-5.5';sel.innerHTML='<optgroup label="ChatGPT / OpenAI"><option value="gpt-5.5-pro">GPT-5.5 Pro 최고성능</option><option value="gpt-5.5">GPT-5.5 최신</option><option value="gpt-4.1">GPT-4.1 호환</option><option value="gpt-4.1-mini">GPT-4.1 Mini 빠른 응답</option><option value="gpt-4o">GPT-4o 호환</option><option value="gpt-4o-mini">GPT-4o Mini 빠른 응답</option></optgroup><optgroup label="Claude"><option value="claude-opus-4-8">Claude Opus 4.8 고성능</option><option value="claude-sonnet-4-6">Claude Sonnet 4.6 균형</option><option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 빠른 응답</option><option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet 호환</option></optgroup>';if([...sel.options].some(o=>o.value===cur))sel.value=cur;else sel.value='gpt-5.5'}
function getSearchConfig(){return{search:'auto',searchProvider:'auto',searchType:'auto'}}
function formatSearchReferences(results){if(!Array.isArray(results)||!results.length)return'';return '\n\n참고 검색 결과\n'+results.slice(0,5).map(function(r,i){return '['+(i+1)+'] '+(r.title||'제목 없음')+'\n'+(r.link||'')+'\n'+(r.snippet||'')}).join('\n\n')}
`;
if (/function ensureModelOptions\(\)[\s\S]*?function initEvents\(\)/.test(s)) {
  s = s.replace(/function ensureModelOptions\(\)[\s\S]*?function initEvents\(\)/, modelSearchBlock + 'function initEvents()');
} else if (/function getSearchConfig\(\)[\s\S]*?function initEvents\(\)/.test(s)) {
  s = s.replace(/function getSearchConfig\(\)[\s\S]*?function initEvents\(\)/, modelSearchBlock + 'function initEvents()');
} else {
  s = s.replace('function initEvents()', modelSearchBlock + 'function initEvents()');
}

// 6) API payload에 자동검색 옵션을 포함한다.
s = s.replace("body:JSON.stringify({model:$('#modelSelect').value,message:(msg||'첨부 파일을 분석해줘')+fileText,history,system})", "body:JSON.stringify({model:$('#modelSelect').value,message:(msg||'첨부 파일을 분석해줘')+fileText,history,system,...getSearchConfig()})");
s = s.replace("addMessage('ai',data.text||data.answer||data.message||'응답 없음',true)", "const answerText=(data.text||data.answer||data.message||'응답 없음')+formatSearchReferences(data.searchResults);addMessage('ai',answerText,true)");

// 7) 다운로드/표 렌더링 override는 중복 제거 후 정상 버전으로 1회만 삽입한다.
s = s.replace(/\/\* stella-rich-answer-download-override \*\/[\s\S]*?\/\* \/stella-rich-answer-download-override \*\//g, '');
const richOverride = String.raw`
/* stella-rich-answer-download-override */
function lastUserPrompt(){const r=activeRoom&&activeRoom();const arr=(r&&r.messages)||[];for(let i=arr.length-1;i>=0;i--){if(arr[i].role==='user')return String(arr[i].text||'')}const el=document.querySelector('#chatInput');return String((el&&el.value)||'')}
function wantsDownload(){return /(다운로드|엑셀|excel|xlsx|word|docx|ppt|pptx|파워포인트|txt|텍스트|markdown|md|파일로|첨부파일로|저장)/i.test(lastUserPrompt())}
function mdEscapeHtml(x){return String(x==null?'':x).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
function parseMarkdownTables(text){const lines=String(text||'').split('\n');const blocks=[];let i=0;while(i<lines.length){if(/^\s*\|.+\|\s*$/.test(lines[i]||'')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1]||'')){const start=i;let rows=[lines[i]];i+=2;while(i<lines.length&&/^\s*\|.+\|\s*$/.test(lines[i]||'')){rows.push(lines[i]);i++}blocks.push({start:start,end:i,rows:rows})}else{i++}}return blocks}
function splitTableRow(line){let t=String(line||'').trim();if(t.startsWith('|'))t=t.slice(1);if(t.endsWith('|'))t=t.slice(0,-1);return t.split('|').map(function(x){return x.trim()})}
function tableRowsFromText(text){const blocks=parseMarkdownTables(text);if(blocks[0])return blocks[0].rows.map(splitTableRow);return []}
function renderMarkdownLite(container,text){const src=String(text||'');const blocks=parseMarkdownTables(src);let pos=0;function addParas(chunk){chunk.split(/\n{2,}/).map(function(x){return x.trim()}).filter(Boolean).forEach(function(part){if(/^###\s+/.test(part)){const h=document.createElement('h3');h.textContent=part.replace(/^###\s+/,'');container.appendChild(h);return}if(/^##\s+/.test(part)){const h=document.createElement('h2');h.textContent=part.replace(/^##\s+/,'');container.appendChild(h);return}const p=document.createElement('p');p.textContent=part;container.appendChild(p)})}blocks.forEach(function(b){addParas(src.split('\n').slice(pos,b.start).join('\n'));const table=document.createElement('table');const rows=b.rows.map(splitTableRow);rows.forEach(function(r,idx){const tr=document.createElement('tr');r.forEach(function(cell){const el=document.createElement(idx===0?'th':'td');el.textContent=cell;tr.appendChild(el)});table.appendChild(tr)});container.appendChild(table);pos=b.end});addParas(src.split('\n').slice(pos).join('\n'))}
function downloadBlobFile(name,content,mime){const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){a.remove();URL.revokeObjectURL(url)},1000)}
function downloadXlsxFromText(name,text){const rows=tableRowsFromText(text);if(window.XLSX&&rows.length){const ws=XLSX.utils.aoa_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Stella');XLSX.writeFile(wb,name);return}downloadBlobFile(name.replace(/\.xlsx$/,'.csv'),String(text||''),'text/csv;charset=utf-8')}
function downloadDocFromText(name,text){const html='<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:Arial, sans-serif;line-height:1.7;white-space:pre-wrap">'+mdEscapeHtml(text)+'</body></html>';downloadBlobFile(name,html,'application/msword;charset=utf-8')}
function downloadPptFromText(name,text){const html='<!doctype html><html><head><meta charset="utf-8"></head><body><section style="font-family:Arial, sans-serif;font-size:24px;line-height:1.6;white-space:pre-wrap">'+mdEscapeHtml(text)+'</section></body></html>';downloadBlobFile(name,html,'application/vnd.ms-powerpoint;charset=utf-8')}
function renderAnswer(el,text){const stamp=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);if(wantsDownload()){const tools=document.createElement('div');tools.className='download-tools';tools.append(btn('TXT',function(){downloadBlobFile('stella-answer-'+stamp+'.txt',text,'text/plain;charset=utf-8')}));tools.append(btn('Excel',function(){downloadXlsxFromText('stella-answer-'+stamp+'.xlsx',text)}));tools.append(btn('Word',function(){downloadDocFromText('stella-answer-'+stamp+'.doc',text)}));tools.append(btn('PPT',function(){downloadPptFromText('stella-answer-'+stamp+'.ppt',text)}));tools.append(btn('Markdown',function(){downloadBlobFile('stella-answer-'+stamp+'.md',text,'text/markdown;charset=utf-8')}));el.appendChild(tools)}renderMarkdownLite(el,text)}
/* /stella-rich-answer-download-override */
`;
s = s.replace("window.addEventListener('resize',syncSidebarLayout);", richOverride + "\nwindow.addEventListener('resize',syncSidebarLayout);");

// 8) 시스템 프롬프트 보강.
s = s.replace("const system='당신은 Stella GPT입니다. 사용자 주제를 홈페이지로 제한하지 말고, SAP/ABAP/개발/문서/이미지/OCR/일반 질문에 성의 있고 실무적으로 답하세요.';", "const system='당신은 Stella GPT입니다. 사용자 주제를 홈페이지로 제한하지 말고 SAP/ABAP/개발/문서/이미지/OCR/일반 질문에 실무적으로 답하세요. 사용자가 표/테이블/엑셀을 요청하면 반드시 Markdown 표로 정리하세요. 이미지 OCR 텍스트가 첨부되면 그 내용을 기반으로 요약/분석하세요. 다운로드는 프론트엔드가 처리하므로 답변에는 표와 내용만 명확하게 작성하세요.';");

// 9) 게시판 검색 버튼 이벤트와 PC/모바일 사이드바 정리.
s = s.replace("$('#sideSearch').addEventListener('input',()=>{renderBoardTree()});", "$('#sideSearch').addEventListener('input',()=>{renderBoardTree()});$('#sideSearchBtn')?.addEventListener('click',()=>{renderBoardTree();openSidebar();});");
s = s.replace(/function syncSidebarLayout\(\)\{[\s\S]*?\}\nwindow\.addEventListener\('resize',syncSidebarLayout\);/, "function syncSidebarLayout(){const app=$('#app'),sb=$('#sidebar'),b=$('#sidebarBackdrop');if(isMobileView()){app?.classList.remove('sidebar-collapsed');sb?.classList.remove('open');b?.classList.remove('active');document.body.classList.remove('sidebar-open')}else{b?.classList.remove('active');sb?.classList.remove('open');document.body.classList.remove('sidebar-open')}}\nwindow.addEventListener('resize',syncSidebarLayout);");
s = s.replace("window.addEventListener('DOMContentLoaded',()=>{initEvents();initAuth();syncSidebarLayout()});", "window.addEventListener('DOMContentLoaded',()=>{ensureModelOptions();initEvents();initAuth();syncSidebarLayout()});");
s = s.replace("window.addEventListener('DOMContentLoaded',()=>{ensureModelOptions?.();initEvents();initAuth();syncSidebarLayout()});", "window.addEventListener('DOMContentLoaded',()=>{ensureModelOptions();initEvents();initAuth();syncSidebarLayout()});");

if (s !== before) {
  fs.writeFileSync(file, s, 'utf8');
  console.log('patched index.html clean downloads/table/ocr/sidebar v3');
} else {
  console.log('no changes');
}
