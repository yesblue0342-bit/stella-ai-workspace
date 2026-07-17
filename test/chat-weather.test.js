// lib/chat/weather.mjs — 날씨 포매팅/캐시 테스트.
// WMO 코드표가 두 벌로 갈라져 있던 중복을 하나로 합친 뒤의 회귀 방지.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wmoToKr, buildWeatherSummary, handleWeather, clearWeatherCaches, parseWeatherQuery } from "../lib/chat/weather.mjs";

test("wmoToKr: 주요 코드 매핑 + 미지 코드 폴백", () => {
  assert.equal(wmoToKr(0), "맑음");
  assert.equal(wmoToKr(65), "강한 비");
  assert.equal(wmoToKr(77), "싸라기눈");   // 통합 전에는 런타임 표에 없어 "정보 없음"이었다
  assert.equal(wmoToKr(99), "폭우 뇌우");
  assert.equal(wmoToKr(12345), "정보 없음");
});

test("buildWeatherSummary: 기온 구간별 표현", () => {
  const base = { desc: "맑음", feels: 20, precip: 0, wind: 1, uv: 1, humid: 50 };
  assert.ok(buildWeatherSummary({ ...base, temp: 32, feels: 32 }).includes("매우 더운 날씨"));
  assert.ok(buildWeatherSummary({ ...base, temp: 22, feels: 22 }).includes("따뜻한 날씨"));
  assert.ok(buildWeatherSummary({ ...base, temp: -3, feels: -3 }).includes("매우 추운 날씨"));
});

test("buildWeatherSummary: 체감차 3도 이상일 때만 체감 문구", () => {
  const base = { desc: "흐림", temp: 20, precip: 0, wind: 1, uv: 1, humid: 50 };
  assert.ok(!buildWeatherSummary({ ...base, feels: 21 }).includes("체감은"));
  assert.ok(buildWeatherSummary({ ...base, feels: 25 }).includes("체감은 더 높음"));
  assert.ok(buildWeatherSummary({ ...base, feels: 15 }).includes("체감은 더 낮음"));
});

test("buildWeatherSummary: 우산/바람/UV/습도 경고", () => {
  const s = buildWeatherSummary({ desc: "비", temp: 18, feels: 18, precip: 70, wind: 12, uv: 9, humid: 85 });
  assert.ok(s.includes("우산을 꼭 챙기세요"));
  assert.ok(s.includes("바람이 강하니"));
  assert.ok(s.includes("자외선이 매우 강합니다"));
  assert.ok(s.includes("습도가 높아"));
  assert.ok(s.startsWith("> "), "인용문 블록으로 반환");
});

test("parseWeatherQuery: 시간 표현('내일')을 위치로 오인하지 않는다", () => {
  // 과거 회귀: "내일 홋카이도 날씨"에서 첫 한글 토큰 "내일"을 위치로 잡아 '내일 위치를 찾을 수 없습니다' 반환
  const a = parseWeatherQuery("내일 홋카이도 날씨 알려줘");
  assert.equal(a.dayOffset, 1);
  assert.equal(a.overseas, true);
  assert.ok(a.locationName.includes("홋카이도") || a.locationName.includes("삿포로"));
  assert.notEqual(a.locationName, "내일");

  const b = parseWeatherQuery("내일 송도 날씨");
  assert.equal(b.dayOffset, 1);
  assert.equal(b.locationName, "송도");
  assert.equal(b.overseas, false);

  const c = parseWeatherQuery("모레 도쿄 날씨 어때");
  assert.equal(c.dayOffset, 2);
  assert.equal(c.overseas, true);

  // 위치가 없으면 기본값(송도)로 폴백하되, 시간어를 위치로 쓰지 않는다
  const d = parseWeatherQuery("오늘 날씨 알려줘");
  assert.equal(d.dayOffset, 0);
  assert.equal(d.locationName, "송도");
});

test("handleWeather: 해외 도시 + 내일 → 위치를 찾고 예보로 답한다(위치 못찾음 없음)", async () => {
  clearWeatherCaches();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      current: { weather_code: 2, is_day: 1, temperature_2m: 5.2, apparent_temperature: 2.1, relative_humidity_2m: 60, wind_speed_10m: 3.0 },
      daily: { weather_code: [2, 71, 3], temperature_2m_max: [7.1, 1.5, 4.0], temperature_2m_min: [-1.2, -5.0, -2.0], precipitation_probability_max: [10, 80, 30], uv_index_max: [3.1, 2.0, 2.5], wind_speed_10m_max: [12, 25, 18] },
    }),
  });
  try {
    const out = await handleWeather("내일 홋카이도 날씨 알려줘");
    assert.ok(!out.includes("위치를 찾을 수 없"), "해외 지명은 위치 해석되어야 한다");
    assert.ok(out.includes("내일"), "내일 예보로 답해야 한다");
    assert.ok(out.includes("1.5°C") && out.includes("-5.0°C"), "내일(index 1) 일 예보를 사용");
    assert.ok(out.includes("Google 날씨"), "해외는 Google 링크");
  } finally {
    globalThis.fetch = realFetch;
    clearWeatherCaches();
  }
});

test("handleWeather: 내장 좌표표 도시는 Open-Meteo를 캐시로 재사용한다", async () => {
  clearWeatherCaches();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        current: { weather_code: 0, is_day: 1, temperature_2m: 21.4, apparent_temperature: 21.0, relative_humidity_2m: 55, wind_speed_10m: 2.3 },
        daily: { temperature_2m_max: [25.1], temperature_2m_min: [17.2], precipitation_probability_max: [10], uv_index_max: [4.2] },
      }),
    };
  };
  try {
    const first = await handleWeather("송도 날씨 알려줘");
    const second = await handleWeather("송도 날씨 알려줘");
    assert.equal(calls, 1, "두 번째 호출은 캐시 히트 → 외부 API 미호출");
    assert.equal(first, second);
    assert.ok(first.includes("**송도 현재 날씨**"));
    assert.ok(first.includes("| 🌡 기온 | 21.4°C | 체감 21.0°C |"));
    assert.ok(first.includes("네이버 날씨"), "국내는 네이버 링크");
  } finally {
    globalThis.fetch = realFetch;
    clearWeatherCaches();
  }
});

test("handleWeather: 예보 API 실패 시 링크 폴백", async () => {
  clearWeatherCaches();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  try {
    const out = await handleWeather("부산 날씨");
    assert.ok(out.includes("API 일시 오류"));
    assert.ok(out.includes("네이버 날씨"));
  } finally {
    globalThis.fetch = realFetch;
    clearWeatherCaches();
  }
});
