# Stella Memory — Decisions (data integrity > security > personalization > scalability > speed)

- 안 3 채택: 기존 Drive 메모리를 **Azure SQL로 교체(soft)**. 중복 0이 사용자 1순위 원칙에 부합.
- **인증**: 새 JWT/google-auth-library 도입 안 함 → 기존 앱 패턴(userId를 요청 바디/쿼리로 전달) **재사용**. 단일 사용자 워크스페이스 전제. (보안: 다중사용자 공개 시 서버측 세션검증으로 강화 필요 — 후속.)
- **lib/db.js 미변경**: 기존 ESM 풀(getPool/sql) 재사용. 프롬프트의 CommonJS 버전은 ESM 레포와 비호환이라 폐기.
- **인증·파일탐색기 미변경**: 이미 구현됨(api/auth*, db.html+api/drive-manage) → 순수 중복이라 프롬프트의 lib/auth.js·api/files/* 폐기.
- **graceful + Drive 폴백**: Azure 미연결/실패 시 buildMemoryContext는 ""(빈값) 반환 → chat.js가 기존 Drive 메모리로 폴백. 데이터 유실/앱 파손 방지(soft 전환). 운영에서 Azure 확인 후 Drive 경로 제거 예정.
- **신규 의존성 0**: mssql만 사용(이미 존재). jsonwebtoken/google-auth-library/archiver 불필요.
