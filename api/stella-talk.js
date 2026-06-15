export default function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Stella Talk</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:#b2c7d9;font-family:"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;height:100dvh;display:flex;flex-direction:column;overflow:hidden}

/* ── 헤더 ── */
#header{background:#a8bbd0;display:flex;align-items:center;padding:10px 14px;gap:10px;min-height:54px;flex-shrink:0}
#header .back{font-size:22px;cursor:pointer;color:#fff;line-height:1}
#header .title{flex:1;font-weight:700;font-size:16px;color:#fff;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#header .actions{display:flex;gap:8px}
#header .actions button{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:4px}

/* ── 채팅 목록 화면 ── */
#listView{flex:1;display:flex;flex-direction:column;overflow:hidden}
#listHeader{background:#a8bbd0;padding:10px 14px;display:flex;gap:8px;align-items:center}
#listHeader input{flex:1;border:none;border-radius:20px;padding:8px 14px;font-size:14px;background:rgba(255,255,255,0.85);outline:none}
#listHeader .newBtn{background:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;color:#3b5998}
#roomList{flex:1;overflow-y:auto;background:#b2c7d9}
.roomItem{display:flex;align-items:center;padding:12px 16px;gap:12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.15);transition:background .15s}
.roomItem:active{background:rgba(255,255,255,0.35)}
.roomItem .avatar{width:46px;height:46px;border-radius:50%;background:#7a9bc4;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;overflow:hidden}
.roomItem .avatar img{width:100%;height:100%;object-fit:cover}
.roomItem .info{flex:1;min-width:0}
.roomItem .rName{font-weight:700;font-size:15px;color:#1a2030;margin-bottom:3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.roomItem .rLast{font-size:13px;color:#4a5568;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.roomItem .meta{text-align:right;flex-shrink:0}
.roomItem .rTime{font-size:11px;color:#6b7280;margin-bottom:4px}
.roomItem .badge{background:#ff6b6b;color:#fff;border-radius:10px;padding:2px 7px;font-size:11px;font-weight:700;display:inline-block}
.emptyList{text-align:center;color:#6b7280;padding:60px 20px;font-size:15px}

/* ── 채팅방 화면 ── */
#chatView{flex:1;display:none;flex-direction:column;overflow:hidden}
#chatHeader{background:#a8bbd0;display:flex;align-items:center;padding:10px 14px;gap:10px;min-height:54px;flex-shrink:0}
#chatHeader .back{font-size:22px;cursor:pointer;color:#fff}
#chatHeader .chatTitle{flex:1;font-weight:700;font-size:16px;color:#fff}
#chatHeader .chatMeta{font-size:12px;color:rgba(255,255,255,0.8)}
#chatHeader .delBtn{background:none;border:none;color:rgba(255,255,255,0.8);font-size:20px;cursor:pointer}

#msgs{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}

/* 날짜 구분선 */
.dateDiv{text-align:center;margin:8px 0}
.dateDiv span{background:rgba(0,0,0,0.2);color:#fff;font-size:12px;padding:3px 12px;border-radius:10px}

/* 메시지 버블 */
.msgRow{display:flex;align-items:flex-end;gap:7px;max-width:78%;animation:fadeIn .15s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.msgRow.me{align-self:flex-end;flex-direction:row-reverse}
.msgRow.other{align-self:flex-start}
.msgRow .uAvatar{width:34px;height:34px;border-radius:50%;background:#7a9bc4;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;overflow:hidden}
.msgRow .uAvatar img{width:100%;height:100%;object-fit:cover}
.msgRow .msgContent{}
.msgRow .senderName{font-size:12px;color:#4a5568;margin-bottom:3px;padding-left:2px}
.msgRow.me .senderName{display:none}
.bubble{background:#fff;border-radius:18px;border-top-left-radius:4px;padding:9px 13px;font-size:15px;line-height:1.45;color:#1a2030;word-break:break-word;white-space:pre-wrap;box-shadow:0 1px 2px rgba(0,0,0,.1);max-width:260px}
.msgRow.me .bubble{background:#fee500;border-radius:18px;border-top-right-radius:4px;color:#1a2030}
.msgTime{font-size:11px;color:rgba(0,0,0,0.45);flex-shrink:0;align-self:flex-end;margin-bottom:2px}

/* 이미지 메시지 */
.imgBubble{max-width:220px;border-radius:14px;overflow:hidden;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.2)}
.imgBubble img{width:100%;display:block}

/* ── 입력창 ── */
#inputArea{background:#b2c7d9;padding:8px 10px;display:flex;align-items:flex-end;gap:8px;flex-shrink:0;border-top:1px solid rgba(255,255,255,0.3)}
#attachBtn{background:none;border:none;font-size:24px;cursor:pointer;padding:4px;flex-shrink:0;line-height:1;color:#4a5568}
#msgInput{flex:1;background:#fff;border:none;border-radius:20px;padding:10px 14px;font-size:15px;font-family:inherit;resize:none;outline:none;max-height:120px;overflow-y:auto;line-height:1.4;min-height:40px}
#sendBtn{background:#fee500;border:none;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;font-size:18px;color:#1a2030}
#sendBtn:disabled{background:#d1d5db;color:#9ca3af}
#fileInput{display:none}

/* 모달 */
#modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999;align-items:center;justify-content:center}
#modal.show{display:flex}
#modal img{max-width:95vw;max-height:90vh;object-fit:contain;border-radius:8px}
#modal .close{position:absolute;top:16px;right:16px;color:#fff;font-size:28px;cursor:pointer;background:rgba(0,0,0,0.5);border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center}

/* 방 생성 모달 */
#newRoomModal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;align-items:flex-end;justify-content:center}
#newRoomModal.show{display:flex}
#newRoomBox{background:#fff;border-radius:20px 20px 0 0;padding:24px 20px 36px;width:100%;max-width:500px}
#newRoomBox h3{font-size:17px;font-weight:700;margin-bottom:16px;color:#1a2030}
#newRoomBox input{width:100%;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;font-size:15px;font-family:inherit;outline:none;margin-bottom:10px}
#newRoomBox input:focus{border-color:#7a9bc4}
#newRoomBox .btnRow{display:flex;gap:10px;margin-top:6px}
#newRoomBox .btnRow button{flex:1;padding:12px;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer}
#newRoomBox .cancelBtn{background:#f3f4f6;color:#4b5563}
#newRoomBox .createBtn{background:#fee500;color:#1a2030}

/* 로딩 */
.loading{text-align:center;color:rgba(255,255,255,0.7);padding:20px;font-size:14px}
</style>
</head>
<body>

<!-- 채팅 목록 -->
<div id="listView">
  <div id="listHeader">
    <input id="searchInput" placeholder="검색" oninput="filterRooms()">
    <button class="newBtn" onclick="openNewRoom()">+ 새 채팅</button>
  </div>
  <div id="roomList"><div class="loading">채팅방 불러오는 중...</div></div>
</div>

<!-- 채팅방 -->
<div id="chatView">
  <div id="chatHeader">
    <span class="back" onclick="backToList()">←</span>
    <div style="flex:1;min-width:0">
      <div class="chatTitle" id="chatTitle">채팅방</div>
      <div class="chatMeta" id="chatMeta"></div>
    </div>
    <button class="delBtn" onclick="deleteRoom()" title="채팅방 삭제">🗑</button>
  </div>
  <div id="msgs"></div>
  <div id="inputArea">
    <button id="attachBtn" onclick="document.getElementById('fileInput').click()">📎</button>
    <input type="file" id="fileInput" accept="image/*" onchange="sendImage(this)">
    <textarea id="msgInput" placeholder="메시지 입력" rows="1" oninput="autoResize(this)"></textarea>
    <button id="sendBtn" onclick="sendMsg()" disabled>↑</button>
  </div>
</div>

<!-- 이미지 뷰어 모달 -->
<div id="modal" onclick="closeModal()">
  <div class="close">✕</div>
  <img id="modalImg" src="" alt="">
</div>

<!-- 새 채팅방 모달 -->
<div id="newRoomModal" onclick="if(event.target===this)closeNewRoom()">
  <div id="newRoomBox">
    <h3>새 채팅방 만들기</h3>
    <input id="newRoomName" placeholder="채팅방 이름" maxlength="50">
    <input id="inviteUser" placeholder="초대할 사용자 아이디 (선택)">
    <div class="btnRow">
      <button class="cancelBtn" onclick="closeNewRoom()">취소</button>
      <button class="createBtn" onclick="createRoom()">만들기</button>
    </div>
  </div>
</div>

<script>
// ── 설정 ──
const ME = (()=>{
  try{ return JSON.parse(localStorage.getItem('stella_user')||'{}'); }catch(e){return {};}
})();
const MY_ID = ME.id || ME.email || 'kh';
const MY_NAME = ME.name || '나';

let _rooms = [];
let _curRoom = null;
let _pollTimer = null;
let _lastMsgId = null;
let _sending = false;

// ── 유틸 ──
function fmt(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffDay = Math.floor(diffMs/86400000);
  if(diffDay === 0){
    return d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:true});
  } else if(diffDay === 1) return '어제';
  else if(diffDay < 7) return ['일','월','화','수','목','금','토'][d.getDay()]+'요일';
  else return (d.getMonth()+1)+'/'+d.getDate();
}
function fmtFull(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:true});
}
function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return d.getFullYear()+'년 '+(d.getMonth()+1)+'월 '+d.getDate()+'일 '+['일','월','화','수','목','금','토'][d.getDay()]+'요일';
}
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function initials(name){ return String(name||'?').charAt(0).toUpperCase(); }

// ── 방 목록 ──
async function loadRooms(){
  try{
    const r = await fetch('/api/chat-room?action=list&userId='+encodeURIComponent(MY_ID));
    const d = await r.json();
    _rooms = d.rooms || [];
    renderRooms(_rooms);
  }catch(e){
    document.getElementById('roomList').innerHTML='<div class="emptyList">채팅방을 불러오지 못했습니다.</div>';
  }
}

function renderRooms(rooms){
  const el = document.getElementById('roomList');
  if(!rooms.length){
    el.innerHTML='<div class="emptyList">채팅방이 없습니다.<br>+ 새 채팅으로 시작하세요.</div>';
    return;
  }
  el.innerHTML = rooms.map(r=>{
    const name = escHtml(r.title||r.roomId||'채팅방');
    const last = escHtml(r.lastMessage||'');
    const time = fmt(r.updatedAt);
    return \`<div class="roomItem" onclick="openRoom('\${escHtml(r.roomId)}','\${name}')">
      <div class="avatar">\${initials(name)}</div>
      <div class="info">
        <div class="rName">\${name}</div>
        <div class="rLast">\${last}</div>
      </div>
      <div class="meta">
        <div class="rTime">\${time}</div>
      </div>
    </div>\`;
  }).join('');
}

function filterRooms(){
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  if(!q){ renderRooms(_rooms); return; }
  renderRooms(_rooms.filter(r=>(r.title||'').toLowerCase().includes(q)||(r.lastMessage||'').toLowerCase().includes(q)));
}

// ── 방 열기 ──
function openRoom(roomId, title){
  _curRoom = roomId;
  document.getElementById('chatTitle').textContent = decodeURIComponent(title);
  document.getElementById('listView').style.display='none';
  document.getElementById('chatView').style.display='flex';
  document.getElementById('chatView').style.flexDirection='column';
  document.getElementById('msgs').innerHTML='<div class="loading">메시지 불러오는 중...</div>';
  _lastMsgId = null;
  loadMsgs(true);
  startPoll();
  // 읽음 처리
  fetch('/api/chat-room?action=read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,userId:MY_ID})}).catch(()=>{});
}

function backToList(){
  stopPoll();
  _curRoom = null;
  document.getElementById('chatView').style.display='none';
  document.getElementById('listView').style.display='flex';
  document.getElementById('listView').style.flexDirection='column';
  loadRooms();
}

// ── 메시지 로드 ──
async function loadMsgs(scroll){
  if(!_curRoom) return;
  try{
    const r = await fetch('/api/chat-room?action=get&roomId='+encodeURIComponent(_curRoom));
    const d = await r.json();
    const msgs = d.messages || [];
    // 멤버 수 표시
    const memberCount = (d.room?.members||[]).length;
    document.getElementById('chatMeta').textContent = memberCount > 1 ? memberCount+'명' : '';
    renderMsgs(msgs, scroll);
  }catch(e){}
}

function renderMsgs(msgs, scrollToBottom){
  const el = document.getElementById('msgs');
  if(!msgs.length){ el.innerHTML='<div class="loading">아직 메시지가 없습니다.</div>'; return; }
  let html = '';
  let lastDate = '';
  msgs.forEach((m,i)=>{
    const isMe = m.userId === MY_ID || m.sender === MY_NAME || m.sender === MY_ID;
    const dateStr = m.createdAt ? fmtDate(m.createdAt) : '';
    if(dateStr && dateStr !== lastDate){
      html += \`<div class="dateDiv"><span>\${escHtml(dateStr)}</span></div>\`;
      lastDate = dateStr;
    }
    const timeStr = fmtFull(m.createdAt);
    if(m.fileUrl && /\\.(jpg|jpeg|png|gif|webp)/i.test(m.fileUrl||'')){
      // 이미지 메시지
      html += \`<div class="msgRow \${isMe?'me':'other'}">
        \${!isMe?'<div class="uAvatar">'+escHtml(initials(m.sender))+'</div>':''}
        <div class="msgContent">
          \${!isMe?'<div class="senderName">'+escHtml(m.sender||'')+'</div>':''}
          <div class="imgBubble" onclick="openModal('\${escHtml(m.fileUrl)}')">
            <img src="\${escHtml(m.fileUrl)}" alt="이미지" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"100\\" height=\\"80\\"><rect fill=\\"%23ddd\\" width=\\"100\\" height=\\"80\\"/><text y=\\"50%\\" x=\\"50%\\" text-anchor=\\"middle\\" fill=\\"%23999\\" dy=\\".3em\\">이미지</text></svg>'">
          </div>
        </div>
        <div class="msgTime">\${timeStr}</div>
      </div>\`;
    } else {
      // 텍스트 메시지
      html += \`<div class="msgRow \${isMe?'me':'other'}">
        \${!isMe?'<div class="uAvatar">'+escHtml(initials(m.sender))+'</div>':''}
        <div class="msgContent">
          \${!isMe?'<div class="senderName">'+escHtml(m.sender||'')+'</div>':''}
          <div class="bubble">\${escHtml(m.message||'')}</div>
        </div>
        <div class="msgTime">\${timeStr}</div>
      </div>\`;
    }
  });
  el.innerHTML = html;
  if(scrollToBottom || isNearBottom()) el.scrollTop = el.scrollHeight;
}

function isNearBottom(){
  const el = document.getElementById('msgs');
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

// ── 폴링 ──
function startPoll(){
  stopPoll();
  _pollTimer = setInterval(()=>loadMsgs(false), 3000);
}
function stopPoll(){
  if(_pollTimer){ clearInterval(_pollTimer); _pollTimer=null; }
}

// ── 메시지 전송 ──
async function sendMsg(){
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if(!text || _sending || !_curRoom) return;
  _sending = true;
  document.getElementById('sendBtn').disabled = true;
  input.value = '';
  input.style.height = '';
  try{
    await fetch('/api/chat-room?action=send',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        roomId: _curRoom,
        sender: MY_NAME,
        userId: MY_ID,
        message: text
      })
    });
    await loadMsgs(true);
  }catch(e){ alert('전송 실패: '+e.message); }
  finally{ _sending=false; document.getElementById('sendBtn').disabled=false; input.focus(); }
}

// ── 이미지 전송 ──
async function sendImage(input){
  if(!input.files||!input.files[0]||!_curRoom) return;
  const file = input.files[0];
  input.value='';
  // Drive 업로드는 별도 구현 예정 - 현재는 base64 preview로 표시
  const reader = new FileReader();
  reader.onload = async (e)=>{
    // 간단히 파일명만 텍스트로 전송 (추후 Drive 업로드 연동)
    const msg = '📎 '+file.name+' (이미지 첨부 - Drive 업로드 준비중)';
    try{
      await fetch('/api/chat-room?action=send',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({roomId:_curRoom, sender:MY_NAME, userId:MY_ID, message:msg})
      });
      await loadMsgs(true);
    }catch(err){}
  };
  reader.readAsDataURL(file);
}

// ── 입력창 자동 높이 ──
function autoResize(el){
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,120)+'px';
  document.getElementById('sendBtn').disabled = !el.value.trim();
}

document.getElementById('msgInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){ e.preventDefault(); sendMsg(); }
});
document.getElementById('msgInput').addEventListener('input',function(){
  document.getElementById('sendBtn').disabled = !this.value.trim();
});

// ── 이미지 모달 ──
function openModal(src){ document.getElementById('modalImg').src=src; document.getElementById('modal').classList.add('show'); }
function closeModal(){ document.getElementById('modal').classList.remove('show'); }

// ── 방 삭제 ──
async function deleteRoom(){
  if(!_curRoom) return;
  if(!confirm('이 채팅방을 삭제하시겠습니까?')) return;
  try{
    await fetch('/api/chat-room?action=delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:_curRoom})});
    backToList();
  }catch(e){ alert('삭제 실패'); }
}

// ── 새 채팅방 ──
function openNewRoom(){
  document.getElementById('newRoomModal').classList.add('show');
  setTimeout(()=>document.getElementById('newRoomName').focus(),100);
}
function closeNewRoom(){
  document.getElementById('newRoomModal').classList.remove('show');
  document.getElementById('newRoomName').value='';
  document.getElementById('inviteUser').value='';
}
async function createRoom(){
  const name = document.getElementById('newRoomName').value.trim();
  if(!name){ alert('채팅방 이름을 입력하세요.'); return; }
  const invite = document.getElementById('inviteUser').value.trim();
  const members = [MY_ID];
  if(invite && invite !== MY_ID) members.push(invite);
  const roomId = 'room_'+Date.now();
  try{
    // 첫 메시지로 방 생성
    await fetch('/api/chat-room?action=send',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({roomId, title:name, sender:MY_NAME, userId:MY_ID, message:'채팅방이 생성되었습니다', members})
    });
    closeNewRoom();
    openRoom(roomId, name);
  }catch(e){ alert('생성 실패: '+e.message); }
}

// ── 초기화 ──
document.getElementById('listView').style.display='flex';
document.getElementById('listView').style.flexDirection='column';
loadRooms();
// 30초마다 목록 갱신
setInterval(()=>{ if(!_curRoom) loadRooms(); }, 30000);
</script>
</body></html>`);
}
