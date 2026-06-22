// lib/vision-format.mjs — API별 올바른 이미지 블록 + 비전모델 보장 (순수 함수)
export function openaiResponsesImage(base64, mt = "image/png") {
  return { type: "input_image", image_url: `data:${mt};base64,${base64}` };
}
export function openaiChatImage(base64, mt = "image/png") {
  return { type: "image_url", image_url: { url: `data:${mt};base64,${base64}` } };
}
export function claudeImage(base64, mt = "image/png") {
  return { type: "image", source: { type: "base64", media_type: mt, data: base64 } };
}
export function visionImageBlock({ api, base64, mediaType = "image/png" }) {
  if (api === "claude" || api === "anthropic") return claudeImage(base64, mediaType);
  if (api === "responses" || api === "openai-responses") return openaiResponsesImage(base64, mediaType);
  return openaiChatImage(base64, mediaType);
}
const TEXT_ONLY = ["gpt-3.5", "gpt-35", "text-", "davinci", "babbage", "ada", "curie"];
const VISION_OK = ["gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-5", "o1", "o3", "o4", "claude-", "claude3"];
export function supportsVision(model = "") {
  const m = String(model).toLowerCase();
  if (TEXT_ONLY.some((p) => m.startsWith(p))) return false;
  if (VISION_OK.some((p) => m.startsWith(p))) return true;
  return true;
}
export function ensureVisionModel(model, hasImage, provider = "openai") {
  if (!hasImage || supportsVision(model)) return model;
  return provider === "claude" ? "claude-sonnet-4-6" : "gpt-4o";
}

// data: URL("data:image/png;base64,AAA") → { base64, mediaType }. 비-dataURL은 그대로 base64로 취급.
export function parseDataUrl(u) {
  const s = String(u || "");
  const m = s.match(/^data:([^;]+);base64,(.+)$/);
  if (m) return { base64: m[2], mediaType: m[1] };
  return { base64: s.replace(/^data:[^,]*,/, ""), mediaType: "image/png" };
}
