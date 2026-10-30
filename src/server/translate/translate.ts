// 묶음 하나 번역: 요청 → 검증 → 실패한 항목만 1회 재시도 (SPEC 6번)
import {
  buildSystemPrompt,
  buildUserPayload,
  OUTPUT_SCHEMA,
  validateTranslations,
  type GlossaryEntry,
  type TranslationRequestItem,
  type TranslationResult,
} from '../../shared/translation';
import type { Config } from '../config';
import { callClaude } from './claude';

export interface CallStats {
  calls: number;
  elapsedMs: number[];
  inputTokens: number;
  outputTokens: number;
}

export function emptyCallStats(): CallStats {
  return { calls: 0, elapsedMs: [], inputTokens: 0, outputTokens: 0 };
}

export interface BatchOutcome {
  results: TranslationResult[];
  failedIds: string[];
  errors: string[];
}

const SYSTEM = buildSystemPrompt();

function requestOnce(config: Config, glossary: GlossaryEntry[], batch: TranslationRequestItem[], stats: CallStats) {
  const res = callClaude(config, SYSTEM, buildUserPayload(batch, glossary), OUTPUT_SCHEMA);
  stats.calls++;
  stats.elapsedMs.push(res.elapsedMs);
  stats.inputTokens += res.inputTokens;
  stats.outputTokens += res.outputTokens;
  if (res.json === undefined) {
    return { truncated: res.stopReason === 'max_tokens', outcome: { valid: [], failedIds: batch.map((b) => b.id), errors: [res.detail ?? res.stopReason] } };
  }
  return { truncated: false, outcome: validateTranslations(batch, res.json) };
}

/**
 * 1차 요청에서 통과한 항목은 그대로 쓰고, 실패한 항목만 1회 재시도한다.
 * 응답이 max_tokens에서 잘렸으면 재시도 때 묶음을 반으로 나눈다.
 * ClaudeConfigError(키·모델 설정 문제)는 그대로 던진다 — 계속 시도해도 소용없음.
 */
export function translateBatch(config: Config, glossary: GlossaryEntry[], batch: TranslationRequestItem[], stats: CallStats): BatchOutcome {
  const first = requestOnce(config, glossary, batch, stats);
  const results = [...first.outcome.valid];
  if (first.outcome.failedIds.length === 0) return { results, failedIds: [], errors: [] };

  const failed = new Set(first.outcome.failedIds);
  const retryItems = batch.filter((b) => failed.has(b.id));
  const retryBatches =
    first.truncated && retryItems.length > 1
      ? [retryItems.slice(0, Math.ceil(retryItems.length / 2)), retryItems.slice(Math.ceil(retryItems.length / 2))]
      : [retryItems];

  const failedIds: string[] = [];
  const errors: string[] = [];
  for (const retry of retryBatches) {
    const second = requestOnce(config, glossary, retry, stats);
    results.push(...second.outcome.valid);
    failedIds.push(...second.outcome.failedIds);
    if (second.outcome.failedIds.length) errors.push(...second.outcome.errors);
  }
  return { results, failedIds, errors };
}
