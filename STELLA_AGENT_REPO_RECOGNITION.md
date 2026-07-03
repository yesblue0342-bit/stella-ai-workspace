# Stella Agent Code / Codex — GitHub 레포 인식 + OCI 자동배포

> 문제: **Stella Agent Code(/cc)** 와 **Stella Codex(/codex)** 가 GitHub 레포를 인식하지 못해
> 무인 자동 개발이 안 됨. **Stella Hub(/hub)** 는 정상 인식 → Hub 방식을 참조해 수정.

## 근본 원인
- **cc (Agent Code)**: Anthropic **Managed Agents** 세션을 `{type:"cloud", networking:unrestricted}` 환경으로만 생성하고
  **레포 소스를 세션에 마운트하지 않아** 샌드박스에 레포가 없었다 → 에이전트가 코드를 못 봄(빈손 작성).
- **codex (Codex)**: `/api/chat`(OpenAI) 채팅만 호출 → 레포 개념 자체가 없었다.
- **hub (정상)**: `/api/github?action=repos`(서버 `GITHUB_TOKEN`)로 레포 목록을 인식하고 파일을 브라우즈/읽기·쓰기.

## 수정 내용 (Hub 방식 참조)
1. **레포 선택기 추가** — `cc.html`·`codex.html` 상단 컨트롤바에 Hub와 **동일한** `/api/github?action=repos`
   목록 드롭다운(`#repoSel`). 기본값 `0Program`, 선택은 localStorage 기억(`stella_cc_repo`/`stella_codex_repo`).
2. **cc: 세션에 레포 마운트 (정식 방식)** — `api/cc/start.js` 가 선택한 레포를 Managed Agents **세션 리소스**로 마운트:
   ```json
   POST /v1/sessions { "agent":…, "environment_id":…, "resources":[
     { "type":"github_repository", "url":"https://github.com/OWNER/REPO",
       "mount_path":"/workspace/repo", "authorization_token":"<서버 GITHUB_TOKEN>" } ] }
   ```
   - 토큰은 **서버 env 에서만** 읽고 응답/로그/프롬프트에 노출하지 않는다(API 응답에도 에코되지 않음).
   - 샌드박스 git 이 clone/**push 까지 자동 인증** → RALPH 오토파일럿의 "커밋→push→배포" 루프가 실제로 닫힌다.
   - `lib/agentcore.mjs buildRepoPreamble()` 로 첫 메시지에 "레포가 `/workspace/repo`에 있으니 그 위에서 수정·push"를 안내.
   - **회귀 방지**: 베타 `resources` 스키마가 거부되면(4xx) 리소스 없이 재시도(기존 동작 유지). 5xx/인증오류는 그대로 실패.
3. **codex: 레포 인지형 채팅** — 코드실행 샌드박스가 없어, 레포 선택 시 루트 구조(`/api/github?action=contents`)를
   시스템 프롬프트에 주입해 레포 맥락 위에서 답변. 파일 자동편집·push 는 Agent Code(/cc) 안내.

## 검증
- `node --test test/repo-preamble.test.js` — 4/4 PASS (프리앰블 생성·기본값·**토큰 미포함** 가드).
- `tests/test_agentcore.mjs` — 19/19 PASS (기존 회귀 없음). 추가 export `buildRepoPreamble` 확인.
- `node --check` : `lib/agentcore.mjs`·`api/cc/_maclient.mjs`·`api/cc/start.js` 통과.
- `cc.html`·`codex.html` 인라인 모듈 스크립트 문법 통과.
- ⚠️ 라이브 검증(실제 Managed Agents 세션에 레포 마운트/에이전트 clone·push)은 **서버 `ANTHROPIC_API_KEY`+`GITHUB_TOKEN`
  이 있는 OCI 환경에서만** 가능 — 이 작업 환경에는 키가 없어 미검증. 배포 후 아래로 확인.

## OCI 자동배포
- `.github/workflows/deploy-oci.yml` 가 **main push 시 자동 재배포**(SSH → `git reset --hard origin/main` →
  `deploy/run-stella-oci.sh` → 스모크). 이미 구현돼 있으므로, 이 브랜치를 **main 에 병합하면 자동 배포**된다.
- 자동배포가 실제로 돌려면 레포 **Settings → Secrets and variables → Actions** 에 아래가 등록돼 있어야 한다
  (미설정 시 배포 단계는 건너뛰고 워크플로만 green):
  `OCI_SSH_HOST`(예 161.33.4.91) · `OCI_SSH_USER`(ubuntu) · `OCI_SSH_KEY`(개인키 전체) · (선택) `OCI_SSH_PORT`/`OCI_APP_DIR`.
- 서버 `.env` 필수: `GITHUB_TOKEN`(repo 스코프, 비공개 clone·push 용), `ANTHROPIC_API_KEY`, `GITHUB_OWNER`.
- 배포 후 확인: `/cc` 에서 레포 선택 → 프롬프트 전송 → 상태줄에 `📁 OWNER/REPO` 표시되면 마운트 성공.
