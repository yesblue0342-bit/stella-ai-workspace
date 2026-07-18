// Regression test for the "0개 메시지 유령/중복 채팅" + "채팅 내역 저장 안됨" bug.
//
// Root cause: hybrid-chat-list 는 SQL 인덱스(메시지 없음)만 반환하는데 loadChatHistoryFromDrive 가
// 그 행들을 messages:[] 인 빈 방으로 주입 → 모든 복원 채팅이 "0개 메시지"로 보이고, chat_index 는
// 삭제해도 안 지워져 지운 채팅이 유령으로 부활했다. 이 테스트는 index.html 의 실제 인라인 함수를
// jsdom 안에서 구동해 (1) 빈/유령/삭제된 방은 주입 안 함, (2) 내용 있는 방은 지연 로드로 메시지 채움,
// (3) 삭제 시 tombstone 기록 + 서버 인덱스 삭제 호출을 검증한다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function extractMainScript(html) {
  const idx = html.indexOf("if(window.pdfjsLib)");
  const start = html.lastIndexOf("<script>", idx) + "<script>".length;
  const end = html.indexOf("</script>", idx);
  return html.slice(start, end);
}

async function boot() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const appScript = extractMainScript(html);

  const driver = `
;(function(){
  window.__calls = [];
  renderAll=function(){}; renderMessages=function(){}; renderChatTree=function(){}; renderHeader=function(){};
  saveRooms=function(){}; closeSidebar=function(){}; stellaShowToast=function(){};
  window.confirm=function(){return true;};
  window.__listItems=[]; window.__readMsgs=[];
  window.fetch=function(url, opts){
    var method=(opts&&opts.method)||'GET';
    window.__calls.push({url:String(url), method:method, body: opts&&opts.body});
    function resp(status, obj){ return Promise.resolve({ ok: status>=200&&status<300, status: status,
      json:function(){return Promise.resolve(obj);}, text:function(){return Promise.resolve(JSON.stringify(obj));} }); }
    if(String(url).indexOf('/api/hybrid-chat-list')>=0) return resp(200, {ok:true, items: window.__listItems});
    if(String(url).indexOf('/api/hybrid-chat-read')>=0) return resp(200, {ok:true, found:true, messages: window.__readMsgs});
    if(String(url).indexOf('/api/hybrid-chat-delete')>=0) return resp(200, {ok:true, deleted:true});
    return resp(200, {ok:true});
  };

  window.__loadList = async function(items, tombs, seed){
    user={id:'u1', name:'u', email:'u1'}; users=[user];
    rooms = seed || [];
    if(tombs) write(K.deletedRooms, tombs); else localStorage.removeItem(K.deletedRooms);
    window.__listItems = items;
    await loadChatHistoryFromDrive();
    return rooms.map(function(r){return {id:r.id, name:r.name, lazy:!!r._lazyServer, count:r._serverCount||0, msgs:(r.messages||[]).length};});
  };

  window.__lazyLoad = async function(){
    user={id:'u1'}; rooms=[];
    window.__listItems=[{room_id:'r-lazy', title:'송도 날씨', message_count:3, drive_file_id:'f1'}];
    await loadChatHistoryFromDrive();
    window.__readMsgs=[{role:'user',content:'송도 날씨'},{role:'assistant',content:'맑음 21도'}];
    await ensureRoomMessages('r-lazy');
    var r=rooms.find(function(x){return x.id==='r-lazy';});
    return {lazy:!!r._lazyServer, msgs:(r.messages||[]).map(function(m){return m.role+':'+m.text;})};
  };

  window.__pick = function(json){
    var cfg=JSON.parse(json);
    user={id:'u1'}; rooms=cfg.rooms||[];
    localStorage.removeItem(K.lastRoom); localStorage.removeItem(K.deletedRooms);
    if(cfg.last) write(K.lastRoom, cfg.last);
    if(cfg.tombs) write(K.deletedRooms, cfg.tombs);
    return pickInitialRoom();
  };

  window.__del = async function(){
    window.__calls.length=0;
    user={id:'u1', name:'u'}; rooms=[{id:'r-del', name:'삭제대상', messages:[{role:'ai',text:'a'}]}]; activeRoomId='r-del';
    localStorage.removeItem(K.deletedRooms);
    deleteRoom('r-del');
    await new Promise(function(r){setTimeout(r,0);});
    var tombs=read(K.deletedRooms,[]);
    var delCall=window.__calls.find(function(c){return c.url.indexOf('/api/hybrid-chat-delete')>=0 && c.method==='POST';});
    return {roomsLeft:rooms.length, tombstoned: tombs.indexOf('r-del')>=0, deleteCalled:!!delCall};
  };
})();
`;

  const dom = new JSDOM(
    `<!doctype html><html><body><div id="app"></div><span id="userName"></span><span id="userEmail"></span></body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "https://stella.local/" }
  );
  const s = dom.window.document.createElement("script");
  s.textContent = appScript + "\n" + driver;
  dom.window.document.body.appendChild(s);
  return dom.window;
}

test("loadChatHistoryFromDrive: 빈(인사말만)·삭제된 방은 주입하지 않고, 내용 있는 방만 지연 복원", async () => {
  const win = await boot();
  const out = await win.__loadList([
    { room_id: "r-full", title: "송도 날씨", message_count: 4 },   // 내용 있음 → 지연 복원
    { room_id: "r-empty", title: "빈 채팅", message_count: 1 },    // 인사말만 → 스킵(유령 방지)
    { room_id: "r-zero", title: "0개", message_count: 0 },          // 0개 → 스킵
    { room_id: "r-dead", title: "지운 채팅", message_count: 5 },    // tombstone → 부활 금지
  ], ["r-dead"]);
  // 크로스-realm 배열은 deepEqual 대신 원시값으로 비교
  assert.equal(out.length, 1, "내용 있는 방 1개만 복원되어야(빈/0개/삭제 제외)");
  assert.equal(out[0].id, "r-full", "r-full 만 복원");
  assert.equal(out[0].lazy, true, "지연 로드 플래그");
  assert.equal(out[0].count, 4, "사이드바에는 서버 메시지 수 표시");
  assert.equal(out[0].msgs, 0, "메시지는 아직 비어있음(열 때 로드)");
});

test("loadChatHistoryFromDrive: 이미 로컬에 있는 방은 중복 추가하지 않고 제목만 보강", async () => {
  const win = await boot();
  const out = await win.__loadList(
    [{ room_id: "r1", title: "복원된 제목", message_count: 3 }],
    null,
    [{ id: "r1", name: "새 채팅", messages: [{ role: "ai", text: "안녕" }, { role: "user", text: "q" }] }]
  );
  assert.equal(out.length, 1, "중복 방 생성 금지");
  assert.equal(out[0].name, "복원된 제목", "무명 '새 채팅' 제목은 서버 제목으로 보강");
  assert.equal(out[0].msgs, 2, "기존 로컬 메시지 보존(덮어쓰기 금지)");
});

test("ensureRoomMessages: 열 때 Drive 백업에서 메시지를 채우고 형식 변환", async () => {
  const win = await boot();
  const r = await win.__lazyLoad();
  assert.equal(r.lazy, false, "로드 후 지연 플래그 해제");
  assert.equal(r.msgs.length, 2, "메시지 2개 채워짐");
  assert.equal(r.msgs[0], "user:송도 날씨", "user 메시지");
  assert.equal(r.msgs[1], "ai:맑음 21도", "assistant→ai, content→text 변환");
});

test("deleteRoom: tombstone 기록 + 서버 인덱스 삭제 호출(유령 부활 차단)", async () => {
  const win = await boot();
  const r = await win.__del();
  assert.equal(r.roomsLeft, 0, "로컬에서 제거");
  assert.equal(r.tombstoned, true, "삭제 tombstone 기록 → 다음 복원 때 부활 안 함");
  assert.equal(r.deleteCalled, true, "/api/hybrid-chat-delete 호출로 서버 인덱스도 제거");
});

test("pickInitialRoom: lastRoom 없으면 활동이 가장 최근인 채팅 선택(오래된 채팅 회피)", async () => {
  const win = await boot();
  // 과거 버그: 목록은 최신순 정렬돼도 activeRoomId=rooms[0](오래된 로컬 첫 방)로 열림. 이제 활동 최신순으로.
  const id = win.__pick(JSON.stringify({ rooms: [
    { id: "old", name: "가입했을 때", messages: [{ role: "ai", text: "a" }], updatedAt: "2026-01-01T00:00:00Z" },
    { id: "recent", name: "홋카이도 날씨", messages: [{ role: "user", text: "q" }], updatedAt: "2026-07-17T09:00:00Z" },
    { id: "mid", name: "중간", messages: [], updatedAt: "2026-05-01T00:00:00Z" },
  ]}));
  assert.equal(id, "recent", "가장 최근 활동 채팅에서 시작");
});

test("pickInitialRoom: lastRoom 있으면 마지막 보던 채팅 재개", async () => {
  const win = await boot();
  const id = win.__pick(JSON.stringify({
    rooms: [
      { id: "a", name: "A", messages: [], updatedAt: "2026-07-01T00:00:00Z" },
      { id: "b", name: "B", messages: [], updatedAt: "2026-01-01T00:00:00Z" },
    ],
    last: "b",
  }));
  assert.equal(id, "b", "마지막 보던 채팅(이전 채팅) 재개");
});

test("pickInitialRoom: lastRoom 이 삭제/부재면 최신으로 폴백(tombstone 제외)", async () => {
  const win = await boot();
  const id = win.__pick(JSON.stringify({
    rooms: [
      { id: "a", name: "A", messages: [], updatedAt: "2026-07-10T00:00:00Z" },
      { id: "b", name: "B", messages: [], updatedAt: "2026-01-01T00:00:00Z" },
    ],
    last: "gone",   // 존재하지 않는 방
    tombs: ["a"],   // a 는 삭제됨 → 최신이어도 제외
  }));
  assert.equal(id, "b", "tombstone/부재는 제외하고 살아있는 최신으로");
});
