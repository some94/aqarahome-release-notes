// 섹션 제목 분류. 번호는 메일마다 다르므로(1.4가 이슈 수정이기도 함) 제목 키워드로만 분류한다.
import type { SectionKey } from './types';

export const SECTION_LABELS: Record<SectionKey, string> = {
  overview: '개요',
  version: '버전',
  schedule: '출시 일정·채널',
  notes: '공개 릴리즈 노트',
  internal: '기능 상세(내부용)',
  fixes: '온라인 이슈 수정',
  other: '기타',
};

/** 항목 ID에 들어가는 섹션 약어 */
export const SECTION_ID: Record<SectionKey, string> = {
  overview: 'ovw',
  version: 'ver',
  schedule: 'sch',
  notes: 'notes',
  internal: 'int',
  fixes: 'fix',
  other: 'etc',
};

// 순서가 중요하다: "Feature Details and Notes"는 notes보다 internal이 먼저,
// "Online Issue Fixes"는 version·notes보다 fixes가 먼저 걸려야 한다.
const RULES: [SectionKey, RegExp][] = [
  ['internal', /internal|feature details|function details|features? and notes|feature highlights/],
  ['fixes', /\bfix(es|ed)?\b|\bbugs?\b|online issues?/],
  ['version', /\bversions?\b/],
  ['schedule', /schedule|timing|timeline|release time|upgrade time|channels?\b/],
  ['notes', /\bnotes?\b|highlights|summary|update details|description|new features|what'?s new/],
];

export function classifySectionTitle(title: string): SectionKey | null {
  const t = title.toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ');
  for (const [key, re] of RULES) if (re.test(t)) return key;
  return null;
}

export interface HeadingMatch {
  /** '1.4' 또는 '3' */
  number: string;
  /** 번호 뒤 두 번째 자리(1.4 → 4) 또는 한 자리 번호(3 → 3). 순서 검사용 */
  minor: number;
  /** 콜론 앞까지의 제목 */
  title: string;
  /** 분류 결과. 분류되지 않는 1.x 제목이면 'other' */
  key: SectionKey;
  /** "1.1 Release Version: V5.1.7"처럼 제목 뒤에 붙은 내용 */
  rest: string;
}

export interface HeadingContext {
  /** 줄 전체가 굵은 글씨이거나 <h*> 안인지 */
  emphasized: boolean;
  inList: boolean;
  /** 직전에 인정한 섹션 번호(minor) */
  lastMinor: number;
}

const HEADING = /^(\d+(?:\.(\d+))?)\s*[.、]?\s*([A-Za-z一-鿿【\[].*)$/;

/**
 * 섹션 제목 줄인지 판단한다.
 * - '1.x 제목': 두 단계 번호는 키워드가 없어도 섹션으로 인정(분류 안 되면 기타)
 * - 'N. 제목': 한 단계 번호는 키워드가 맞고, 강조되어 있고, 번호가 앞 섹션보다 클 때만 인정
 *   (기능 상세 안의 "1. Google Automation" 같은 하위 항목과 구분)
 */
export function matchSectionHeading(line: string, ctx: HeadingContext): HeadingMatch | null {
  const m = line.trim().match(HEADING);
  if (!m) return null;
  const number = m[1]!;
  const twoLevel = m[2] !== undefined;
  const body = m[3]!;
  const colon = body.search(/[:：]/);
  const title = (colon >= 0 ? body.slice(0, colon) : body).trim();
  const rest = colon >= 0 ? body.slice(colon + 1).trim() : '';
  if (!title || title.length > 90) return null;

  const key = classifySectionTitle(title);
  if (twoLevel) {
    if (!number.startsWith('1.')) return null;
    if (!key && (!ctx.emphasized || title.length > 60 || /[.。]$/.test(title))) return null;
    return { number, minor: Number(m[2]), title, key: key ?? 'other', rest };
  }
  const minor = Number(number);
  if (!key || ctx.inList || !ctx.emphasized || minor <= ctx.lastMinor) return null;
  return { number, minor, title, key, rest };
}
