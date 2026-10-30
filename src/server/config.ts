// Script Properties 읽기. 값이 없으면 기본값 (docs/PLAN.md "Script Properties")
import { DEFAULT_SUBJECT_KEYWORDS } from '../parser/subject-filter';

export const PROPERTY_DEFAULTS = {
  GMAIL_QUERY: 'from:appupdate@aqara.kr OR to:appupdate@aqara.kr',
  SUBJECT_KEYWORDS: DEFAULT_SUBJECT_KEYWORDS.join(','),
  CLAUDE_MODEL: 'claude-sonnet-5-5',
  /** 번역 깊이(low|medium|high|xhigh|max). 번역은 규칙이 분명한 대량 작업이라 low에서 시작해 측정 후 조정 */
  CLAUDE_EFFORT: 'low',
  TRANSLATE_BATCH_SIZE: '20',
} as const;

/** 비밀값 — 점검 화면에서 값은 숨기고 설정 여부만 보여준다 */
export const SECRET_PROPERTIES = ['ANTHROPIC_API_KEY', 'CHAT_WEBHOOK_URL'] as const;

export interface Config {
  gmailQuery: string;
  subjectKeywords: string[];
  claudeModel: string;
  claudeEffort: string;
  translateBatchSize: number;
  anthropicApiKey?: string;
  chatWebhookUrl?: string;
  spreadsheetId?: string;
}

function props(): GoogleAppsScript.Properties.Properties {
  return PropertiesService.getScriptProperties();
}

function read(key: string): string | undefined {
  const v = props().getProperty(key);
  return v !== null && v.trim() !== '' ? v.trim() : undefined;
}

export function getConfig(): Config {
  const batch = Number(read('TRANSLATE_BATCH_SIZE') ?? PROPERTY_DEFAULTS.TRANSLATE_BATCH_SIZE);
  return {
    gmailQuery: read('GMAIL_QUERY') ?? PROPERTY_DEFAULTS.GMAIL_QUERY,
    subjectKeywords: (read('SUBJECT_KEYWORDS') ?? PROPERTY_DEFAULTS.SUBJECT_KEYWORDS)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    claudeModel: read('CLAUDE_MODEL') ?? PROPERTY_DEFAULTS.CLAUDE_MODEL,
    claudeEffort: read('CLAUDE_EFFORT') ?? PROPERTY_DEFAULTS.CLAUDE_EFFORT,
    translateBatchSize: Number.isFinite(batch) && batch > 0 ? Math.floor(batch) : Number(PROPERTY_DEFAULTS.TRANSLATE_BATCH_SIZE),
    anthropicApiKey: read('ANTHROPIC_API_KEY'),
    chatWebhookUrl: read('CHAT_WEBHOOK_URL'),
    spreadsheetId: read('SPREADSHEET_ID'),
  };
}

export function setProperty(key: string, value: string): void {
  props().setProperty(key, value);
}

/** 설정 점검용 요약. 비밀값은 '설정됨/없음'만 */
export function describeConfig(): string[] {
  const lines: string[] = [];
  for (const [key, def] of Object.entries(PROPERTY_DEFAULTS)) {
    const v = read(key);
    lines.push(`${key}: ${v ?? `${def} (기본값)`}`);
  }
  for (const key of SECRET_PROPERTIES) lines.push(`${key}: ${read(key) ? '설정됨' : '없음'}`);
  return lines;
}
