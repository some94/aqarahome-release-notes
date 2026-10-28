// 메일 1건 → 버전 블록 목록. GAS·DOM API에 의존하지 않는 순수 함수.
import { buildBlockContent, flattenItems } from './items';
import { splitHtmlMail, splitPlainMail } from './quote-split';
import { extractChannelStatuses } from './status';
import { analyzeVersionLines, extractSubjectVersions, findDate, findIntroVersion } from './version';
import type { BlockFailure, MailBlock, MailInput, MailParseResult, ParsedVersion } from './types';

export * from './types';
export { selectVersions } from './dedupe';
export type { SelectionResult, SelectedVersion, VersionCandidate } from './dedupe';
export { checkSubject, DEFAULT_SUBJECT_KEYWORDS } from './subject-filter';
export { SECTION_LABELS } from './sections';
export { CHANNEL_LABELS } from './status';
export { compareVersions, extractSubjectVersions } from './version';

export function parseReleaseMail(mail: MailInput): MailParseResult {
  const useHtml = !!mail.html && mail.html.trim().length > 0;
  const blocks = useHtml ? splitHtmlMail(mail.html!) : splitPlainMail(mail.text ?? '');
  const versions: ParsedVersion[] = [];
  const failures: BlockFailure[] = [];

  for (const block of blocks) {
    const result = parseBlock(block, mail);
    if ('reason' in result) {
      // 내용이 없는 빈 인용 블록(서명 뒤 <br> 등)은 실패로 세지 않는다
      if (result.reason !== EMPTY) failures.push(result);
    } else {
      versions.push(result);
    }
  }
  return { mode: useHtml ? 'html' : 'text', blockCount: blocks.length, versions, failures };
}

const EMPTY = '내용 없음';

function parseBlock(block: MailBlock, mail: MailInput): ParsedVersion | BlockFailure {
  const isOriginal = block.depth === 0;
  const subject = isOriginal ? mail.subject : block.header?.subject;
  const date = isOriginal ? mail.date : block.header?.date;
  const content = buildBlockContent(block, { subject });
  const warnings: string[] = [];

  const allRoots = content.roots;
  if (allRoots.length === 0 && content.sections.length === 0) {
    return { depth: block.depth, subject, date, reason: block.header ? '인용 헤더만 있고 본문 없음' : EMPTY };
  }

  // 섹션별 줄 모음
  const items = (key: string) => flattenTexts(allRoots.filter((r) => r.section === key));
  const versionLines = items('version');
  const scheduleLines = items('schedule');
  const overviewText = items('overview').join('\n');

  const sectionInfo = analyzeVersionLines(versionLines);
  const subjectVersions = subject ? extractSubjectVersions(subject) : [];
  const version =
    sectionInfo.primary ??
    (subjectVersions.length === 1 ? subjectVersions[0] : undefined) ??
    findIntroVersion(overviewText) ??
    subjectVersions[subjectVersions.length - 1];

  if (!version) {
    return { depth: block.depth, subject, date, reason: '버전 번호를 찾지 못함' };
  }
  if (subjectVersions.length > 1) {
    warnings.push(`제목에 버전이 여러 개(${subjectVersions.map((v) => `v${v}`).join(', ')}) — 본문 기준 v${version}로 저장`);
  } else if (subjectVersions.length === 1 && subjectVersions[0] !== version) {
    warnings.push(`제목 버전(v${subjectVersions[0]})과 본문 버전(v${version})이 다름`);
  }
  if (!isOriginal && !block.header) warnings.push('인용 헤더를 찾지 못함');
  if (content.sections.length === 0) warnings.push('섹션 제목을 하나도 찾지 못함');
  if (!content.signedOff) warnings.push('서명(Best regards)을 찾지 못함 — 본문 끝 확인 필요');

  const year = Number((date ?? '').slice(0, 4)) || undefined;
  const approvalDate = findDate(overviewText, year) ?? (subject ? findDate(subject.replace(/v\d+\.\d+\.\d+/gi, '')) : undefined);

  // 출시 일정 섹션이 없는 메일(v5.2.6 "1. Version Info" 안에 제출 현황)은 버전 섹션에서 찾는다
  let channels = extractChannelStatuses(scheduleLines, year);
  if (Object.keys(channels).length === 0) channels = extractChannelStatuses(versionLines, year);

  const parsed: ParsedVersion = {
    version,
    channels,
    sections: content.sections,
    items: flattenItems(version, allRoots),
    source: {
      depth: block.depth,
      subject,
      date,
      from: block.header?.from,
      headerFormat: block.header?.format,
    },
    warnings,
  };
  if (sectionInfo.appVersion) parsed.appVersion = sectionInfo.appVersion;
  if (sectionInfo.googlePlayVersion) parsed.googlePlayVersion = sectionInfo.googlePlayVersion;
  if (approvalDate) parsed.approvalDate = approvalDate;
  return parsed;
}

interface TextNode {
  lines: string[];
  children: TextNode[];
}

function flattenTexts(nodes: TextNode[]): string[] {
  const out: string[] = [];
  const visit = (n: TextNode) => {
    out.push(...n.lines);
    n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
}
