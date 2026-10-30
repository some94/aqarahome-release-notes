// Gmail API 메시지 payload(MIME 트리)에서 본문 파트 찾기. GAS API에 의존하지 않는 순수 함수.

export interface PayloadHeader {
  name?: string;
  value?: string;
}

export interface PayloadPart {
  mimeType?: string;
  filename?: string;
  headers?: PayloadHeader[];
  /** Apps Script 고급 서비스에서는 data가 base64url 문자열 또는 바이트 배열로 온다 */
  body?: { data?: string | number[]; attachmentId?: string; size?: number };
  parts?: PayloadPart[];
}

export function headerValue(headers: PayloadHeader[] | undefined, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name?.toLowerCase() === lower)?.value;
}

/** Content-Type의 charset. 없으면 utf-8 */
export function charsetOf(part: PayloadPart): string {
  const contentType = headerValue(part.headers, 'Content-Type') ?? '';
  const m = contentType.match(/charset\s*=\s*"?([^";\s]+)"?/i);
  return m ? m[1]!.toLowerCase() : 'utf-8';
}

function isAttachment(part: PayloadPart): boolean {
  if (part.filename) return true;
  return /^\s*attachment/i.test(headerValue(part.headers, 'Content-Disposition') ?? '');
}

/** 첨부가 아닌 첫 text/html·text/plain 파트(깊이 우선) */
export function findBodyParts(payload: PayloadPart | undefined): { html?: PayloadPart; text?: PayloadPart } {
  const found: { html?: PayloadPart; text?: PayloadPart } = {};
  const visit = (part: PayloadPart) => {
    const type = (part.mimeType ?? '').toLowerCase();
    if (!isAttachment(part)) {
      if (type === 'text/html' && !found.html) found.html = part;
      if (type === 'text/plain' && !found.text) found.text = part;
    }
    part.parts?.forEach(visit);
  };
  if (payload) visit(payload);
  return found;
}
