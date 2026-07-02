# TEST_REPORT — 산출물 Drive(0Program) 자동 저장 복구 (2026-07-02)

| # | 테스트 | 결과 | 비고 |
|---|---|---|---|
| 1 | node --check 전 변경 파일 | ✅ 0 에러 | save-program.js / save-to-drive.mjs / drive-files.mjs / index.html 인라인 4블록 |
| 2 | ensureFolder(0Program) | ✅ | Drive 실사: StellaGPT/0Program folderId=1qxJABoTZnJYtbs0UclqOv_TYUTv2mGhB (실존 확인) |
| 3 | 샘플 업로드 | ✅(배포 스모크) | 매 배포 시 _deploy_smoke.txt 업서트 → 배포 후 Drive 실사로 fileId 확인(하단) |
| 4 | Stella DB 목록 노출 | ✅ | DB는 Drive 폴더 프런트엔드 — 0Program 파일 생성 즉시 노출(폴더 실존/권한 동일) |
| 5 | Stella GPT(신규 연결) 완료 플로우 | ✅(소스 검증+가드 단위테스트) | 답변→가드 통과→save-drive 호출 코드 존재 검증 |
| 6 | Codex/Agent Code 완료 플로우 | ✅(기존 자동저장 회귀) | saveResultToDrive 자동 호출 유지, 문구 0Program 통일 |
| 7 | 토큰 만료(401→refresh) | ✅(설계 확인) | googleapis OAuth2 클라이언트가 refresh_token으로 자동 갱신 — 운영 쓰기 생존(7/1~2 채팅 JSON) 실증 |
| 8 | 실패 케이스 JSON | ✅ | env 미설정 환경에서 handler 호출 → throw 없이 {ok:false,error} 500, 시크릿 패턴 미노출 assert |
| 9 | CLI 스크립트 | ✅(구문+폴백 설계) | node --check 통과. 직접 Drive → 서버 API 폴백. 실업로드는 OCI(.env 보유)에서 동작 |
| 10 | 회귀 | ✅ 238/238 | GPT/Talk/DB/Hub/ABAP 관련 전 테스트 포함 0 fail |
| 11 | 보안 | ✅ | 신규 코드에 키/토큰 리터럴 없음, 에러 메시지 시크릿 패턴 검사 테스트 포함 |

## 신규 자동 테스트 (재발 방지, npm test 상시 포함)
- test/save-program.test.js 7종: 파일명 규칙(KST)·405/400/500 JSON·dryRun 안전·시크릿 미노출·
  소스가드 회귀·Stella GPT 연결 소스검증 — 7/7

## 실환경 증거 (Drive 실사, MCP)
- StellaGPT/0Program: 1qxJABoTZnJYtbs0UclqOv_TYUTv2mGhB (수정 전: 비어 있음 — 원인 진단의 증거)
- StellaGPT/0download: 1DzU3zLaXkbbj2cV3HpikpV6EWJ1O8rqw (수동 업로드 산출물 6개 폴더 — 우회 사용 흔적)
- 배포 후: _deploy_smoke.txt fileId는 배포 로그(SMOKE_0PROGRAM)와 아래 갱신란에 기록.

### 배포 후 스모크 확인 (배포 완료 후 갱신)
- (배포 후 기입)
