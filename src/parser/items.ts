// 메일 블록 하나 → 섹션별 항목 트리 → ID가 붙은 평탄한 항목 목록
import { classifySectionTitle, matchSectionHeading, SECTION_ID } from './sections';
import type { Group, Line, MailBlock, ParsedItem, ParsedSection, SectionKey, SourceLang } from './types';

// ---------- 플랫폼 접두어 ----------

const PLATFORM_WORD = String.raw`(?:android|ios|ipados|mac(?:os)?|google\s*play|harmony(?:os)?)`;
const PLATFORM_LIST = String.raw`(${PLATFORM_WORD}(?:\s*(?:\/|&|,|、|and)\s*${PLATFORM_WORD})*)`;
/** 'iOS: …' · 'Android / iOS: …' · 'Google Play version: …' */
const PLATFORM_PREFIX = new RegExp(String.raw`^\s*${PLATFORM_LIST}(?:\s+version)?\s*[:：]\s*`, 'i');
/** '[iOS] …' · '【Android】…' (2025년 메일) */
const PLATFORM_BRACKET = new RegExp(String.raw`^\s*[\[【]\s*${PLATFORM_LIST}\s*[\]】]\s*[:：]?\s*`, 'i');

function platformName(word: string): string {
  const w = word.toLowerCase().replace(/\s+/g, ' ');
  if (w === 'android') return 'Android';
  if (w === 'ios' || w === 'ipados') return 'iOS';
  if (w.startsWith('mac')) return 'Mac';
  if (w.startsWith('google')) return 'Google Play';
  return 'HarmonyOS';
}

/**
 * 'iOS: Fixed …' → { platforms: ['iOS'], text: 'Fixed …' }
 * 접두어가 없으면 platforms는 비어 있고(→ 상위 항목 또는 '공통'), Mac 언급이 있으면 'Mac'.
 */
export function splitPlatform(text: string): { platforms: string[]; text: string } {
  let platforms: string[] = [];
  let rest = text;
  const m = text.match(PLATFORM_PREFIX) ?? text.match(PLATFORM_BRACKET);
  if (m) {
    platforms = [...new Set(m[1]!.split(/\s*(?:\/|&|,|、|\band\b)\s*/i).filter(Boolean).map(platformName))];
    rest = text.slice(m[0].length);
  } else {
    // 접두어 없이 문장 안에 적힌 경우: "Fixed an issue on Android where …"
    const inline = text.match(/\bon (android|ios)\b/i);
    if (inline) platforms = [platformName(inline[1]!)];
  }
  // iOS 앱을 Mac에서 쓰는 경우("iOS: … when used on Mac", "iOS: On Mac, …")는 Mac으로 분류
  if (/\bmac\b|\bmacos\b/i.test(rest) && (platforms.length === 0 || platforms.every((p) => p === 'iOS'))) {
    platforms = ['Mac'];
  }
  return { platforms, text: rest };
}

export function detectLang(text: string): SourceLang {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const hangul = (text.match(/[가-힣]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (hangul > cjk && hangul * 2 >= latin) return 'ko';
  if (cjk === 0) return 'en';
  if (latin === 0 || cjk * 2 >= latin) return 'zh';
  return 'mixed';
}

// ---------- 본문 정리 규칙 ----------

const GREETING = /^(hi|hello|dear)\s+(all|everyone|team|colleagues)\s*[,，!.]?$/i;
const SIGN_OFF = /^(best\s+regards|kind\s+regards|regards|thanks(?:\s+and\s+regards)?|thank you)\s*[,，!.]?$/i;
/** 섹션 제목 바로 아래 붙는 단서 문구 → 항목이 아니라 제목의 일부로 본다 */
const INCLUDING_NOTE = /^\(?\s*includ(?:es|ing)?,?\s*(?:but\s+(?:are\s+)?)?not\s+limited\s+to\s*[:：]?\s*\)?$/i;
/** [Fixes] · 【Fix】 · [New] 같은 분류 표시 줄 */
const LABEL = /^[\[【][^\]】]{1,40}[\]】]\s*[:：]?$/;

export const isSignOff = (text: string) => SIGN_OFF.test(text);
export const isLabel = (text: string) => LABEL.test(text);

/** 버전 없이 메일 제목만 반복한 첫 줄. 예: "Aqara Home APP Version Release Notice" */
const BARE_TITLE = /^(aqara home\s+)?(app\s+)?(version\s+)?release\s+(notice|notification)$/i;

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[\s\-–—_:：|【】\[\]()（）]/g, '');
}

/** 줄 중간에 끼어 있는 '1.x 제목:' 앞에서 줄을 나눈다. 예: "v5.1.6 (…) 1.2 Upgrade Time and Release Channels:" */
const EMBEDDED_HEADING = /\s(?=1\.\d{1,2}\s+[A-Za-z][^:：]{2,80}[:：])/g;

function splitEmbeddedHeadings(line: Line): Line[] {
  const parts: Line[] = [];
  let start = 0;
  for (const m of line.text.matchAll(EMBEDDED_HEADING)) {
    const at = m.index!;
    const title = line.text.slice(at + 1).match(/^1\.\d{1,2}\s+([^:：]+)/)?.[1] ?? '';
    if (!classifySectionTitle(title)) continue;
    parts.push({ text: line.text.slice(start, at).trim(), bold: false });
    start = at + 1;
  }
  if (parts.length === 0) return [line];
  parts.push({ text: line.text.slice(start).trim(), bold: false });
  return parts.filter((p) => p.text);
}

/** 한 묶음 안에 섹션 제목 줄이 섞여 있으면(<br>로만 구분된 경우) 제목 줄 앞에서 묶음을 나눈다 */
function expandGroups(groups: Group[]): Group[] {
  const out: Group[] = [];
  for (const group of groups) {
    const lines = group.lines.flatMap(splitEmbeddedHeadings);
    let current: Line[] = [];
    for (const line of lines) {
      const looksLikeHeading = matchSectionHeading(line.text, { emphasized: line.bold, inList: false, lastMinor: 0 });
      if (current.length && looksLikeHeading && looksLikeHeading.key !== 'other') {
        out.push({ ...group, lines: current });
        current = [];
      }
      current.push(line);
    }
    if (current.length) out.push({ ...group, lines: current });
  }
  return out;
}

// ---------- 트리 구성 ----------

export interface Node {
  section: SectionKey;
  lines: string[];
  parent: Node | null;
  children: Node[];
}

export interface BlockContent {
  sections: ParsedSection[];
  /** 섹션 순서대로 최상위 항목 */
  roots: Node[];
  /** 메일 본문이 서명(Best regards)으로 끝났는지 */
  signedOff: boolean;
}

export interface BuildContext {
  /** 원본이면 메일 제목, 인용이면 인용 헤더 주제 — 본문 첫머리의 제목 반복 줄 제거용 */
  subject?: string;
}

export function buildBlockContent(block: MailBlock, ctx: BuildContext = {}): BlockContent {
  const sections: ParsedSection[] = [];
  const roots: Node[] = [];
  const byLi = new Map<number, Node>();
  let section: SectionKey = 'overview';
  let lastMinor = 0;
  /** 분류 표시 줄·<h4> 소제목 — 뒤따르는 최상위 항목의 부모가 된다 */
  let sub: Node | null = null;
  /** 기타 섹션의 제목 항목 — 그 섹션 내용 전체의 부모 */
  let otherHead: Node | null = null;
  /** 콜론으로 끝난 직전 문단("Automation actions:") — 바로 뒤 목록의 부모 */
  let lead: Node | null = null;
  let justHeaded = false;
  let signedOff = false;
  const subjectKey = ctx.subject ? normalizeForCompare(ctx.subject) : '';

  const add = (lines: string[], parent: Node | null): Node => {
    const node: Node = { section, lines, parent, children: [] };
    if (parent) parent.children.push(node);
    else roots.push(node);
    return node;
  };

  for (const group of expandGroups(block.groups)) {
    if (signedOff) break;
    const lines: Line[] = group.lines.slice();

    // 그룹 첫머리: 인사말·제목 반복·섹션 제목·단서 문구 처리
    while (lines.length) {
      const first = lines[0]!;
      if (isSignOff(first.text)) {
        signedOff = true;
        lines.length = 0;
        break;
      }
      if (section === 'overview' && GREETING.test(first.text)) {
        lines.shift();
        continue;
      }
      if (section === 'overview' && ((subjectKey && normalizeForCompare(first.text) === subjectKey) || BARE_TITLE.test(first.text))) {
        lines.shift();
        continue;
      }
      if (justHeaded && INCLUDING_NOTE.test(first.text)) {
        const last = sections[sections.length - 1];
        if (last) last.title += ` ${first.text}`;
        lines.shift();
        continue;
      }
      const heading = matchSectionHeading(first.text, {
        emphasized: first.bold || group.heading > 0,
        inList: group.liId !== null,
        lastMinor,
      });
      if (heading) {
        section = heading.key;
        lastMinor = heading.minor;
        sections.push({ key: section, title: `${heading.number} ${heading.title}` });
        sub = null;
        lead = null;
        justHeaded = true;
        lines.shift();
        // 분류되지 않는 섹션은 제목 자체도 정보이므로 항목으로 남기고, 그 아래 내용을 하위로 둔다
        otherHead = section === 'other' ? add([first.text], null) : null;
        if (heading.rest) lines.unshift({ text: heading.rest, bold: false });
        continue;
      }
      break;
    }
    if (!lines.length) continue;

    const signOffAt = lines.findIndex((l) => isSignOff(l.text));
    if (signOffAt >= 0) {
      lines.length = signOffAt;
      signedOff = true;
      if (!lines.length) break;
    }
    justHeaded = false;
    const texts = lines.map((l) => l.text);

    if (group.liId !== null) {
      // 같은 <li> 안의 여러 문단(설명 + 중첩 목록 뒤 "Entry path:")은 한 항목으로 합친다
      const existing = byLi.get(group.liId);
      if (existing && existing.section === section) {
        existing.lines.push(...texts);
        continue;
      }
      const liParent = group.liParent !== null ? byLi.get(group.liParent) : undefined;
      const parent = liParent && liParent.section === section ? liParent : (lead ?? sub ?? otherHead);
      byLi.set(group.liId, add(texts, parent));
      continue;
    }
    lead = null;

    // 목록 밖 문단: 분류 표시 줄·소제목이면 이후 항목의 부모로 삼는다
    const isSubheading =
      section !== 'overview' &&
      (isLabel(texts[0]!) ||
        group.heading >= 4 ||
        (texts.length === 1 && lines[0]!.bold && texts[0]!.length <= 120 && !/[.。]$/.test(texts[0]!)));
    if (isSubheading) {
      const label = add([texts[0]!], otherHead);
      sub = label;
      if (texts.length > 1) add(texts.slice(1), label);
      continue;
    }
    const node = add(texts, sub ?? otherHead);
    if (section !== 'overview' && /[:：]$/.test(texts[texts.length - 1]!)) lead = node;
  }

  return { sections, roots, signedOff };
}

/** 트리를 ID가 붙은 평탄한 목록(전위 순회)으로 만든다 */
export function flattenItems(version: string, roots: Node[]): ParsedItem[] {
  const out: ParsedItem[] = [];
  const seqBySection = new Map<SectionKey, number>();

  const visit = (node: Node, id: string, seq: number, parent: ParsedItem | null, depth: number) => {
    const original = node.lines.join('\n');
    const { platforms, text } = splitPlatform(original);
    const platform = platforms.length ? platforms.join(', ') : (parent?.platform ?? '공통');
    const item: ParsedItem = {
      id,
      section: node.section,
      seq,
      parentId: parent?.id ?? null,
      depth,
      platform,
      text: text || original,
      original,
      lang: detectLang(original),
    };
    out.push(item);
    node.children.forEach((child, i) => visit(child, `${id}-${pad(i + 1, 2)}`, i + 1, item, depth + 1));
  };

  for (const root of roots) {
    const seq = (seqBySection.get(root.section) ?? 0) + 1;
    seqBySection.set(root.section, seq);
    visit(root, `v${version}-${SECTION_ID[root.section]}-${pad(seq, 3)}`, seq, null, 0);
  }
  return out;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
