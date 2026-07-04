# Stella Codex(/codex) — 무인 자동화 (OpenAI 백엔드)

> 사용자 요청: "Stella Codex도 Stella Agent Code처럼 개발도구야. 차이는 API사(OpenAI vs Claude)뿐,
> 무인 자동화(clone·수정·커밋·push)가 동일하게 되어야 해."

## 이전 상태
Codex는 `/api/chat`(OpenAI 채팅 API) 한 번 호출로 끝나는 **순수 채팅**이었다(파일시스템·git 접근 없음).
레포 선택기는 루트 파일 목록을 시스템 프롬프트에 텍스트로 끼워넣는 수준("레포 인지형 채팅")이었다.

## 왜 cc와 똑같이 만들 수 없었나 — 그리고 실제로 한 것
**cc(Agent Code)**는 Anthropic **Managed Agents**의 호스팅 클라우드 샌드박스(세션당 격리된 원격 VM)에
레포를 마운트해 그 격리 환경 안에서 git을 실행한다. **OpenAI 쪽엔 이런 호스팅 샌드박스 제품이 없다** —
Chat Completions API는 순수 텍스트 함수호출(tool calling)만 제공하고, 실제 명령 실행은 호출하는
쪽(=이 서버)이 책임져야 한다.

그래서 Codex의 git/파일 조작은 **이 OCI 서버 프로세스 자신이 직접 수행**한다:
1. 요청마다 `/tmp`에 임시 디렉터리를 만들고 대상 레포를 `--depth 1` clone.
2. OpenAI Chat Completions **함수호출(tools) 루프**로 모델이 `list_dir`/`read_file`/`write_file`/
   `delete_file`/`git_commit_and_push`를 호출하며 실제 파일을 읽고 고친다.
3. 모델이 `git_commit_and_push`를 호출하면 실제로 `git commit && git push`.
4. 응답 후 임시 디렉터리 즉시 삭제(세션 상태 없음, 매 요청 fresh clone).

## 의도적으로 안 한 것 — 임의 `bash` 실행 미제공
cc의 RALPH 프롬프트는 Anthropic이 제공하는 **격리된 원격 샌드박스** 안에서 자유롭게 `bash`/`npm test`를
실행한다. 하지만 Codex는 **다른 모든 Stella 앱과 같은 프로덕션 컨테이너** 안에서 실행되므로, 원격 LLM이
임의 셸 명령을 그 컨테이너에 직접 실행하게 하는 것은 격리가 없어 위험도가 다르다(예: `rm -rf`, 다른 앱의
`.env` 탈취, 아웃바운드 네트워크로 시크릿 유출 등). 그래서 Codex 도구는 **구조화된 파일 I/O + git
commit/push로만 제한**했다 — 실제 코드 편집·커밋·push는 되지만, 테스트 실행이나 `npm install`은
안 된다(시스템 프롬프트로 모델에게 명시). 진짜 임의 명령 실행까지 필요하면 OCI에 세션별 격리 컨테이너
(Docker-in-Docker 등) 인프라를 별도로 구성해야 하며, 이는 인프라 변경이라 사용자 확인 후 별도 진행 권장.

## 변경 파일
- **`lib/codex-agent.mjs`**(신규): 순수 함수호출 루프(`runCodexAgentLoop`). `callOpenAI`/`runTool`을
  주입받는 구조라 네트워크·파일시스템 없이 단위테스트 가능.
- **`lib/codex-workspace.mjs`**(신규): 임시 워크스페이스 clone/삭제, 경로탈출·`.git/`·`.env` 차단
  (`api/github.js`의 `assertSafePath`와 동일 정책), `list/read/write/delete`, `commit+push`.
  - git push 네트워크 호출에만 `http.extraheader`로 토큰 임시 사용 — **디스크(.git/config)에 토큰을
    저장하지 않는다**(로그/모델의 `read_file`로도 노출 안 됨, `.git/` 자체도 차단).
- **`api/codex/agent.js`**(신규): `POST {prompt, owner, repo, branch, model}` → clone → 함수호출 루프 →
  `{text, steps, committed}` 반환. 서버 `GITHUB_TOKEN`/`OPENAI_API_KEY` 사용(응답에 미노출).
- **`codex.html`**: 레포 선택 시 `/api/codex/agent`로 라우팅(도구 스텝 렌더링 포함, cc.html과 동일 UX).
  **레포 미선택 시엔 기존 `/api/chat` 순수 채팅 그대로 — 회귀 없음.**
- **`Dockerfile`**: `git` 바이너리 설치 추가(이전엔 cc가 원격 샌드박스를 썼기 때문에 이 컨테이너엔
  git이 필요 없었음 — Codex가 처음으로 이 컨테이너 안에서 git을 직접 실행하는 기능).

## 검증
- `test/codex-agent.test.js` 7/7 PASS — 루프 제어흐름(정상종료/멀티툴/에러복구/최대반복/JSON파싱실패).
- `test/codex-workspace.test.js` 16/16 PASS — 경로탈출·`.git/`·`.env` 차단, read/write/delete/list.
- 기존 `tests/test_agentcore.mjs`(19) · `test/repo-preamble.test.js`(4) 회귀 없음.
- `node --check` 전 파일 통과, `codex.html` 인라인 모듈 문법 통과.
- ⚠️ 실제 clone/커밋/push의 라이브 검증은 서버 `GITHUB_TOKEN`+`OPENAI_API_KEY`+git 바이너리가 있는
  OCI 배포 환경에서만 가능(이 개발 환경엔 없음) — 배포 후 `/codex`에서 레포 선택 후 전송 시 확인.
