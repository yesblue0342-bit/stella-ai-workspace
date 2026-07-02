// Drive 의도 감지(detectDriveIntent) 회귀 테스트
//
// 배경: 과거 needsDrive 트리거가 (1) 영어 'drive' 부분 문자열, (2) 아무 줄이나 '#'로 시작하면
// 발동해서, 마크다운/코드 붙여넣기나 'driver' 같은 일반 단어에도 Drive 전체 스캔이 돌고
// 최대 28K자의 무관한 파일 내용이 프롬프트에 주입되며 web_search까지 꺼졌다.
// 이 테스트는 정밀화된 트리거가 진짜 의도만 잡고 오탐을 내지 않는지 고정한다.

import test from "node:test";
import assert from "node:assert/strict";
import { detectDriveIntent } from "../api/chat.js";

test("진짜 Drive 의도: 발동해야 한다", () => {
  const positives = [
    "내 드라이브에서 QM 자료 찾아줘",
    "드라이브 폴더 정리해줘",
    "my drive에 있는 파일 보여줘",
    "check my Google Drive folder",
    "gdrive에서 백로그 찾아",
    "#Celltrion 분석해줘",
    "#구글드라이브폴더 3디와이/SAP 분석해줘",
    "#폴더 SAP",
    "질문 요약:\n#StellaGPT 개발메모 읽어줘",   // 뒤 줄의 #명령도 인식
    "https://drive.google.com/drive/folders/1AbCdEfGhIjKl",
    "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit",
  ];
  for (const p of positives) {
    assert.equal(detectDriveIntent(p), true, `발동해야 함: ${p}`);
  }
});

test("오탐 방지: 발동하면 안 된다", () => {
  const negatives = [
    "테슬라 드라이버 채용 공고 요약해줘".replace("드라이버", "driver"), // 영어 driver
    "what drives inflation in 2026?",
    "I use OneDrive at work",
    "the car was driven fast",
    "# 프로젝트 개요\n\n이 문서는 마크다운입니다.",           // 마크다운 제목(# + 공백)
    "## 소제목\n내용",                                        // ## 제목
    "#!/bin/bash\necho hi",                                   // 셔뱅
    "#include <stdio.h>\nint main(){return 0;}",              // C 전처리
    "#define MAX 10",
    "일반적인 SAP QM 질문입니다. 검사 로트가 뭐죠?",
    "#이건아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주긴한줄이라서폴더명령일리가없습니다그냥본문의해시태그덩어리입니다한참더길게만듭니다",
  ];
  for (const n of negatives) {
    assert.equal(detectDriveIntent(n), false, `발동하면 안 됨: ${n.slice(0, 40)}`);
  }
});

test("skipDrive 계약: 핸들러가 body.skipDrive===true면 강제 비활성 (형태 확인)", async () => {
  // 핸들러 내부 로직은 통합 환경이 필요하므로, 여기서는 소스에 계약이 존재하는지 고정한다.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../api/chat.js", import.meta.url), "utf8");
  assert.match(src, /body\.skipDrive === true \? false : detectDriveIntent\(message\)/);
});
