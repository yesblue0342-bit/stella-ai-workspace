# TEST RESULTS — Stella DB 다운로드 + 압축 한글명 복구

실행 시각: 2026-06-18 09:32:23 UTC
실행 환경: node v22.22.2 (의존성 0, `node tests/*.mjs`)

## tests/test_zipname.mjs (ZIP 한글 파일명 복구)
```
PASS  A1 CP949+무플래그 → 참고
PASS  A2 CP949+무플래그 → 프로그램 양식 참고
PASS  A3 UTF8+플래그 → 현상 확인
PASS  A4 UTF8+무플래그 → 자재마스터.xlsx
PASS  A5 ASCII 불변
PASS  B1 모지바케 → 프로그램 양식 참고
PASS  B2 정상 한글 불변(이중깨짐 방지)
PASS  B3 모지바케 → 자료 수집 현상 확인
PASS  B4 ASCII 불변
PASS  B5 널 안전(빈문자)
PASS  B6 단일 모지바케 → 참고
PASS  C1 경로 세그먼트별 복구

총 12건: 12 PASS / 0 FAIL
```
종료코드: 0

## tests/test_download.mjs (api/download.js 스트리밍 다운로드)
```
PASS  한글 status 200
PASS  Content-Disposition attachment 세팅
PASS  CD filename* UTF-8 포함
PASS  mimeType(Content-Type) 전달
PASS  Cache-Control no-store
PASS  바이트 일치
PASS  zip Content-Length 정확(3300000)
PASS  zip 바이트 전량 스트리밍
PASS  42MB status 200
PASS  42MB 바이트 전량 일치(스트리밍 완주)
PASS  구글네이티브 415
PASS  fileId 누락 400
PASS  존재X 404
PASS  미디어 실패 502
PASS  buildCD filename* UTF-8 인코딩
PASS  buildCD ASCII fallback에 비ASCII 없음

총 16건: 16 PASS / 0 FAIL
```
종료코드: 0

## 총합
- test_zipname: 총 12건: 12 PASS / 0 FAIL
- test_download: 총 16건: 16 PASS / 0 FAIL
- 전체: ALL PASS ✅
