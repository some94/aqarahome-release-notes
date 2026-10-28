// 출시 일정·채널 섹션의 채널별 제출 상태를 한국어로 정규화
import type { ChannelKey, ChannelStatus } from './types';
import { findDate } from './version';

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  android: 'Android',
  ios: 'iOS',
  googlePlay: 'Google Play',
};

export function detectChannel(line: string): ChannelKey | null {
  if (/^\s*google\s*play/i.test(line)) return 'googlePlay';
  if (/^\s*android\b/i.test(line)) return 'android';
  if (/^\s*ios\b/i.test(line)) return 'ios';
  return null;
}

export function normalizeStatus(raw: string, fallbackYear?: number): ChannelStatus {
  const t = raw.toLowerCase();
  let label: string;
  if (
    /already (available|live|released|launched)|now (available|live)|has been (released|launched)|went live/.test(t) ||
    /(?<!be )\b(released|launched) on\b/.test(t)
  ) {
    label = '출시 완료';
  } else if (/(will|to) be submitted|will submit|be submitted (after|once)|pending submission|not yet submitted/.test(t)) {
    label = '제출 예정';
  } else if (/submitted|submission to|under review|in review/.test(t)) {
    label = '심사 제출';
  } else {
    label = '확인 필요';
  }
  const date = label === '심사 제출' || label === '출시 완료' ? findDate(raw, fallbackYear) : undefined;
  return date ? { label, date, raw } : { label, raw };
}

/** 채널별 첫 줄만 사용 */
export function extractChannelStatuses(lines: string[], fallbackYear?: number): Partial<Record<ChannelKey, ChannelStatus>> {
  const result: Partial<Record<ChannelKey, ChannelStatus>> = {};
  for (const line of lines) {
    const channel = detectChannel(line);
    if (channel && !result[channel]) result[channel] = normalizeStatus(line, fallbackYear);
  }
  return result;
}
