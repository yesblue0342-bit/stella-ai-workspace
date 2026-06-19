# Stella ABAP 기본 모델 → GPT-4.1 mini

요청: Stella ABAP의 default AI 모델을 `gpt-4.1-mini`(라벨 "GPT-4.1 mini")로 변경. (오타 gpt-4-1-mini 아님)

## 변경 파일/내용
### `abap.html` (프론트)
1. **정적 select(`#modelSelect`)**: `gpt-5.5 selected` → 제거하고 `<option value="gpt-4.1-mini" selected>GPT-4.1 mini</option>` 추가(선택 기본값).
2. **`ensureModelOptions()`(2개 정의)**: 기본 fallback `sel.value||'gpt-5.5'` → `||'gpt-4.1-mini'`, `else sel.value='gpt-5.5'` → `'gpt-4.1-mini'`. (gpt-4.1-mini 옵션은 이미 목록에 존재 → 그대로 사용)
3. **send() 모델 fallback(line 846)**: `.value||'gpt-4o'` → `.value||'gpt-4.1-mini'`.
   → 저장된 사용자 선택이 없을 때(첫 로드/localStorage 미존재) 적용되는 default가 gpt-4.1-mini로 통일.

### `api/chat.js` (백엔드, /api/chat — 공용 라우트)
4. **모델 미지정 default(line 282)**: `body.model || "gpt-4o-mini"` → `"gpt-4.1-mini"`.
   - 참고: 이 라우트는 Stella GPT/cc/abap 공용. 단, 프론트는 항상 명시적 model을 보내므로 이 default는 **model 필드가 없는 요청에만** 발동(실사용 영향 최소). billing isolation 매핑(`mapToOpenAI`: gpt-4.1-mini→gpt-4.1-mini 등)은 **그대로 유지**.

## 유지된 것 (요구사항 6)
- 다른 GPT/Claude 옵션 전부 유지(gpt-5.5/5.5-pro/4.1/4o/4o-mini, claude opus/sonnet/haiku 등).
- billing isolation 라우팅(OpenAI/Anthropic 분기) 미변경 — default 값만 변경.
- 내부 유틸 호출(`api/chat.js`의 검색판정용 `model:"gpt-4o-mini"`, line 599)은 메인 채팅 default가 아니므로 미변경.

## 테스트 결과
| # | 검증 | 결과 |
|---|------|------|
| 1 | `node --check api/chat.js` | OK ✅ |
| 2 | abap.html 인라인 스크립트 4블록 파싱(new Function/module) | bad=0 ✅ |
| 3 | 정확한 식별자 `gpt-4.1-mini` 존재 / 오타 `gpt-4-1-mini` 없음 | ✅ / ✅ |
| 4 | 정적 select 기본 selected = gpt-4.1-mini | ✅ |
| 5 | ensureModelOptions fallback 2곳 = gpt-4.1-mini | ✅ |
| 6 | send() 모델 fallback = gpt-4.1-mini | ✅ |
| 7 | 잔존 `||'gpt-5.5'` / `else sel.value='gpt-5.5'` default 없음 | ✅ |
| 8 | gpt-5.5는 여전히 선택 가능한 옵션으로 유지 | ✅ |
| 9 | 백엔드 default(line 282) = gpt-4.1-mini | ✅ |
| 10 | SW 캐시 bump | stella-v26 → v27 ✅ |

## 한계
- 배포 보호(403)로 라이브 검증 불가 → 정적 검증(node --check, 인라인 파싱)·grep으로 대체. 실제 모델 응답은 배포 환경(OpenAI 키)에서 확인.
