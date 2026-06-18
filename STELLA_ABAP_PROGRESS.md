STATUS: DONE

# Stella ABAP — Build Progress

Stella GPT(`index.html`) 복제 → `abap.html`. **시스템 프롬프트·퀵프롬프트·브랜딩 3가지만** ABAP용 교체.
채팅/모델/과금/다운로드 인프라는 그대로 공유(중복 과금 0).

## 구조 매핑 (index.html에서 찾은 위치)
- 시스템 프롬프트: `send()` 내 `const system='당신은 Stella GPT입니다...'` (index.html ~900행) → abap.html에서 백틱 템플릿 ABAP 프롬프트로 교체.
- 모델 picker / 모델 목록: `ensureModelOptions()` + `#modelSelect` (재사용, 새 목록 정의 없음).
- 과금 분리 로직: 모델명 기반 분기 + `API_URL='/api/chat'` 단일 라우트(재사용).
- 채팅 fetch: `send()` → `callApi()` → `fetch(API_URL, ...)` (재사용).
- 퀵프롬프트: **기존 없음**(‘chips’는 첨부파일 칩) → abap.html에 ABAP 퀵프롬프트 바(`#abapChips`) 추가(추가 UI, `#chatInput` 재사용).
- 코드복사/마크다운/테이블 렌더·다운로드: index.html 복제로 동일 상속.
- 브랜드: `<title>`, 사이드바 `<h1>Stella Workspace</h1>` → "Stella ABAP / SAP ABAP 개발 어시스턴트".

## 작업 체크리스트
- [x] index.html → abap.html 복제
- [x] 시스템 프롬프트 ABAP용 교체(백틱 템플릿)
- [x] 퀵프롬프트 ABAP용 추가(18종, 클릭 시 입력창 삽입)
- [x] 타이틀/브랜딩 "Stella ABAP" 교체
- [x] 네비게이션: index·cc·hub + abap.html 에 Stella ABAP 링크 (talk/db는 앱스위처 없음 — 가정 로그 참조)
- [x] 모델 picker = Stella GPT 동일(ensureModelOptions 재사용)
- [x] 채팅 송수신 = 기존 라우트(/api/chat) 재사용
- [x] 코드블록/인라인 복사 = 복제 상속
- [x] 다운로드/내보내기 = 복제 상속
- [x] standalone 단일 HTML + manifest 공유(PWA)
- [x] sw.js 캐시 isHTML에 /abap 추가 + v17→v18
- [x] node --check(인라인) 전부 통과
- [x] 회귀: index/cc/hub/talk/db 인라인 문법 유지
- [x] main 푸시 → Vercel 자동 배포(트리거)

## 가정 로그 (질문 대신 내가 정한 것)
1. index.html에 퀵프롬프트 UI가 없어 → abap.html에 ABAP 퀵프롬프트 바를 **추가**(별도 `<script>`, `#chatInput` 재사용, 새 라우트/모델/키 없음).
2. talk.html / db.html 은 앱 스위처 네비가 없음 → 미변경(기존 한계). ABAP은 index·cc·hub·abap에서 상호 이동.
3. abap.html은 index.html 복제이므로 같은 출처 localStorage(세션/테마/사용자)를 공유 — 스펙의 "쌍둥이 + 인프라 한 벌" 의도에 부합.
4. 시스템 프롬프트는 줄바꿈·단일따옴표('Stella ABAP')가 있어 백틱 템플릿 리터럴로 교체(이스케이프 안전).
5. 표/OCR/다운로드 호환 문장 1줄을 ABAP 프롬프트 끝에 유지(앱의 마크다운 표·OCR·다운로드 동작 보존).

## Test Report (§9)
| # | 테스트 | 결과 |
|---|--------|------|
| 1 | JS 문법(`new Function` 추출) | abap.html 4 blocks **bad=0** ✅ |
| 2 | 페이지 브랜드 | `<title>`·`<h1>Stella ABAP</h1>` ✅ |
| 3 | 모델 선택 | `ensureModelOptions` 재사용(목록 미정의) ✅ |
| 4 | 채팅 송수신 | `API_URL='/api/chat'` 재사용 ✅ |
| 5 | ABAP 시스템 프롬프트 | "Stella GPT" 잔존 0, Clean ABAP/RAP/CDS 등 포함 ✅ |
| 6 | 퀵프롬프트 | `#abapChips` 18종, 클릭→`#chatInput` 삽입 ✅ |
| 7 | 코드 복사 | 복제 상속 ✅ |
| 8 | 다운로드 | 복제 상속 ✅ |
| 9 | Standalone/PWA | 단일 HTML + manifest 공유 ✅ |
| 10 | SW 캐시 | isHTML `/abap` + **v18** ✅ |
| 11 | 회귀 | index/cc/hub 문법 유지, cc 모듈 OK ✅ |
| 12 | **중복 과금 점검** | abap.html: 새 핸들러 0, 인라인 키 0, `/api/chat` 재사용, `ensureModelOptions` 재사용 → **신규 과금 경로 0** ✅ |

> 한계(정직): 실제 모델 응답·다운로드·PWA 설치 등 **런타임 동작**은 배포 환경(키)+브라우저 필요. 배포 URL은 Vercel 배포 보호(403)로 외부 확인 불가 — 코드/구조/문법은 모두 검증.
