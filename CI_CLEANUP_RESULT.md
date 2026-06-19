# 실패 CI 워크플로 제거 결과

## 1. 워크플로 조사
`.github/workflows/`에 있던 워크플로 + Actions 런 결과(이력) 집계:
| 워크플로 | 런 결과 | 상태 |
|----------|---------|------|
| `patch-auth.yml` | **failure 8/8** | 이미 삭제돼 있었음(파일 없음) |
| `patch-index.yml` ("Patch index.html") | success 7 / **failure 3+2** | 이번에 삭제 |
| `patch-member-chat.yml` ("Patch member chat layout") | success 1 / **failure 1** | 이번에 삭제 |

- 이 둘은 **npm test/node --test가 없는** "패치 자동화" 워크플로다(스크립트로 index.html을 수정·**자동 커밋**). 즉 Vercel 배포와 무관하고, 실패 시 빨간 체크 노이즈 + main 자동 커밋 churn을 유발.
- 패치 내용(인증 UI / member-chat 레이아웃)은 이미 앱(index.html)에 반영돼 있어 워크플로는 **레거시(불필요)**.

## 2. 조치
- **`.github/workflows/patch-index.yml` 삭제** (commit `bff6180`)
- **`.github/workflows/patch-member-chat.yml` 삭제** (commit `a79ffbc`)
- 워크플로 파일은 `workflow` 토큰 스코프가 필요해 **GitHub API(App 권한)로 삭제**(로컬 git push 스코프 회피).
- 결과: `.github/workflows/` 비어 있음 → 더 이상 실패 CI 체크/자동 커밋 없음.
- "CI는 두고 빨간불만 없애는" 옵션(테스트 단계 `continue-on-error:true`)은 **대상 워크플로에 테스트 단계가 없어 해당 없음** → 노이즈 워크플로 자체 삭제가 정답.

## 3. Stale PR
- **PR #1**("Add custom search engine support…")은 **이미 closed**(2026-06-17, merged=false) → 추가 조치 불필요.

## 4. 영향
- Vercel 배포는 GitHub 연동 자동 배포로 동작하며 이 워크플로들과 **무관** → 삭제해도 배포 영향 0.
- 앞으로 이 레포의 GitHub Actions 실패 체크(빨간불) 노이즈 없음.

## 한계
- 과거 실패 런 이력 자체는 GitHub Actions 히스토리에 남지만(표시용), **새 실패는 발생하지 않음**. 필요 시 GitHub UI에서 옛 워크플로 런 기록 수동 삭제 가능.
