// Claude Messages API 호출 (UrlFetchApp — GAS에서는 npm SDK를 쓸 수 없어 HTTP로 직접 호출).
// 응답 형식은 구조화 출력(output_config.format, JSON 스키마)으로 강제한다.
// claude-sonnet-5-5는 tool_choice 강제(any/tool)가 400이라 도구 호출 방식은 쓰지 않는다.
import type { Config } from '../config';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
/** 거절(refusal) 시 서버가 다른 모델로 다시 시도 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_TOKENS = 16000;
/** 일시적 오류(429·5xx·529·연결 오류) 재시도 간격 */
const BACKOFF_MS = [3000, 10000];

export class ClaudeConfigError extends Error {}

export interface ClaudeCallResult {
  /** 구조화 출력으로 받은 JSON(파싱 결과). 거절·잘림이면 undefined */
  json?: unknown;
  stopReason: string;
  /** 거절 사유 등 */
  detail?: string;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface MessagesResponse {
  model?: string;
  stop_reason?: string;
  stop_details?: { category?: string | null; explanation?: string } | null;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  error?: { type?: string; message?: string };
}

export function callClaude(config: Config, system: string, user: string, schema: object): ClaudeCallResult {
  if (!config.anthropicApiKey) {
    throw new ClaudeConfigError('Script Properties에 ANTHROPIC_API_KEY가 없습니다.');
  }
  const body = {
    model: config.claudeModel,
    max_tokens: MAX_TOKENS,
    // 시스템 프롬프트는 매번 같으므로 캐시(짧으면 캐시되지 않을 뿐 오류는 아님)
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    output_config: { effort: config.claudeEffort, format: { type: 'json_schema', schema } },
    fallbacks: 'default',
  };
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': config.anthropicApiKey, 'anthropic-version': API_VERSION, 'anthropic-beta': FALLBACK_BETA },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };

  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let status = 0;
    let text = '';
    try {
      const res = UrlFetchApp.fetch(ENDPOINT, options);
      status = res.getResponseCode();
      text = res.getContentText('UTF-8');
    } catch (e) {
      // 연결 오류·타임아웃 — 일시적 오류로 보고 재시도
      if (attempt < BACKOFF_MS.length) {
        Utilities.sleep(BACKOFF_MS[attempt]!);
        continue;
      }
      throw new Error(`Claude API 연결 실패: ${(e as Error).message}`);
    }
    const elapsedMs = Date.now() - started;

    if (status === 401 || status === 403) throw new ClaudeConfigError(`Claude API 인증 실패(${status}) — ANTHROPIC_API_KEY 확인`);
    const retryable = status === 429 || status === 529 || status >= 500;
    if (retryable && attempt < BACKOFF_MS.length) {
      Utilities.sleep(BACKOFF_MS[attempt]!);
      continue;
    }
    let data: MessagesResponse;
    try {
      data = JSON.parse(text) as MessagesResponse;
    } catch {
      throw new Error(`Claude API 응답을 읽을 수 없음(${status}): ${text.slice(0, 300)}`);
    }
    if (status !== 200) {
      const message = `Claude API 오류(${status} ${data.error?.type ?? ''}): ${data.error?.message ?? text.slice(0, 300)}`;
      // 400·404는 요청·설정 문제(모델명, effort 값 등)라 같은 요청을 다시 보내도 소용없다
      if (status === 400 || status === 404) throw new ClaudeConfigError(message);
      throw new Error(message);
    }

    const stopReason = data.stop_reason ?? '';
    const usage = { inputTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_read_input_tokens ?? 0), outputTokens: data.usage?.output_tokens ?? 0 };
    const base = { stopReason, elapsedMs, model: data.model ?? config.claudeModel, ...usage };
    if (stopReason === 'refusal') {
      return { ...base, detail: `거절됨(${data.stop_details?.category ?? '분류 없음'}) ${data.stop_details?.explanation ?? ''}`.trim() };
    }
    if (stopReason === 'max_tokens') return { ...base, detail: '응답이 max_tokens에서 잘림' };
    // 응답은 thinking 블록으로 시작할 수 있으므로 type으로 text 블록을 찾는다
    const out = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    try {
      return { ...base, json: JSON.parse(out) };
    } catch {
      return { ...base, detail: `JSON이 아닌 응답: ${out.slice(0, 200)}` };
    }
  }
}
