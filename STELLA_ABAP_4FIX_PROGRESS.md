# Stella AI Workspace 4건 수정 (abap.html 중심)

대상: `abap.html` (Stella ABAP) + `sw.js`. Stella GPT(`index.html`)는 **미변경**(작업2 ⚠️ 준수).

## 작업 1 — 바로가기에 Stella GPT 추가 (Stella DB 위)
- abap.html 사이드바 "바로가기" 맨 위에 `✨ Stella GPT` 항목 추가, 링크 `href="/"`(Stella GPT 메인 채팅=index.html 진입점).
- 순서: **Stella GPT → Stella DB → Stella ABAP → Agent Code → Cloud → Talk → Hub**.
- 이 사이드바가 Stella ABAP 화면의 사이드바이므로 ABAP→GPT 이동 목적 충족.

## 작업 2 — Stella ABAP 답변 스타일 분리 (일반 ChatGPT 방식)
- `send()` 내 `const system=` 템플릿(기존: 'Stella ABAP' 컨설턴트식/강제 표 포맷)을 **요청한 새 프롬프트로 전량 교체**(독립 상수, abap.html에만 존재).
- 새 프롬프트: 대화체·간결 산문, 표 남용 금지, 코드블록(```abap), 한국어+영어 기술용어, 전문영역(classic/modern ABAP·인터페이스·폼·Enhancement·성능·Clean ABAP·S/4HANA).
- 백틱 이스케이프: 프롬프트 내 ```abap 펜스를 JS 템플릿 안전하게 `\`\`\`abap`로 처리.
- **Stella GPT(index.html) system prompt 미변경** 확인(git diff 빈 출력).

## 작업 3 — 프로젝트 카테고리 QM 폴더 중복 제거
- **원인 판단: 같은 ID 중복(렌더/저장 이중화)**. 근거: `renderProjectTree()`는 `projects` 배열을 그대로 map → 같은 id 항목이 2개면 QM이 2번 렌더되고 각각 `projectRooms(sameId)`로 동일 18을 셈 → "18=18 두 개". (rooms가 복제됐다면 36이 됐을 것이므로 rooms 아닌 projects 배열 중복)
- **수정**: `loadData()`에서 `projects=dedupeById(read(...).filter(ownerMatch))` — **stable id 기준 dedupe 가드** 추가. 첫 항목만 유지하여 QM 1개로 표시.
- **데이터 유실 없음**: 동일 id라 채팅(rooms)은 그대로 그 id를 참조; 저장(saveProjects)은 in-메모리 deduped 목록을 기록해 다음 저장 시 storage도 자가 치유. (서로 다른 id의 별개 레코드였다면 dedupe가 둘 다 보존 → 유실 0)

## 작업 4 — Stella ABAP 추천 프롬프트 바 접기/펴기
- `#abapChips` 빌더를 래퍼(`#abapChipsWrap`) + 토글 버튼(`#abapQpToggle`, "추천 프롬프트 ▾/▴")으로 감쌈.
- **기본 접힘(collapsed)**, 상태를 `localStorage['abap_qp_open']`에 저장(다음 방문 유지).
- 접으면 chips 숨겨 입력창 위 공간 확보. 펼침 시 `overflow-x:auto`로 가로 스크롤(텍스트 잘림 정리).

## 테스트 결과
| # | 검증 | 결과 |
|---|------|------|
| 1 | abap.html 인라인 스크립트 4블록 `new Function` 파싱 | bad=0 ✅ |
| 2 | 작업1: 바로가기 맨 위 Stella GPT(/)·Stella DB 앞 | ✅ |
| 3 | 작업2: 새 프롬프트 적용 + 구 컨설턴트 프롬프트 제거 + 펜스 이스케이프 | ✅ |
| 4 | 작업2: index.html(Stella GPT) 미변경(diff 0) | ✅ |
| 5 | 작업3: `dedupeById` 가드 적용 | ✅ |
| 6 | 작업4: 토글·기본접힘·localStorage 키 | ✅ |
| 7 | SW 캐시 bump | stella-v28 → v29 ✅ |

## 한계
- 배포 보호(403)로 라이브 검증 불가 → 정적 검증(new Function)·grep으로 대체. 실제 동작은 배포 후 브라우저에서 확인.
- 작업3은 같은-id 중복을 전제로 한 안전 dedupe. 만약 사용자 데이터가 서로 다른 id의 두 QM이라면 둘 다 유지되며(유실 0) 수동 병합 필요 — 진행 중 데이터 손상 없음.
