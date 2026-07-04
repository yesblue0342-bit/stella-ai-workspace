// lib/retry.js — 의존성 없는 순수 재시도 유틸 (단위 테스트 가능).
// Azure SQL 서버리스 콜드 스타트(첫 연결/쿼리 타임아웃) 대응의 핵심.
// mssql 등 외부 모듈을 import 하지 않으므로 node --test 에서 그대로 검증 가능.

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 실패하는 async fn 을 최대 retries 회 재시도 (지수 백오프).
// 멱등한 읽기/연결에만 사용할 것 (쓰기 중복 주의).
export async function withRetry(fn, { retries = 3, baseDelay = 400, onRetry } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      if (typeof onRetry === "function") {
        try { onRetry(error, attempt); } catch (_) { /* ignore */ }
      }
      // 지수 백오프: baseDelay * 2^(attempt-1) → 콜드 스타트 깨어나는 시간 확보
      await delay(baseDelay * Math.pow(2, attempt - 1));
    }
  }
  throw lastError;
}
