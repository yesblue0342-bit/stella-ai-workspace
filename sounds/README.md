# Stella Talk 알림 음성 파일 (선택)

알림음은 기본적으로 브라우저 TTS(`speechSynthesis`, ko-KR)로 재생됩니다.
가족이 직접 녹음한 음성을 쓰고 싶으면 mp3 파일을 이 폴더에 두고 `talk.html`의
`TALK_VOICE_MP3` 맵에 경로를 넣으세요. 파일이 있으면 TTS 대신 우선 재생됩니다.

## 배치 방법
1. 음성 파일을 이 폴더에 추가 (예: `sounds/queen.mp3`).
2. `talk.html`의 `TALK_VOICE_MP3` 에서 해당 key 경로를 채움:
   ```js
   var TALK_VOICE_MP3 = {
     s1: null, s2: null, byeolping: null, gongju: null, byeolha: null,
     queen: '/sounds/queen.mp3'   // 👑 앵쥬 왕비님~
   };
   ```
3. Vercel 배포 시 저장소 루트의 `sounds/`가 `/sounds/...` 로 서빙됩니다.

## 음성 key
| key | 라벨 |
|-----|------|
| s1 | ⭐ 스텔라~ (기본) |
| s2 | ✨ 스텔라~톡 |
| byeolping | 💫 우리 별핑~ |
| gongju | 👸 별하 공주님~ |
| byeolha | 🌟 김별하~ |
| queen | 👑 앵쥬 왕비님~ (가족 음성) |

> mp3가 없거나 로드 실패 시 자동으로 TTS로 폴백하므로, 파일을 안 넣어도 동작합니다.
