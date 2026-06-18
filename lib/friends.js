/*
 * 친구 시스템 로직 (PART B) — 순수 함수, 브라우저(globalThis.StellaFriends)+Node 공용.
 *
 * - 친구는 "명시적으로 추가"한 사용자만 목록에 존재 → 추가 안 한 사용자는 안 보임(B2).
 * - id 기준 dedupe(중복 추가 방지), 표시 이름 = 가입자명(B3).
 * - 프로필: 표시 이름 + 아바타(dataURL/URL). 이름은 가입자명을 기본으로 한다.
 */
(function (global) {
  "use strict";

  function norm(v) { return String(v == null ? "" : v).trim(); }

  function normalizeFriend(user) {
    if (!user) return null;
    var id = norm(user.id || user.user_id || user.email);
    if (!id) return null;
    return {
      id: id,
      name: norm(user.name) || id,         // 표시 이름 = 가입자명
      email: norm(user.email),
      avatar: user.avatar || "",
      addedAt: user.addedAt || Date.now()
    };
  }

  // 친구 추가 (id 기준 upsert, 기존 addedAt 보존). 원본 불변.
  function addFriend(list, user) {
    var f = normalizeFriend(user);
    if (!f) return (list || []).slice();
    var out = (list || []).map(function (x) { return Object.assign({}, x); });
    var i = out.findIndex(function (x) { return String(x.id) === f.id; });
    if (i >= 0) {
      f.addedAt = out[i].addedAt || f.addedAt;      // 기존 추가시각 유지
      out[i] = Object.assign(out[i], f);            // 이름/아바타 갱신
    } else {
      out.push(f);
    }
    return out;
  }

  function removeFriend(list, id) {
    var key = norm(id);
    return (list || []).filter(function (x) { return String(x.id) !== key; });
  }

  function isFriend(list, id) {
    var key = norm(id);
    return (list || []).some(function (x) { return String(x.id) === key; });
  }

  // 표시용: 이름 오름차순. (목록엔 추가한 친구만 존재하므로 그대로 노출)
  function visibleFriends(list) {
    return (list || []).slice().sort(function (a, b) {
      return String(a.name || a.id).localeCompare(String(b.name || b.id), "ko");
    });
  }

  // 프로필 정규화 (표시 이름 기본 = 가입자명)
  function normalizeProfile(profile, fallbackName) {
    profile = profile || {};
    return {
      name: norm(profile.name) || norm(fallbackName) || "사용자",
      avatar: profile.avatar || ""
    };
  }

  var StellaFriends = {
    normalizeFriend: normalizeFriend,
    addFriend: addFriend,
    removeFriend: removeFriend,
    isFriend: isFriend,
    visibleFriends: visibleFriends,
    normalizeProfile: normalizeProfile
  };

  global.StellaFriends = StellaFriends;
  if (typeof module !== "undefined" && module.exports) module.exports = StellaFriends;
})(typeof globalThis !== "undefined" ? globalThis : this);
