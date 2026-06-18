// tests/test_zipname.mjs — ZIP 한글 파일명 복구 로직 검증 (의존성 0, node로 실행)
import { decodeZipName, repairMojibakeName, repairMojibakePath } from "../lib/zipname.js";

let pass = 0, fail = 0;
function A(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
}
// 모지바케(Latin1) 문자열 → 원본 CP949 바이트
const b = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const u8 = (s) => new TextEncoder().encode(s); // UTF-8 바이트

// ── A: decodeZipName (raw 바이트 + UTF-8 플래그) ──
A("A1 CP949+무플래그 → 참고", decodeZipName(b("Âü°í"), false), "참고");
A("A2 CP949+무플래그 → 프로그램 양식 참고", decodeZipName(b("ÇÁ·Î±×·¥ ¾ç½Ä Âü°í"), false), "프로그램 양식 참고");
A("A3 UTF8+플래그 → 현상 확인", decodeZipName(u8("현상 확인"), true), "현상 확인");
A("A4 UTF8+무플래그 → 자재마스터.xlsx", decodeZipName(u8("자재마스터.xlsx"), false), "자재마스터.xlsx");
A("A5 ASCII 불변", decodeZipName(b("report_2024.pdf"), false), "report_2024.pdf");

// ── B: repairMojibakeName (이미 깨진 문자열 복구) ──
A("B1 모지바케 → 프로그램 양식 참고", repairMojibakeName("zaqmr0040 ÇÁ·Î±×·¥ ¾ç½Ä Âü°í"), "zaqmr0040 프로그램 양식 참고");
A("B2 정상 한글 불변(이중깨짐 방지)", repairMojibakeName("현상 확인.xlsx"), "현상 확인.xlsx");
A("B3 모지바케 → 자료 수집 현상 확인", repairMojibakeName("ÀÚ·á ¼öÁý Çö»ó È®ÀÎ"), "자료 수집 현상 확인");
A("B4 ASCII 불변", repairMojibakeName("report_2024.pdf"), "report_2024.pdf");
A("B5 널 안전(빈문자)", repairMojibakeName(null), "");
A("B6 단일 모지바케 → 참고", repairMojibakeName("Âü°í"), "참고");

// ── C: repairMojibakePath (경로 세그먼트별) ──
A("C1 경로 세그먼트별 복구", repairMojibakePath("Æú´õ/Âü°í.txt"), "폴더/참고.txt");

console.log(`\n총 ${pass + fail}건: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
