/*
 * Stella Sync Engine — 크로스-디바이스 동기화 공용 엔진
 *
 * 설계 원칙 (PROMPT §5):
 *  - Google Drive = SSOT. 로컬은 캐시.
 *  - 모든 엔티티는 안정적 고유 id를 가진다.
 *  - 병합은 id 기준 UPSERT (blind append 금지).
 *  - 삭제는 tombstone(soft delete): {id, deleted:true, deletedAt}. 절대 물리 삭제로
 *    동기화하지 않는다(부활 방지).
 *  - 충돌 해결은 항목 단위 Last-Write-Wins(updatedAt). 동률이면 id 사전순(결정적).
 *  - 기존 중복은 dedupe로 1회성·멱등 정리.
 *
 * 의존성 없음. 브라우저(classic script: globalThis.StellaSync)와
 * Node(ESM: `await import()` 후 globalThis.StellaSync)에서 동일하게 동작.
 */
(function (global) {
  "use strict";

  // ── 시간/숫자 헬퍼 ──
  function ts(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    var t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  // 항목의 "마지막 쓰기" 시각 (LWW 비교 기준). 삭제 시각도 쓰기로 취급.
  function lastWrite(item, updatedAtKey, createdAtKey) {
    return Math.max(
      ts(item[updatedAtKey]),
      ts(item.deletedAt),
      ts(item[createdAtKey])
    );
  }

  // ── 결정적(deterministic) id: 같은 seed → 항상 같은 id ──
  // 디바이스가 달라도 동일 항목이면 같은 id가 나오게 하여 마이그레이션을 멱등하게 만든다.
  function deterministicId(seed, prefix) {
    var s = String(seed == null ? "" : seed);
    // djb2 + 보조 해시로 충돌 확률 축소 (32bit 2개 → 16진수)
    var h1 = 5381, h2 = 52711;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = (((h1 << 5) + h1) ^ c) >>> 0;
      h2 = (((h2 << 5) + h2) + c) >>> 0;
    }
    var hex = ("00000000" + h1.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
    return (prefix || "det_") + hex;
  }

  // 문자열 정규화 (제목 비교용): 공백 정리 + 소문자
  function norm(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim().toLowerCase();
  }

  // ── 핵심: id 기준 UPSERT 병합 (tombstone-aware, LWW) ──
  // local, server: 배열. 반환: 병합된 배열(tombstone 포함, createdAt 오름차순).
  function mergeById(local, server, opts) {
    opts = opts || {};
    var idKey = opts.idKey || "id";
    var updatedAtKey = opts.updatedAtKey || "updatedAt";
    var createdAtKey = opts.createdAtKey || "createdAt";

    var map = new Map();
    function consume(item) {
      if (!item || item[idKey] == null) return;       // id 없는 항목은 병합 대상에서 제외(마이그레이션이 먼저 id 부여)
      var id = String(item[idKey]);
      var existing = map.get(id);
      if (!existing) { map.set(id, item); return; }
      // 충돌: LWW. 단 tombstone은 동시각이면 삭제 우선(부활 방지).
      var a = lastWrite(existing, updatedAtKey, createdAtKey);
      var b = lastWrite(item, updatedAtKey, createdAtKey);
      var winner;
      if (b > a) winner = item;
      else if (b < a) winner = existing;
      else {
        // 동률: 삭제가 우선, 그래도 같으면 id 사전순(여기선 같은 id이므로 내용 안정 선택)
        if (!!item.deleted !== !!existing.deleted) winner = item.deleted ? item : existing;
        else winner = existing; // 결정적: 먼저 들어온 쪽 유지
      }
      map.set(id, winner);
    }
    (local || []).forEach(consume);
    (server || []).forEach(consume);

    var out = Array.from(map.values());
    out.sort(function (x, y) {
      var cx = ts(x[createdAtKey]), cy = ts(y[createdAtKey]);
      if (cx !== cy) return cx - cy;
      return String(x[idKey]).localeCompare(String(y[idKey]));
    });
    return out;
  }

  // 렌더용: tombstone 제외
  function visible(items) {
    return (items || []).filter(function (x) { return x && !x.deleted; });
  }

  // 삭제 마킹 (soft delete). 원본 불변, 새 객체 반환.
  function markDeleted(item, updatedAtKey) {
    var now = Date.now();
    var copy = Object.assign({}, item);
    copy.deleted = true;
    copy.deletedAt = now;
    copy[updatedAtKey || "updatedAt"] = now;
    return copy;
  }

  // 오래된 tombstone 정리 (기본 30일)
  function pruneTombstones(items, maxAgeMs) {
    var cutoff = Date.now() - (maxAgeMs || 30 * 24 * 60 * 60 * 1000);
    return (items || []).filter(function (x) {
      if (!x || !x.deleted) return true;
      return ts(x.deletedAt) >= cutoff;
    });
  }

  // ── 중복 제거 (마이그레이션용, 멱등) ──
  // keyFn(item) → 동일성 키(예: 정규화 제목 + 생성일 + 첫 메시지). 같은 키끼리 1개로 병합.
  // 보존 우선순위: 살아있음 > 메시지 많음 > updatedAt/createdAt 최신.
  function dedupe(items, opts) {
    opts = opts || {};
    var idKey = opts.idKey || "id";
    var updatedAtKey = opts.updatedAtKey || "updatedAt";
    var createdAtKey = opts.createdAtKey || "createdAt";
    var keyFn = opts.keyFn || function (it) { return String(it[idKey]); };
    var msgCount = opts.msgCount || function (it) { return Array.isArray(it.messages) ? it.messages.length : 0; };

    // 1단계: 같은 id 우선 병합 (id가 진짜 동일성)
    var byId = mergeById(items, [], { idKey: idKey, updatedAtKey: updatedAtKey, createdAtKey: createdAtKey });

    // 2단계: 내용 키로 그룹핑하여 중복 후보 병합
    var groups = new Map();
    byId.forEach(function (it) {
      var k = keyFn(it);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    });

    var result = [];
    groups.forEach(function (arr) {
      if (arr.length === 1) { result.push(arr[0]); return; }
      // 최선 후보 선택
      arr.sort(function (a, b) {
        var da = a.deleted ? 1 : 0, db = b.deleted ? 1 : 0;
        if (da !== db) return da - db;                       // 살아있는 것 우선
        var ma = msgCount(a), mb = msgCount(b);
        if (ma !== mb) return mb - ma;                       // 메시지 많은 것 우선
        var la = lastWrite(a, updatedAtKey, createdAtKey), lb = lastWrite(b, updatedAtKey, createdAtKey);
        if (la !== lb) return lb - la;                       // 최신 우선
        return String(a[idKey]).localeCompare(String(b[idKey])); // 결정적
      });
      result.push(arr[0]); // 나머지는 중복 → 제거
    });

    result.sort(function (x, y) {
      var cx = ts(x[createdAtKey]), cy = ts(y[createdAtKey]);
      if (cx !== cy) return cx - cy;
      return String(x[idKey]).localeCompare(String(y[idKey]));
    });
    return result;
  }

  // 채팅 동일성 키(제목 정규화 + 생성일(날짜) + 첫 user 메시지 앞부분)
  function chatKey(room) {
    var title = norm(room.name || room.title);
    var created = String(room.createdAt || "").slice(0, 10); // 날짜 단위
    var first = "";
    var msgs = room.messages || [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if ((m.role === "user") || (m.from && !m.role)) { first = norm(m.text || m.content); break; }
    }
    return title + "|" + created + "|" + first.slice(0, 40);
  }

  // id 없는 항목에 결정적 id 부여 (마이그레이션). 원본 배열 불변, 새 배열 반환.
  function ensureIds(items, opts) {
    opts = opts || {};
    var idKey = opts.idKey || "id";
    var prefix = opts.prefix || "det_";
    var seedFn = opts.seedFn || function (it) { return JSON.stringify(it); };
    return (items || []).map(function (it) {
      if (it && it[idKey] != null && String(it[idKey]).length) return it;
      var copy = Object.assign({}, it);
      copy[idKey] = deterministicId(seedFn(it), prefix);
      return copy;
    });
  }

  var SyncEngine = {
    mergeById: mergeById,
    visible: visible,
    markDeleted: markDeleted,
    pruneTombstones: pruneTombstones,
    dedupe: dedupe,
    chatKey: chatKey,
    ensureIds: ensureIds,
    deterministicId: deterministicId,
    _norm: norm,
    _ts: ts
  };

  global.StellaSync = SyncEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = SyncEngine;
})(typeof globalThis !== "undefined" ? globalThis : this);
