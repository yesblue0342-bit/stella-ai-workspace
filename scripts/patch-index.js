const fs = require('fs');
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
const before = s;

s = s.replace(/<!-- stella-fixed-[^>]*-->/, '<!-- stella-fixed-2026-06-13-v6-excel-download-link -->');

const modelBlock = [
"function ensureModelOptions(){const sel=$('#modelSelect');if(!sel)return;const cur=sel.value||'gpt-5.5';sel.innerHTML='<optgroup label=\"ChatGPT / OpenAI\"><option value=\"gpt-5.5-pro\">GPT-5.5 Pro 최고성능</option><option value=\"gpt-5.5\">GPT-5.5 최신</option><option value=\"gpt-4.1\">GPT-4.1 호환</option><option value=\"gpt-4.1-mini\">GPT-4.1 Mini 빠른 응답</option><option value=\"gpt-4o\">GPT-4o 호환</option><option value=\"gpt-4o-mini\">GPT-4o Mini 빠른 응답</option></optgroup><optgroup label=\"Claude\"><option value=\"claude-opus-4-8\">Claude Opus 4.8 고성능</option><option value=\"claude-sonnet-4-6\">Claude Sonnet 4.6 균형</option><option value=\"claude-haiku-4-5-20251001\">Claude Haiku 4.5 빠른 응답</option><option value=\"claude-3-5-sonnet-20241022\">Claude 3.5 Sonnet 호환</option></optgroup>';if([...sel.options].some(o=>o.value===cur))sel.value=cur;else sel.value='gpt-5.5'}",
"function getSearchConfig(){return{search:'auto',searchProvider:'auto',searchType:'auto'}}",
"function formatSearchReferences(results){if(!Array.isArray(results)||!results.length)return'';return '\\n\\n참고 검색 결과\\n'+results.slice(0,5).map(function(r,i){return '['+(i+1)+'] '+(r.title||'제목 없음')+'\\n'+(r.link||'')+'\\n'+(r.snippet||'')}).join('\\n\\n')}"
].join('\n');

s = s.replace(/function ensureModelOptions\(\)[\s\S]*?function initEvents\(\)/, modelBlock + '\nfunction initEvents()');
s = s.replace(/function getSearchConfig\(\)[\s\S]*?function initEvents\(\)/, modelBlock + '\nfunction initEvents()');

s = s.replace(/\/\* stella-rich-answer-download-override \*\/[\s\S]*?\/\* \/stella-rich-answer-download-override \*\//g, '');
const rich = [
'/* stella-rich-answer-download-override */',
"function lastUserPrompt(){const r=activeRoom&&activeRoom();const arr=(r&&r.messages)||[];for(let i=arr.length-1;i>=0;i--){if(arr[i].role==='user')return String(arr[i].text||'')}const el=document.querySelector('#chatInput');return String((el&&el.value)||'')}",
"function wantsDownload(){return /(다운로드|다운받|내려받|파일|엑셀|excel|xlsx|word|docx|ppt|pptx|파워포인트|txt|텍스트|markdown|md|파일로|첨부파일로|저장)/i.test(lastUserPrompt())}",
"function mdEscapeHtml(x){return String(x==null?'':x).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}",
"function parseMarkdownTables(text){const lines=String(text||'').split('\\n');const blocks=[];let i=0;while(i<lines.length){if(/^\\s*\\|.+\\|\\s*$/.test(lines[i]||'')&&i+1<lines.length&&/^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$/.test(lines[i+1]||'')){const start=i;let rows=[lines[i]];i+=2;while(i<lines.length&&/^\\s*\\|.+\\|\\s*$/.test(lines[i]||'')){rows.push(lines[i]);i++}blocks.push({start:start,end:i,rows:rows})}else{i++}}return blocks}",
"function splitTableRow(line){let t=String(line||'').trim();if(t.startsWith('|'))t=t.slice(1);if(t.endsWith('|'))t=t.slice(0,-1);return t.split('|').map(function(x){return x.trim()})}",
"function tableRowsFromText(text){const blocks=parseMarkdownTables(text);if(blocks[0])return blocks[0].rows.map(splitTableRow);const lines=String(text||'').split('\\n').filter(function(l){return l.indexOf('\\t')>=0});if(lines.length>1)return lines.map(function(l){return l.split('\\t')});return []}",
"function renderMarkdownLite(container,text){const src=String(text||'');const blocks=parseMarkdownTables(src);let pos=0;function addParas(chunk){chunk.split(/\\n{2,}/).map(function(x){return x.trim()}).filter(Boolean).forEach(function(part){if(/^###\\s+/.test(part)){const h=document.createElement('h3');h.textContent=part.replace(/^###\\s+/,'');container.appendChild(h);return}if(/^##\\s+/.test(part)){const h=document.createElement('h2');h.textContent=part.replace(/^##\\s+/,'');container.appendChild(h);return}const p=document.createElement('p');p.textContent=part;container.appendChild(p)})}blocks.forEach(function(b){addParas(src.split('\\n').slice(pos,b.start).join('\\n'));const table=document.createElement('table');const rows=b.rows.map(splitTableRow);rows.forEach(function(r,idx){const tr=document.createElement('tr');r.forEach(function(cell){const el=document.createElement(idx===0?'th':'td');el.textContent=cell;tr.appendChild(el)});table.appendChild(tr)});container.appendChild(table);pos=b.end});addParas(src.split('\\n').slice(pos).join('\\n'))}",
"function blobUrl(content,mime){return URL.createObjectURL(new Blob([content],{type:mime}))}",
"function makeDownloadLink(label,name,url){const a=document.createElement('a');a.className='download-btn';a.href=url;a.download=name;a.textContent=label;a.addEventListener('click',function(){setTimeout(function(){try{URL.revokeObjectURL(url)}catch(e){}},4000)});return a}",
"function xlsxUrlFromText(text){const rows=tableRowsFromText(text);if(window.XLSX&&rows.length){const ws=XLSX.utils.aoa_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Stella');const arr=XLSX.write(wb,{bookType:'xlsx',type:'array'});return {url:URL.createObjectURL(new Blob([arr],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),ext:'xlsx'}}return {url:blobUrl(String(text||''),'text/csv;charset=utf-8'),ext:'csv'}}",
"function downloadBlobFile(name,content,mime){const url=blobUrl(content,mime);const a=makeDownloadLink('',name,url);document.body.appendChild(a);a.click();setTimeout(function(){a.remove()},1000)}",
"function downloadDocFromText(name,text){const html='<!doctype html><html><head><meta charset=\"utf-8\"></head><body style=\"font-family:Arial, sans-serif;line-height:1.7;white-space:pre-wrap\">'+mdEscapeHtml(text)+'</body></html>';downloadBlobFile(name,html,'application/msword;charset=utf-8')}",
"function downloadPptFromText(name,text){const html='<!doctype html><html><head><meta charset=\"utf-8\"></head><body><section style=\"font-family:Arial, sans-serif;font-size:24px;line-height:1.6;white-space:pre-wrap\">'+mdEscapeHtml(text)+'</section></body></html>';downloadBlobFile(name,html,'application/vnd.ms-powerpoint;charset=utf-8')}",
"function renderAnswer(el,text){const stamp=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);if(wantsDownload()){const tools=document.createElement('div');tools.className='download-tools';const xl=xlsxUrlFromText(text);tools.append(makeDownloadLink('📥 Excel 파일 다운로드','stella-answer-'+stamp+'.'+xl.ext,xl.url));tools.append(makeDownloadLink('TXT 다운로드','stella-answer-'+stamp+'.txt',blobUrl(text,'text/plain;charset=utf-8')));tools.append(btn('Word 다운로드',function(){downloadDocFromText('stella-answer-'+stamp+'.doc',text)}));tools.append(btn('PPT 다운로드',function(){downloadPptFromText('stella-answer-'+stamp+'.ppt',text)}));tools.append(makeDownloadLink('Markdown 다운로드','stella-answer-'+stamp+'.md',blobUrl(text,'text/markdown;charset=utf-8')));el.appendChild(tools)}renderMarkdownLite(el,text)}",
'/* /stella-rich-answer-download-override */'
].join('\n');
s = s.replace("window.addEventListener('resize',syncSidebarLayout);", rich + "\nwindow.addEventListener('resize',syncSidebarLayout);");

if (/\^```/.test(s)) throw new Error('unsafe backtick regex remains');
if (/return\{search:'auto',searchProvider:v/.test(s)) throw new Error('broken search config remains');

if (s !== before) {
  fs.writeFileSync(file, s, 'utf8');
  console.log('patched index.html v6 excel download link');
} else {
  console.log('no changes');
}
