/*
 * KST(Asia/Seoul) 날짜 유틸 — Stella Talk 첨부 보관용 (PROMPT PART E)
 *
 * Vercel serverless는 UTC로 동작하므로 서버 시간을 그대로 쓰면 한국 날짜와 어긋난다.
 * KST는 DST가 없어 항상 UTC+9 고정 → 9시간 더한 뒤 UTC 필드를 읽으면 KST 날짜가 된다.
 * 의존성 없음(ESM). 서버(api/*)와 테스트에서 사용.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// KST 기준 'YYYY-MM-DD' 문자열
export function kstDateString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) throw new Error("kstDateString: invalid date");
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 첨부 보관 경로 (실제 내 드라이브 루트 기준): 0가족 / 1_사진 / stella talk / [KST날짜]
export function familyPhotoPath(kstDate) {
  return ["0가족", "1_사진", "stella talk", kstDate];
}

// 편의: 지금(또는 주어진 시각)의 보관 경로
export function familyPhotoPathNow(date = new Date()) {
  return familyPhotoPath(kstDateString(date));
}

export const KST = { offsetMs: KST_OFFSET_MS };

// KST 기준 요일 (0=일 … 6=토)
export function kstWeekdayIndex(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) throw new Error("kstWeekdayIndex: invalid date");
  return new Date(d.getTime() + KST_OFFSET_MS).getUTCDay();
}

const KO_WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

// KST 기준 한국어 요일 문자열 ("월요일" 등)
export function kstWeekday(date = new Date()) {
  return KO_WEEKDAYS[kstWeekdayIndex(date)];
}

// 날짜 구분선 라벨: "2026년 6월 22일 월요일" (KST 기준)
export function kstDateLabel(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) throw new Error("kstDateLabel: invalid date");
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${kstWeekday(date)}`;
}
