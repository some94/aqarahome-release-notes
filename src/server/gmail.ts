// Gmail 읽기 전용 접근 (고급 서비스 Gmail API v1, gmail.readonly).
// 메일 수정·삭제·라벨 변경 API는 쓰지 않는다. 본문은 제목 키워드를 통과한 메일만 연다.
import { charsetOf, findBodyParts, headerValue, type PayloadPart } from '../shared/gmail-payload';

export interface MailMeta {
  id: string;
  subject: string;
  /** 수신 시각(ms, Gmail internalDate) */
  receivedAt: number;
  from?: string;
  /** 헤더 Message-ID(수신자 모두 같은 값) */
  rfc822Id?: string;
}

export interface MailBody {
  html?: string;
  text?: string;
}

function api() {
  if (typeof Gmail === 'undefined' || !Gmail.Users?.Messages) {
    throw new Error('Gmail 고급 서비스가 꺼져 있습니다(appsscript.json의 enabledAdvancedServices 확인).');
  }
  return Gmail.Users.Messages;
}

/** 검색 쿼리에 맞는 메시지 ID 전체 (페이지 넘김 포함) */
export function listMessageIds(query: string): string[] {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = api().list('me', { q: query, maxResults: 100, pageToken });
    for (const m of res.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = res.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
}

/** 헤더(제목·발신·날짜)만 읽는다 — 본문은 열지 않음 */
export function getMeta(id: string): MailMeta {
  const msg = api().get('me', id, { format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date', 'Message-ID'] });
  const headers = msg.payload?.headers ?? [];
  return {
    id,
    subject: headerValue(headers, 'Subject') ?? '',
    receivedAt: Number(msg.internalDate ?? 0),
    from: headerValue(headers, 'From'),
    rfc822Id: headerValue(headers, 'Message-ID') ?? headerValue(headers, 'Message-Id'),
  };
}

/** 본문(HTML·텍스트). 제목 키워드를 통과한 릴리즈 노트 메일에만 호출할 것 */
export function getBody(id: string): MailBody {
  const msg = api().get('me', id, { format: 'full' });
  const { html, text } = findBodyParts(msg.payload as PayloadPart | undefined);
  return { html: html ? decodePart(id, html) : undefined, text: text ? decodePart(id, text) : undefined };
}

function decodePart(messageId: string, part: PayloadPart): string {
  let data = part.body?.data;
  if ((data === undefined || data === '') && part.body?.attachmentId) {
    // 큰 본문은 첨부처럼 따로 받아야 한다
    data = api().Attachments!.get('me', messageId, part.body.attachmentId).data as string | number[] | undefined;
  }
  if (data === undefined || data === '') return '';
  const bytes = typeof data === 'string' ? Utilities.base64DecodeWebSafe(data) : (data as GoogleAppsScript.Byte[]);
  return Utilities.newBlob(bytes).getDataAsString(charsetOf(part));
}

export function gmailIso(ms: number): string {
  return new Date(ms).toISOString();
}
