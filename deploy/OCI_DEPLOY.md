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
