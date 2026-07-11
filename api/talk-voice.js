/*
 * Stella Talk 알림 음성 파일 제공 — GET /api/talk-voice?key=s1 → audio/mpeg
 *
 * 왜: 알림 음성을 브라우저 TTS(speechSynthesis)로 실시간 합성했더니, 안드로이드 크롬은
 * "최근 사용자 제스처" 없이는 TTS를 차단한다 → 타이핑 중(방금 터치)엔 음성이 나오고
 * 가만히 있다가 수신하면 멜로디("띠링")만 나오는 반대 증상. 근본 해결 = 실제 음성 파일.
 *
 * OpenAI TTS(gpt-4o-mini-tts, 실패 시 tts-1 폴백)로 문구당 1회 생성 후
 * 메모리 + 디스크(/tmp/talk-voice) 캐시. 키 없음/실패 시 JSON 404 → 클라이언트는
 * Audio.play() 실패를 잡아 멜로디로 폴백(기존 동작 유지, 무해).
 */
import { readFile, writeFile, mkdir } from "fs/promises";

export const VOICE_PHRASES = {
  s1:        { text: "스텔라~",       inst: "밝고 귀엽고 명랑한 8살 한국 여자아이가 이름을 부르듯 상냥하게, 끝을 살짝 올려서" },
  s2:        { text: "스텔라, 톡!",   inst: "밝고 귀여운 8살 한국 여자아이가 경쾌하게, '톡'은 짧고 통통 튀게" },
  byeolping: { text: "우리 별핑~",    inst: "사랑스럽고 통통 튀는 한국 여자아이 톤, 끝을 길게 올려서" },
  gongju:    { text: "별하 공주님~",  inst: "우아하면서 다정한 한국 여자아이 톤, 공주님을 부르듯 상냥하게" },
  byeolha:   { text: "김별하~",       inst: "밝고 씩씩한 한국 여자아이가 친구 이름을 부르듯 명랑하게" },
  queen:     { text: "앵쥬 왕비님~",  inst: "낮고 우아하고 부드러운 한국 여성 톤, 왕비님을 모시듯 정중하게" }
};

const CACHE_DIR = "/tmp/talk-voice";
const mem = new Map();           // key -> Buffer
const inflight = new Map();      // key -> Promise<Buffer>

async function generate(key) {
  const cfg = VOICE_PHRASES[key];
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY 미설정");
  // 1차: gpt-4o-mini-tts (instructions 로 톤 지정)
  let r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "nova", input: cfg.text, instructions: cfg.inst, response_format: "mp3", speed: 1.0 })
  });
  if (!r.ok) {
    // 2차: tts-1 (instructions 미지원 — input 만)
    r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1", voice: "nova", input: cfg.text, response_format: "mp3", speed: 1.0 })
    });
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error("TTS 생성 실패 " + r.status + " " + body.slice(0, 120));
  }
  return Buffer.from(await r.arrayBuffer());
}

async function getVoice(key) {
  if (mem.has(key)) return mem.get(key);
  // 디스크 캐시 (컨테이너 재시작 전까지 유지 — 재배포 시 재생성, 문구당 1회 소액)
  const file = CACHE_DIR + "/" + key + ".mp3";
  try {
    const buf = await readFile(file);
    if (buf.length > 1000) { mem.set(key, buf); return buf; }
  } catch (e) {}
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const buf = await generate(key);
    mem.set(key, buf);
    try { await mkdir(CACHE_DIR, { recursive: true }); await writeFile(file, buf); } catch (e) {}
    return buf;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

export default async function handler(req, res) {
  try {
    const key = String(req.query.key || "").trim();
    if (!VOICE_PHRASES[key]) return res.status(404).json({ ok: false, message: "알 수 없는 음성 키" });
    const buf = await getVoice(key);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=604800");   // 브라우저 7일 캐시 → 수신 즉시 재생
    res.setHeader("Content-Length", String(buf.length));
    return res.status(200).end(buf);
  } catch (error) {
    console.error("[talk-voice]", String(error?.message || error));
    return res.status(404).json({ ok: false, message: String(error?.message || error) });
  }
}
