# Stella AI Workspace — OCI 배포 가이드

Vercel 서버리스 앱을 OCI 자체 서버(161.33.4.91)에서 Node 서버로 구동합니다.
seo.이후.com 과 동일하게 NPM 리버스 프록시 + 도커 컨테이너 방식. **stella.이후.com** 으로 서비스.

> 왜 OCI? Vercel Hobby(무료)는 함수 60초 제한이라 vercel.json의 maxDuration:300(5분)
> SSE 스트리밍/긴 작업이 안 됩니다. OCI 자체 서버는 시간 제한이 없습니다.

## 구조
- `server.mjs` — Express 어댑터. Vercel 함수(api/*.js, export default handler(req,res))를
  그대로 실행 + 정적 서빙 + rewrites(/gpt→gpt.html 등) + CSP.
- `Dockerfile` — Node22, 앱 deps + express 설치 후 server.mjs 실행 (포트 8970)
- `.env.example` — 필요한 환경변수(시크릿) 목록
- `deploy/run-stella-oci.sh` — 빌드+실행 자동화

## 배포 단계 (OCI 서버에서)

### 1) 코드 가져오기
```bash
git clone https://github.com/yesblue0342-bit/stella-ai-workspace.git /opt/stella-ai-workspace
cd /opt/stella-ai-workspace
```
(이미 있으면 `git pull`)

### 2) 환경변수(.env) 작성 — ★가장 중요
```bash
cp .env.example .env
nano .env     # 실제 값 입력
```
가장 쉬운 방법: **Vercel에 이미 있는 값을 그대로 가져오기**
```bash
# Vercel CLI 설치 후
npx vercel login
npx vercel link        # stella-ai-workspace 프로젝트 선택
npx vercel env pull .env
```
또는 Vercel 대시보드 → Settings → Environment Variables 에서 복사.

### 3) 빌드 + 실행
```bash
bash deploy/run-stella-oci.sh
```

### 4) NPM Proxy Host 추가 (http://161.33.4.91:81)
- Domain Names: `stella.xn--hu5b23z.com`
- Scheme: http / Forward Hostname: `stella-workspace` / Forward Port: `8970`
- **Websockets Support 켜기** (SSE 스트리밍 필수)
- SSL 탭 → Request a new Certificate → Force SSL → Save

→ **https://stella.이후.com** 완성.

## 배포 후 확인해야 할 외부 설정
- **Google OAuth 리디렉션 URI**: Drive 로그인을 새로 하려면 Google Cloud Console에서
  `https://stella.이후.com/api/auth/callback` 를 승인된 리디렉션 URI에 추가.
  (이미 refresh token 이 .env 에 있으면 기존 Drive 접근은 그대로 동작)
- **Azure SQL 방화벽**: DB 연결이 안 되면 Azure portal에서 OCI 서버 IP(161.33.4.91)를
  SQL Server 방화벽 규칙에 추가.
- **API 동작 테스트**: `sudo docker exec stella-workspace curl -s http://127.0.0.1:8970/api/health`
  → `"ok": true` 면 DB까지 정상.

## 코드 수정 시 재배포
```bash
cd /opt/stella-ai-workspace && git pull && bash deploy/run-stella-oci.sh
```

## 자동 배포 (push → OCI, Vercel 대체)
`.github/workflows/deploy-oci.yml` 가 main push 시 OCI 서버로 SSH 접속해 `git reset --hard origin/main` +
`bash deploy/run-stella-oci.sh` 를 실행합니다(도커 재빌드/재실행).

**GitHub → Settings → Secrets and variables → Actions** 에 등록:
- `OCI_SSH_HOST` = `161.33.4.91`
- `OCI_SSH_USER` = `ubuntu` (서버 SSH 사용자)
- `OCI_SSH_KEY`  = SSH 개인키 전체(`-----BEGIN ...-----`)
- `OCI_SSH_PORT` = (선택) 기본 22
- `OCI_APP_DIR`  = (선택) 기본 `/opt/stella-ai-workspace`

> 시크릿 미설정이면 배포 단계는 건너뛰고 워크플로는 green. 등록하면 그때부터 push마다 자동 배포.
> 수동 트리거: Actions 탭 → "Deploy to OCI" → Run workflow.

## 참고
- `express`/`cookie-parser` 를 package.json dependencies에 포함시켜 `npm install && npm start`(= `node server.mjs`)로
  도커 없이도 구동 가능. (Dockerfile의 별도 express 설치는 백업용으로 유지)
- Vercel은 더 이상 사용하지 않음. `vercel.json`/`.vercelignore` 는 OCI 어댑터(server.mjs)가 rewrites/ignore 참고용으로만 읽음(무해).

## B. push 자동배포 — 상세 예시 (시크릿 4개)

### ① 배포 전용 SSH 키 1개 만들기 (로컬 PC 또는 OCI 서버에서)
```bash
ssh-keygen -t ed25519 -C "github-deploy-stella" -f ~/.ssh/oci_deploy -N ""
# 결과: ~/.ssh/oci_deploy(개인키), ~/.ssh/oci_deploy.pub(공개키)
```

### ② 공개키를 OCI 서버에 등록 (그 키로 ubuntu 로그인 허용)
```bash
ssh-copy-id -i ~/.ssh/oci_deploy.pub ubuntu@161.33.4.91
# (ssh-copy-id 없으면) 공개키 내용을 서버 ~/.ssh/authorized_keys 에 한 줄 추가:
#   cat ~/.ssh/oci_deploy.pub | ssh ubuntu@161.33.4.91 'cat >> ~/.ssh/authorized_keys'
# 접속 확인:
ssh -i ~/.ssh/oci_deploy ubuntu@161.33.4.91 'echo OK'
```

### ③ 서버에서 docker를 sudo 없이 (자동배포가 sudo 비번에서 안 멈추게)
```bash
ssh ubuntu@161.33.4.91
sudo usermod -aG docker $USER      # ubuntu 를 docker 그룹에 추가
exit                               # 재로그인(그룹 적용)
ssh ubuntu@161.33.4.91 'docker ps' # sudo 없이 동작하면 OK
# 앱 폴더/.env 준비(최초 1회):
sudo mkdir -p /opt/stella-ai-workspace && sudo chown $USER /opt/stella-ai-workspace
git clone https://github.com/yesblue0342-bit/stella-ai-workspace.git /opt/stella-ai-workspace
cd /opt/stella-ai-workspace && cp .env.example .env && nano .env   # 시크릿 입력
```

### ④ GitHub 레포 → Settings → Secrets and variables → Actions → New repository secret
| Name | Secret(예시) |
|------|--------------|
| `OCI_SSH_HOST` | `161.33.4.91` |
| `OCI_SSH_USER` | `ubuntu` |
| `OCI_SSH_KEY`  | `~/.ssh/oci_deploy` **개인키 파일 전체 붙여넣기**(`-----BEGIN OPENSSH PRIVATE KEY-----` … `-----END OPENSSH PRIVATE KEY-----`, 마지막 줄바꿈 포함) |
| `OCI_SSH_PORT` | (선택) `22` |
| `OCI_APP_DIR`  | (선택) `/opt/stella-ai-workspace` |

> 개인키 내용 복사: `cat ~/.ssh/oci_deploy` 출력 전체를 그대로 `OCI_SSH_KEY` 값에 붙여넣기.

### ⑤ 실행/확인
- GitHub → **Actions → "Deploy to OCI" → Run workflow**(또는 아무 커밋 push).
- 로그에서 `✅ OCI 재배포 완료` 확인. 이후 push마다 자동.
- 서버 확인: `ssh ubuntu@161.33.4.91 'docker ps && docker exec stella-workspace curl -s localhost:8970/api/health'`
