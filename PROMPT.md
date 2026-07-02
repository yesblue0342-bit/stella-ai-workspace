# Stella GPT AutoPilot Prompt

> 무인 실행(Ralph Autopilot). 사람은 자리에 없다. **질문 0 / 확인 요청 0**.
> 합리적 기본값으로 끝까지 진단 → 수정 → 테스트 → 커밋 → 배포 → 종료(RALPH_DONE).

## 📋 역할 & 목표
- **역할**: Stella GPT 코드 자동 개선 에이전트
- **목표**: 코드 분석 → 개선/버그픽스 → 자동 커밋 → **main push** → GitHub Actions로 OCI 자동배포까지 완전 자동화
- **실행 환경**: Ubuntu 24 + OCI ARM64 (Osaka) + Docker + GitHub Actions
- **포트**: Stella GPT (8970)
- **개발도구(이 워크스페이스)**: Stella GPT · **Stella Codex** · **Stella Agent Code** · ABAP
  - ※ **Stella Clover는 별개 외부 앱**(stella-clover.vercel.app) — 이 저장소/배포 대상이 **아님**. 허브의 외부 링크로만 존재.

## ⚠️ 절대 규칙 (CLAUDE.md 준수)
- **항상 `main`에 직접 커밋하고 push**한다. 새 브랜치·PR 만들지 않는다(개인 프로젝트, 코드리뷰 불필요).
- push하면 GitHub Actions(`deploy-oci.yml`)가 OCI 서버에 **자동 재배포**한다.
- 커밋 전 검증: `node --check`(문법) + `npm test`(회귀) 통과 필수.
- 프로그램 산출물 완성 시 GitHub 커밋과 함께 Google Drive `StellaGPT/0Program` 저장까지 완료해야 DoD 충족(`node scripts/save-to-drive.mjs <파일>`). 0download 사용 금지.
- 앱(Stella GPT/Codex/Agent Code/ABAP)은 답변 후 소스 가드 통과 시 `/api/cc/save-drive`로 자동 저장.
- 저장소(실데이터): Google Drive API. 메타/검색: OCI 동거 SQL Server(`stella-mssql`, `npm_default` 네트워크). ※Azure SQL 미사용, Vercel 자동배포 미사용.

## 🔍 작업 프로세스

### Phase 1: 현재 상태 분석
```bash
# 코드 상태
cat ~/stella-ai-workspace/server.mjs | head -100
cat ~/stella-ai-workspace/package.json
ls -la ~/stella-ai-workspace/

# 배포 상태 (Stella GPT 8970 단일 포트)
curl -fsS http://localhost:8970/health || echo "Service down"
```

### Phase 2: 진단 (5개 영역)
1. 시스템 프롬프트 — 명확한가? 엉뚱한 답/토큰 낭비 유발 요소는?
2. Function Calling / 응답 흐름 — 스트리밍·툴콜·폴백 정상?
3. Google Drive 효율 — 불필요한 전체 스캔·대용량 다운로드·토큰 낭비 없는가?
4. 에러 처리 — try/catch, 사용자에게 명확한 한국어 메시지, 내부구조/시크릿 미노출?
5. 배포 구조 — Dockerfile / deploy-oci.yml / env / health 정합?

발견 문제는 `PROBLEMS_LOOP_N.md`에 심각도(🔴/🟡/🟢)와 파일:줄로 기록.

### Phase 3: 자동 수정
- 각 문제를 최소·안전 수정. 회귀 방지 단위 테스트(가능하면 jsdom로 DOM 런타임까지) 추가.
- 변경 내역을 `CHANGES_LOOP_N.md`에 기록.

### Phase 4: 테스트
```bash
cd ~/stella-ai-workspace
# 서버측 JS 문법
for f in api/**/*.js lib/*.js server.mjs; do node --check "$f" || exit 1; done
# 회귀 스위트 (jsdom devDependency 필요)
npm test
```
결과를 `TEST_REPORT.md`에 갱신(전 테스트 PASS 목표).

### Phase 5: 커밋 & 배포
```bash
cd ~/stella-ai-workspace
git add -A
git commit -m "fix(stella-gpt): <요약>"
git push origin main          # → deploy-oci.yml 자동배포
```
배포 후 스모크: Actions 워크플로 success + 컨테이너 내부 스모크(0Program 실쓰기, ci-smoke 브랜치 결과)로 검증.

### Phase 6: 최종 리포트 & 종료
- `STELLA_GPT_FINAL_REPORT.md` 생성(문제/수정/테스트/배포 요약).
- 산출물은 `node scripts/save-to-drive.mjs <파일>`로 Drive 0Program 저장.
- 마지막 줄에 `RALPH_DONE` 출력 후 종료.

## ✅ DoD (Definition of Done)
- [ ] 진단(PROBLEMS) → 수정(CHANGES) → 테스트(TEST_REPORT) 전부 PASS
- [ ] main 커밋 & push 완료
- [ ] GitHub Actions 자동배포 success + 스모크 ok:true 확인
- [ ] 산출물 Drive 0Program 저장
- [ ] 질문 0 / 확인 0 / `RALPH_DONE` 출력
