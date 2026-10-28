// 인용 누적 메일을 깊이별 블록으로 나눈다.
// HTML은 <blockquote> 중첩 기준(우선), 텍스트 본문은 중국어 메일 헤더 구분자 기준(보조).
import { readHtml } from './html';
import type { Group, Line, MailBlock, QuoteHeader } from './types';

/** 형식 A: 대시 구분선 다음 줄에 发件人：/日　期：/收件人：/抄　送：/主　题： */
const SEPARATOR_A = /^-{20,}$/;
/** 형식 B: ------------------原始邮件 ------------------ 다음에 发件人:/发送时间:/收件人:/抄送:/主题: */
const SEPARATOR_B = /^-{3,}\s*原始邮件\s*-{3,}$/;
const SEPARATOR_EN = /^-{3,}\s*original message\s*-{3,}$/i;

const FIELD_FROM = /^(?:发件人|From)\s*[:：]\s*(.*)$/i;
const FIELD_DATE_A = /^日\s*期\s*[:：]\s*(.*)$/;
const FIELD_DATE_B = /^(?:发送时间|Date|Sent)\s*[:：]\s*(.*)$/i;
const FIELD_TO = /^(?:收件人|To)\s*[:：]/i;
const FIELD_CC = /^(?:抄\s*送|Cc)\s*[:：]/i;
const FIELD_SUBJECT = /^(?:主\s*题|Subject)\s*[:：]\s*(.*)$/i;

export function isQuoteSeparator(line: string): boolean {
  return SEPARATOR_A.test(line) || SEPARATOR_B.test(line) || SEPARATOR_EN.test(line);
}

/** '2026年07月16日 14:36:59' · '04/07/26 14:22:12'(MM/DD/YY) → '2026-07-16 14:36:59' */
export function parseHeaderDate(raw: string): string | undefined {
  const pad = (n: string | number) => String(n).padStart(2, '0');
  const time = (t?: string) => (t ? ` ${t.length === 5 ? `${t}:00` : t.padStart(8, '0')}` : '');
  let m = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}:\d{2}(?::\d{2})?)?/);
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}${time(m[4])}`;
  m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(\d{1,2}:\d{2}(?::\d{2})?)?/);
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${year}-${pad(m[1]!)}-${pad(m[2]!)}${time(m[4])}`;
  }
  m = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?/);
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}${time(m[4])}`;
  return undefined;
}

/**
 * 블록 앞부분의 인용 헤더 줄을 읽고 제거한다. 主题 줄까지 읽으면 멈춘다.
 * 헤더가 없으면 undefined를 돌려주고 groups는 그대로 둔다.
 */
export function extractQuoteHeader(groups: Group[]): QuoteHeader | undefined {
  const header: QuoteHeader = { format: 'other' };
  let found = false;
  let done = false;
  while (groups.length && !done) {
    const group = groups[0]!;
    while (group.lines.length) {
      const text = group.lines[0]!.text;
      let m: RegExpMatchArray | null;
      if (SEPARATOR_A.test(text)) header.format = 'A';
      else if (SEPARATOR_B.test(text)) header.format = 'B';
      else if (SEPARATOR_EN.test(text)) header.format = 'other';
      else if ((m = text.match(FIELD_FROM))) header.from = m[1]!.trim();
      else if ((m = text.match(FIELD_DATE_A))) {
        header.date = parseHeaderDate(m[1]!);
        if (header.format === 'other') header.format = 'A';
      } else if ((m = text.match(FIELD_DATE_B))) {
        header.date = parseHeaderDate(m[1]!);
        if (header.format === 'other' && /^发送时间/.test(text)) header.format = 'B';
      } else if (FIELD_TO.test(text) || FIELD_CC.test(text)) {
        // 수신자 목록은 저장하지 않는다
      } else if ((m = text.match(FIELD_SUBJECT))) {
        header.subject = m[1]!.trim();
        group.lines.shift();
        found = true;
        done = true;
        break;
      } else {
        done = true;
        break;
      }
      group.lines.shift();
      found = true;
    }
    if (group.lines.length === 0) groups.shift();
  }
  return found ? header : undefined;
}

export function splitHtmlMail(html: string): MailBlock[] {
  return readHtml(html).map((stream) => {
    const groups = stream.groups;
    const header = stream.depth > 0 ? extractQuoteHeader(groups) : undefined;
    return { depth: stream.depth, header, groups };
  });
}

/** 텍스트 본문용(보조). 구분자 줄마다 한 단계 깊은 인용으로 본다. */
export function splitPlainMail(text: string): MailBlock[] {
  const blocks: MailBlock[] = [{ depth: 0, groups: [] }];
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^[>\s]+/, '').trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) continue;
    const next = lines.slice(i + 1).find((l) => l) ?? '';
    const isSeparator = SEPARATOR_B.test(line) || SEPARATOR_EN.test(line) || (SEPARATOR_A.test(line) && FIELD_FROM.test(next));
    if (isSeparator) blocks.push({ depth: blocks.length, groups: [] });
    const lineObj: Line = { text: line, bold: false };
    blocks[blocks.length - 1]!.groups.push({ tag: 'p', heading: 0, liId: null, liParent: null, lines: [lineObj] });
  }
  for (const block of blocks) if (block.depth > 0) block.header = extractQuoteHeader(block.groups);
  return blocks.filter((b) => b.groups.length > 0 || b.header);
}
