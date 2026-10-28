// 버전 번호·날짜 추출

const SUBJECT_VERSION = /\bv\s?(\d+\.\d+\.\d+)\b/gi;
const ANY_VERSION = /\bv?(\d+\.\d+\.\d+)\b/gi;

/** 제목의 버전 목록. 대소문자 v/V 모두. 'V5.3.0 & V5.3.1' → ['5.3.0', '5.3.1'] */
export function extractSubjectVersions(subject: string): string[] {
  return unique([...subject.matchAll(SUBJECT_VERSION)].map((m) => m[1]!));
}

export function findVersions(text: string): string[] {
  return unique([...text.matchAll(ANY_VERSION)].map((m) => m[1]!));
}

/** 본문 소개 문단의 'version v6.1.3' */
export function findIntroVersion(text: string): string | undefined {
  return text.match(/\bversion\s+v?(\d+\.\d+\.\d+)\b/i)?.[1] ?? text.match(/\bv(\d+\.\d+\.\d+)\b/i)?.[1];
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number | string) => String(n).padStart(2, '0');

/** 'March 5, 2026' · '2026.06.18' · '2026-04-17' · '20260904' → 'YYYY-MM-DD'. 연도가 없으면 fallbackYear 사용 */
export function findDate(text: string, fallbackYear?: number): string | undefined {
  let m = text.match(/\b(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/);
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(20\d{2}))?/i);
  if (m) {
    const year = m[3] ? Number(m[3]) : fallbackYear;
    if (!year) return undefined;
    return `${year}-${pad(MONTHS.indexOf(m[1]!.toLowerCase()) + 1)}-${pad(m[2]!)}`;
  }
  m = text.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return undefined;
}

export interface VersionSectionInfo {
  /** 본문 버전 섹션의 대표 버전 */
  primary?: string;
  appVersion?: string;
  googlePlayVersion?: string;
}

/**
 * 버전 섹션 줄 분석.
 * 예(v6.3.3): 'Android / iOS: v6.3.3', 'Google Play: v6.3.4', 'The next iteration version number will continue as v6.3.5'
 */
export function analyzeVersionLines(lines: string[]): VersionSectionInfo {
  const info: VersionSectionInfo = {};
  let firstPlain: string | undefined;
  for (const line of lines) {
    const version = findVersions(line)[0];
    if (!version) continue;
    if (/\bnext\b|will continue|upcoming/i.test(line)) continue;
    // 채널 버전은 줄이 채널명으로 시작할 때만. "(Note: v5.2.0 was an emergency iOS version)"은 채널 버전이 아니다
    if (/^\s*google\s*play/i.test(line)) info.googlePlayVersion ??= version;
    else if (/^\s*(android|ios)\b/i.test(line)) info.appVersion ??= version;
    else firstPlain ??= version;
  }
  info.primary = info.appVersion ?? firstPlain;
  return info;
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
