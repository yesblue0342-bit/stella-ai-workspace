# Stella DB — 하위 폴더 이동 아이콘 개선

## 증상 (스크린샷)
모바일 Stella DB(`db.html`) 파일 브라우저에서 폴더 행(노트, yesblue0342)에 **하위 폴더로 들어가는 아이콘/affordance가 없음**. 행에는 체크박스+폴더아이콘+이름+날짜만 보임.

## 원인
1. 폴더 진입은 이미 `openItem()→loadFolder()`로 동작하나, **시각적 단서(아이콘)가 없어** 모바일에서 "탭하면 들어간다"를 알 수 없음.
2. 행 액션 버튼(✏️ 이름변경 / 🗑 삭제)이 `.file-acts{opacity:0}` + `.file-row:hover .file-acts{opacity:1}` 으로 **hover에서만 표시** → 터치 기기(모바일)는 hover가 없어 **아이콘이 아예 안 보임**(스크린샷과 일치).

## 수정 (`db.html`)
1. **폴더 행에 항상 보이는 `›` 열기 아이콘 추가** (`.enter-folder`):
   - 폴더(`f.isFolder`)에만 렌더, 우측에 큰 터치 타깃(32px), `aria-label="폴더 열기"`.
   - 클릭 시 `loadFolder(f.id,f.name)` → 하위 폴더 진입. (행 이름/아이콘 탭 진입도 그대로 유지)
2. **터치 기기에서 액션 아이콘 표시**: `@media (hover:none){.file-acts{opacity:1}}` 추가 → 모바일에서도 ✏️/🗑/⬇ 보임(스크린샷의 "아이콘 없음" 근본 해소).
3. SW 캐시 `stella-v29 → v30`.

## 테스트 결과
| # | 테스트 | 결과 |
|---|--------|------|
| 1 | db.html 인라인 JS `new Function` 파싱 | bad=0 ✅ |
| 2 | `.enter-folder` CSS 존재 | ✅ |
| 3 | `@media (hover:none)`로 `.file-acts` 표시 | ✅ |
| 4 | 폴더 행에만 `›` 아이콘 렌더 (렌더 로직 grep) | ✅ |
| 5 | **jsdom 렌더 스모크**: 폴더1·파일1 중 chevron **1개만** 생성, 클릭 시 `loadFolder('f1')` 호출 | ✅ |
| 6 | SW bump | ✅ |

## 한계
- 배포 보호(403)로 라이브 검증 불가 → 정적 검증 + jsdom 렌더 스모크로 대체. 실제 모바일 동작은 배포 후 `/db`에서 폴더 행 우측 `›` 탭 → 하위 폴더 진입 확인 권장.
