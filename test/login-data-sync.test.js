// Regression test for the cross-device / new-environment data-loss bug.
//
// Root cause: when a new environment's initial server read (/api/workspace GET) failed
// (SQL cold start / timeout / transient error), the client fabricated an empty state and
// POSTed it back, OVERWRITING the account's shared workspace_state with empty arrays —
// destroying notes/chats/projects for every device. This test exercises the REAL inline
// functions from index.html inside jsdom and asserts the guard (_serverPullOk) prevents it.

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

// Build a jsdom window, inject the real app script + a driver in the SAME scope so the
// driver can touch script-scoped vars (user, rooms, _serverPullOk, ...) and stub fetch.
async function boot(scenario) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const appScript = extractMainScript(html);

  const driver = `
;(function(){
  window.__calls = [];
  // Neutralize DOM-heavy render/save so we test sync logic in isolation.
  renderAll=function(){}; if(typeof renderNoteList!=='undefined')renderNoteList=function(){};
  if(typeof renderBoardTree!=='undefined')renderBoardTree=function(){};
  saveRooms=function(){}; saveProjects=function(){}; savePosts=function(){};
  stellaShowToast=function(){};
  // Deterministic fetch stub driven by window.__mode.
  window.fetch=function(url, opts){
    var method=(opts&&opts.method)||'GET';
    window.__calls.push({url:String(url), method:method, body: opts&&opts.body});
    function resp(status, obj){ return Promise.resolve({ ok: status>=200&&status<300, status: status,
      json:function(){return Promise.resolve(obj);}, text:function(){return Promise.resolve(JSON.stringify(obj));} }); }
    if(String(url).indexOf('/api/workspace')>=0 && method==='GET'){
      if(window.__mode==='read-fail') return resp(401, {ok:false});
      if(window.__mode==='read-empty') return resp(200, {ok:true, rooms:[], projects:[], posts:[]});
      if(window.__mode==='read-data') return resp(200, {ok:true,
        rooms:[{id:'r-srv',name:'서버 채팅',messages:[{role:'user',text:'hi'},{role:'ai',text:'yo'}],createdAt:'2026-01-01T00:00:00Z'}],
        projects:[{id:'p-srv',name:'QM',createdAt:'2026-01-01T00:00:00Z'}],
        posts:[{id:'n-srv',title:'서버 노트',body:'b',category:'노트',createdAt:'2026-01-01T00:00:00Z'}]});
    }
    if(String(url).indexOf('/api/workspace')>=0 && method==='POST') return resp(200, {ok:true});
    if(String(url).indexOf('/api/hybrid-chat-list')>=0) return resp(200, {ok:true, items:[]});
    if(String(url).indexOf('/api/note')>=0) return resp(200, {ok:true, notes:[]});
    return resp(200, {ok:true});
  };
  window.__run = async function(mode, setup){
    window.__mode = mode; window.__calls.length=0;
    user={id:'yesblue0342', name:'y', email:'yesblue0342'};
    users=[user];
    rooms=[]; projects=[]; posts=[];
    _restoreCompleted=false; _serverPullOk=false; _serverSnapshot={rooms:0,projects:0,posts:0};
    if(setup) setup();
    await syncFromServer();
    // Mimic restoreAllData tail: mark restore complete, then attempt a save.
    _restoreCompleted=true;
    await syncToServer();
    return { pullOk: _serverPullOk,
      posts: window.__calls.filter(function(c){return c.url.indexOf('/api/workspace')>=0 && c.method==='POST';}),
      rooms: rooms.map(function(r){return r.id;}),
      noteCount: posts.length, projCount: projects.length };
  };
  // expose setters usable from string setup
  window.__setLocal=function(r,p,n){ rooms=r; projects=p; posts=n; };
})();
`;

  const dom = new JSDOM(
    `<!doctype html><html><body><div id="app"></div><span id="userName"></span><span id="userEmail"></span></body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "https://stella.local/" }
  );
  // sync-engine is optional for the guard; inject if present for realism.
  try {
    const se = fs.readFileSync(path.join(ROOT, "lib/sync-engine.js"), "utf8");
    const s0 = dom.window.document.createElement("script"); s0.textContent = se;
    dom.window.document.body.appendChild(s0);
  } catch { /* ignore */ }
  const s = dom.window.document.createElement("script");
  s.textContent = appScript + "\n" + driver;
  dom.window.document.body.appendChild(s);
  return dom.window;
}

test("read FAILS on new environment → client must NOT overwrite server (data-loss guard)", async () => {
  const win = await boot();
  // Simulate the exact failure: fresh env, server unreachable, an auto-created empty '새 채팅'.
  const res = await win.__run("read-fail", () => {
    win.__setLocal(
      [{ id: "r-new", name: "새 채팅", messages: [{ role: "ai", text: "안녕하세요" }], createdAt: "2026-07-01T00:00:00Z" }],
      [], []
    );
  });
  assert.equal(res.pullOk, false, "server pull should be marked failed");
  assert.equal(res.posts.length, 0, "NO workspace POST may happen when the read failed (prevents nuking backend)");
});

test("read succeeds EMPTY + local has data (main device) → client repushes to heal backend", async () => {
  const win = await boot();
  const res = await win.__run("read-empty", () => {
    win.__setLocal(
      [{ id: "r1", name: "실제 채팅", messages: [{ role: "user", text: "q" }, { role: "ai", text: "a" }], createdAt: "2026-06-01T00:00:00Z" }],
      [{ id: "p1", name: "QM", createdAt: "2026-06-01T00:00:00Z" }],
      [{ id: "n1", title: "노트", body: "b", category: "노트", createdAt: "2026-06-01T00:00:00Z" }]
    );
  });
  assert.equal(res.pullOk, true, "empty-but-successful read still confirms server state");
  assert.equal(res.posts.length, 1, "local data must be pushed back to restore the backend");
  const body = JSON.parse(res.posts[0].body);
  assert.ok((body.rooms || []).some((r) => r.id === "r1"), "pushed body carries the local room");
  assert.ok((body.posts || []).some((p) => p.id === "n1"), "pushed body carries the local note");
});

test("read succeeds WITH data → server data is merged into an empty new environment", async () => {
  const win = await boot();
  const res = await win.__run("read-data", () => { win.__setLocal([], [], []); });
  assert.equal(res.pullOk, true);
  assert.ok(res.rooms.includes("r-srv"), "server room restored on the new environment");
  assert.ok(res.noteCount >= 1, "server note restored");
  assert.ok(res.projCount >= 1, "server project restored");
});
