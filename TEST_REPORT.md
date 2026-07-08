# TEST_REPORT — Stella Talk 메신저 품질 전면 개선 (2026-07-08)

## 개요
스텔라톡(talk.html + /api/chat-room)의 만성 품질 이슈(지연·유실·미동작 UI·부정확한 읽음표시)의
**뿌리 원인**을 제거. 핵심은 "모든 채팅 요청이 매번 Google Drive를 왕복"하던 구조를
서버 인메모리 캐시 + 방별 직렬화 큐로 바꾼 것.

## 뿌리 원인 진단
| # | 원인 | 증상 |
|---|---|---|
| 1 | 폴링 1회(get)=Drive API ~4콜, 방 목록 1회=방 수×4콜을 클라마다 2~3초 주기 반복 | 응답 수 초 지연, Drive 429 쿼터 고갈 → 전송/조회 실패 |
| 2 | send/react/delete가 잠금 없는 read-modify-write | 동시 전송 시 상대 메시지 통째 유실 |
| 3 | 사용자 검색 드롭다운의 onmousedown 속성에 JSON.stringify(쌍따옴표) 삽입 → 속성 잘림 | 검색 결과 클릭이 아예 동작 안 함(멤버 초대 불가) |
| 4 | 타이핑 표시가 입력 2초마다 Drive 쓰기 | 쿼터 소모 + 지연 |
| 5 | 백그라운드 탭 폴링이 읽음 처리 | 상대 화면의 "1"이 실제로 안 읽었는데 사라짐 |
| 6 | 방 목록이 로컬 캐시만 표시 | 다른 기기/새 기기에서 미리보기 "대화가 없습니다", 안읽음 뱃지 0, 대화해도 순서 안 바뀜 |
| 7 | 롱폴 엔드포인트는 있으나 미사용(USE_LONGPOLL=false) + 서버 롱폴이 1.2초마다 Drive 재읽기 | 실시간성 없음 |

## 변경 파일
| 파일 | 내용 |
|---|---|
| `lib/chat-store.js` (신규) | 인메모리 캐시 + 방별 직렬화 쓰기 큐 + Drive write-through(파일ID 캐시로 쓰기=API 1콜) + EventEmitter. typing 메모리 전용, reads 8초 write-behind, 60초 인덱스 재검증(외부 변경 감지) |
| `api/chat-room.js` | chat-store 기반 재작성. clientId 멱등(재시도 중복 저장 금지), list에 per-user unread, since 증분 응답에서 room.messages 제거(페이로드 절감). 403/503 계약 유지 |
| `api/chat-room-sse.js` | Drive 폴링 루프 → 이벤트 기반 롱폴(대기 중 Drive 0콜, 새 메시지 즉시 반환) |
| `api/push-subscribe.js` (신규) + `lib/push-send.js` (신규) | Web Push 구독/발송. VAPID 키 미설정 시 완전 no-op. send 성공 시 방 멤버(발신자 제외)에 푸시 |
| `api/user-search.js` | 검색마다 사용자 수×Drive read → 60초 인메모리 캐시 |
| `talk.html` | ①드롭다운 클릭 버그 수정(DOM+클로저) ②esc() 따옴표 이스케이프 ③사이드바 최근 대화순 정렬+서버 lastMessage/시각/unread 표시 ④백그라운드 탭 읽음 처리 금지 ⑤롱폴 연결(실패 시 기존 적응형 폴링 폴백) ⑥sendBtn id 부여 ⑦알림 닫기 태그 수정 ⑧멤버 칩/친구 목록 DOM 재작성 |
| `package.json` | web-push 의존성 추가 |
| `test/chat-store.test.js` (신규) | 동시 전송 20건 직렬화 유실 0 / 캐시 히트 Drive 0콜 / 쓰기 실패 롤백 / typing Drive 0콜 / 롱폴 즉시 wake / unread 계산 — 6케이스 |
| `test/chat-room-api.test.js` (신규) | send→get→read→list 왕복, clientId 멱등, 비멤버 403, since 증분, leave 멱등 — 통합 1케이스 |

## 검증
- `node --check` 전체 통과, talk.html 인라인 JS `new Function` 파싱 0오류
- jsdom 초기화 + 스모크(칩 렌더/롱폴 함수 존재) 통과
- `npm test` **346/346 통과** (기존 336 + 신규 10, 기존 소스 계약 테스트 포함)
- **멀티에이전트 적대적 리뷰**(동시성/실시간/UI호환/백엔드계약 4관점 병렬 + 발견별 독립 검증) 확정 6건 전부 수정:
  | 심각도 | 발견 | 수정 |
  |---|---|---|
  | critical | loadRoom 잠금 밖 캐시 write-back이 잠금 안 쓰기를 덮어써 메시지 유실 | read 완료 후 캐시 재확인 + 방별 in-flight load promise 공유(동시 미스 1콜) |
  | critical | send의 createdAt이 잠금 밖에서 찍혀 커서(since)가 큐 대기 메시지를 영구 건너뜀 | createdAt/id 를 방 잠금 '안'에서 스탬프(가시화≈createdAt 보장) |
  | major | 롱폴이 sync 완료 전 재무장 + 커서 미전진 시 핫루프(멤버 제외 후 403+sse 200) | sync await 후 재대기 + sse lastMessageAt 로 커서 강제 전진 |
  | major | syncRoomFromServer가 await 후 방 전환 미확인 → 옛 방 스톰프 + 안 보는 방 읽음 처리 | await 후 `_cur.id!==roomId` 가드 + idx 재해석 |
  | major | chat-room-sse 멤버십 검증 부재(임의 roomId 실시간 열람) | get 과 동일한 isMember 403 게이트 추가 |
  | major | loadMeta가 일시 Drive 오류를 reads={}로 영구 캐시 → flush가 타 사용자 읽음기록 파괴 | '파일없음'과 '읽기오류' 분리, 오류 시 ephemeral(미캐시)+flush 차단 |

## 성능 효과 (서버 Drive API 호출 기준)
| 경로 | 이전 | 이후 |
|---|---|---|
| 메시지 폴링(get) | ~4콜/회 × 1-2초 | **0콜** (캐시) |
| 방 목록(list) | 방 수×4콜/회 × 3초 | **0콜** (60초마다 1콜 재검증) |
| 타이핑 알림 | ~4콜/입력 2초 | **0콜** (메모리) |
| 읽음 처리 | ~4콜/회 | 0콜 즉시 + 8초 배치 1콜 |
| 메시지 전송 | ~4콜 | **1콜** (파일ID 캐시 update) |
| 실시간 수신 | 폴링 1~4초 | 롱폴 즉시(이벤트), 폴백 폴링 |

## 백그라운드 푸시 활성화 방법 (선택)
앱이 꺼져 있어도 알림을 받으려면 OCI `.env`에 VAPID 키 추가 후 재배포:
```
npx web-push generate-vapid-keys
# .env 에 추가
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:yesblue0342@gmail.com
```
키가 없으면 기존 폴링 알림만 동작(무해). ⚠️ 푸시 구독 API(`/api/push-subscribe`)는 앱 전반과 동일하게
userId 를 신뢰한다(별도 세션 토큰 검증 없음 — 기존 chat-room API 와 같은 보안 모델). 키 활성화 시
알림 본문 노출 범위를 고려할 것.

## 한계 (정직)
- 실제 송수신·푸시는 배포 환경(Drive 자격증명, 실브라우저)에서 최종 확인 필요. 샌드박스는
  가짜 Drive I/O 주입 통합 테스트 + 정적/jsdom 검증까지 수행.
- 서버 재시작 시: 미플러시 읽음표시(최대 8초치)와 typing 상태만 유실(메시지는 write-through로 보존).
