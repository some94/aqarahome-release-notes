// 간이 HTML 리더. GAS에는 DOM이 없으므로 태그를 직접 훑어서
// 인용(<blockquote>) 단위 스트림 → 블록 요소 단위 줄 묶음(Group)으로 만든다.
import type { Group, Line } from './types';

export interface Stream {
  /** blockquote 중첩 깊이(0 = 최상단 본문) */
  depth: number;
  groups: Group[];
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'area', 'base', 'wbr', 'source']);
/** 열리거나 닫힐 때 줄 묶음을 끊는 태그 */
const BREAK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'hr', 'table', 'tbody', 'thead',
  'tr', 'section', 'article', 'header', 'footer', 'pre', 'dl', 'dt', 'dd', 'center', 'figure',
]);
/** Group.tag로 기록할 블록 태그 */
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'pre', 'dt', 'dd']);
const SKIP_TAGS = new Set(['style', 'script', 'head', 'title', 'xml']);
const BOLD_TAGS = new Set(['strong', 'b']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', laquo: '«', raquo: '»',
  ndash: '–', mdash: '—', hellip: '…', middot: '·', bull: '•', times: '×', deg: '°',
  rarr: '→', larr: '←', uarr: '↑', darr: '↓', harr: '↔', rArr: '⇒',
  copy: '©', reg: '®', trade: '™', zwsp: '​', shy: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** 보이지 않는 문자 제거·공백 정리 */
export function cleanText(s: string): string {
  return s.replace(/[​‌‍﻿]/g, '').replace(/[\s ]+/g, ' ').trim();
}

interface ListFrame {
  type: 'ul' | 'ol';
  parentLi: number | null;
  lastLi: number | null;
}

interface ClosedList extends ListFrame {
  /** 닫힌 시점까지 만들어진 묶음 수(사이에 다른 내용이 있었는지 판단용) */
  groupMark: number;
  stream: Stream;
}

interface StreamFrame {
  stream: Stream;
  lists: ListFrame[];
  lis: number[];
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?([a-zA-Z][\w:-]*)(?:\s[^>]*)?\/?>|<|[^<]+/g;

export function readHtml(html: string): Stream[] {
  const streams: Stream[] = [];
  const openStream = (depth: number): StreamFrame => {
    const stream: Stream = { depth, groups: [] };
    streams.push(stream);
    return { stream, lists: [], lis: [] };
  };
  const frames: StreamFrame[] = [openStream(0)];
  const frame = () => frames[frames.length - 1]!;

  const stack: string[] = [];
  let skipDepth = 0;
  let boldDepth = 0;
  let liCounter = 0;
  let groupCount = 0;
  let lastClosedList: ClosedList | null = null;

  let group: Group | null = null;
  let line = '';
  let lineChars = 0;
  let lineBoldChars = 0;

  const endLine = () => {
    if (!group) return;
    const text = cleanText(line);
    if (text) group.lines.push({ text, bold: lineChars > 0 && lineBoldChars === lineChars } satisfies Line);
    line = '';
    lineChars = 0;
    lineBoldChars = 0;
  };

  const flush = () => {
    if (!group) return;
    endLine();
    if (group.lines.length > 0) {
      frame().stream.groups.push(group);
      groupCount++;
    }
    group = null;
  };

  const startGroup = (): Group => {
    let tag = 'div';
    let heading = 0;
    for (let i = stack.length - 1; i >= 0; i--) {
      const name = stack[i]!;
      if (tag === 'div' && BLOCK_TAGS.has(name)) tag = name;
      if (!heading && /^h[1-6]$/.test(name)) heading = Number(name[1]);
    }
    const f = frame();
    const liId = f.lis.length ? f.lis[f.lis.length - 1]! : null;
    const list = f.lists[f.lists.length - 1];
    return { tag, heading, liId, liParent: liId !== null ? (list?.parentLi ?? null) : null, lines: [] };
  };

  const appendText = (raw: string) => {
    let text = decodeEntities(raw).replace(/[\s ]+/g, ' ');
    if (!group) {
      if (!text.trim()) return;
      group = startGroup();
    }
    if (!line) text = text.replace(/^ +/, '');
    if (!text) return;
    line += text;
    const visible = text.replace(/[\s​﻿]/g, '').length;
    lineChars += visible;
    if (boldDepth > 0) lineBoldChars += visible;
  };

  const onOpen = (name: string) => {
    if (BREAK_TAGS.has(name)) flush();
    const f = frame();
    switch (name) {
      case 'br':
        endLine();
        break;
      case 'td':
      case 'th':
        if (line.trim()) line += ' | ';
        break;
      case 'ul':
      case 'ol': {
        let parentLi = f.lis.length ? f.lis[f.lis.length - 1]! : null;
        // <ol><li>Copilot</li></ol><ul><li>…</li></ul> 처럼 번호 목록 바로 뒤에 붙은 불릿 목록은
        // 앞 번호 항목의 하위 목록으로 본다 (v6.3.2 메일)
        const prev = lastClosedList;
        if (
          name === 'ul' && prev && prev.type === 'ol' && prev.stream === f.stream &&
          prev.groupMark === groupCount && prev.parentLi === parentLi && prev.lastLi !== null
        ) {
          parentLi = prev.lastLi;
        }
        f.lists.push({ type: name, parentLi, lastLi: null });
        break;
      }
      case 'li': {
        const id = ++liCounter;
        const list = f.lists[f.lists.length - 1];
        if (list) list.lastLi = id;
        f.lis.push(id);
        break;
      }
      case 'blockquote':
        frames.push(openStream(frames.length));
        break;
    }
  };

  const onClose = (name: string) => {
    if (BREAK_TAGS.has(name)) flush();
    const f = frame();
    switch (name) {
      case 'li':
        f.lis.pop();
        break;
      case 'ul':
      case 'ol': {
        const list = f.lists.pop();
        if (list) lastClosedList = { ...list, groupMark: groupCount, stream: f.stream };
        break;
      }
      case 'blockquote':
        if (frames.length > 1) frames.pop();
        break;
    }
    if (BOLD_TAGS.has(name)) boldDepth = Math.max(0, boldDepth - 1);
  };

  for (const m of html.matchAll(TOKEN)) {
    const token = m[0];
    const tagName = m[1]?.toLowerCase();
    if (token.startsWith('<!')) continue;
    if (!tagName) {
      if (skipDepth === 0) appendText(token);
      continue;
    }
    const closing = token[1] === '/';
    if (SKIP_TAGS.has(tagName)) {
      if (closing) skipDepth = Math.max(0, skipDepth - 1);
      else if (!token.endsWith('/>')) skipDepth++;
      continue;
    }
    if (skipDepth > 0) continue;

    if (closing) {
      const idx = stack.lastIndexOf(tagName);
      if (idx === -1) continue;
      // 짝이 안 맞게 열려 있던 안쪽 태그도 함께 닫는다
      while (stack.length > idx) onClose(stack.pop()!);
      continue;
    }
    if (VOID_TAGS.has(tagName) || token.endsWith('/>')) {
      onOpen(tagName);
      continue;
    }
    stack.push(tagName);
    if (BOLD_TAGS.has(tagName)) boldDepth++;
    onOpen(tagName);
  }
  while (stack.length) onClose(stack.pop()!);
  flush();
  return streams;
}
