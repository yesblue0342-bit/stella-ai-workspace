#!/usr/bin/env node
// scripts/migrate-chats-to-users.mjs
// 레거시 채팅 백업(StellaGPT/chatgpt/chats/{uid}/*.json)을
// 신규 위치(StellaGPT/users/{uid}/chats/)로 이전(re-parent)한다.
//
//   · re-parent(부모 폴더만 이동)이라 fileId 불변 → chat_index.drive_file_id 그대로 유효, 중복 0.
//   · 멱등: 이미 이전된 파일은 스킵. 신규 위치에 별도 최신본이 있으면 레거시 중복본은 휴지통.
//   · 기본은 드라이런(변경 없음). 실제 적용은 --apply.
//
// 사용:  node scripts/migrate-chats-to-users.mjs            # 드라이런(무엇이 이동할지 출력)
//        node scripts/migrate-chats-to-users.mjs --apply    # 실제 이전
//
// Google Drive 자격증명(.env: GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN)이 필요 — OCI 서버에서 실행.

import { migrateChatsToUsers } from "../lib/chat/chat-drive.mjs";

const apply = process.argv.includes("--apply");

(async () => {
  console.log(`[migrate-chats] ${apply ? "APPLY" : "DRY-RUN"} 시작…`);
  try {
    const r = await migrateChatsToUsers({ dryRun: !apply, log: (m) => console.warn("  -", m) });
    console.log("[migrate-chats] 결과:", JSON.stringify(r));
    if (!apply && (r.moved || r.deduped)) {
      console.log(`[migrate-chats] 위 ${r.moved}건 이동 + ${r.deduped}건 중복정리 예정. 실제 적용: --apply`);
    }
    process.exit(0);
  } catch (e) {
    console.error("[migrate-chats] 실패:", e?.message || e);
    process.exit(1);
  }
})();
