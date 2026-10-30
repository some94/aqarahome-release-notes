// 알림: 오류·검수 필요 시 스크립트 소유자에게 메일(MailApp, script.send_mail).
// 새 버전은 구글 챗 웹훅으로 — CHAT_WEBHOOK_URL이 있을 때만 보낸다.
import { getConfig } from './config';

export function notifyOwner(subject: string, lines: string[]): void {
  const to = Session.getEffectiveUser().getEmail();
  if (!to) return;
  const sheetUrl = getConfig().spreadsheetId ? `https://docs.google.com/spreadsheets/d/${getConfig().spreadsheetId}/edit` : '';
  MailApp.sendEmail({
    to,
    subject: `[Aqara Home 릴리즈 노트] ${subject}`,
    body: [...lines, '', sheetUrl ? `시트: ${sheetUrl}` : '', __VIEWER_URL__ ? `뷰어: ${__VIEWER_URL__}` : '', '(실행 로그 탭에서 자세한 내용을 확인하세요)']
      .filter((l) => l !== undefined)
      .join('\n'),
  });
}

/** 뷰어에서 특정 버전을 바로 여는 주소 */
export function viewerLink(version?: string): string {
  if (!__VIEWER_URL__) return '';
  return version ? `${__VIEWER_URL__}?v=${encodeURIComponent(version)}` : __VIEWER_URL__;
}

/** 새 버전 알림 문구(구글 챗 텍스트 형식: *굵게*, <주소|글자>) */
export function newVersionsMessage(versions: string[], reviewVersions: string[]): string {
  const latest = versions[versions.length - 1]?.replace(/^v|\(.*\)$/g, '');
  const link = viewerLink(latest);
  return [
    `*Aqara Home 릴리즈 노트 — 새 버전 ${versions.length}개*`,
    ...versions.map((v) => `• ${v}`),
    reviewVersions.length ? `⚠ 검수 필요: ${reviewVersions.join(', ')} (번역 일부 실패 — 원문은 저장됨)` : '',
    link ? `<${link}|뷰어에서 보기>` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 구글 챗 웹훅 알림. URL이 없으면 아무것도 하지 않고 false.
 * 실패하면 예외(호출하는 쪽에서 실행 결과를 덮지 않도록 처리).
 */
export function notifyChat(text: string): boolean {
  const url = getConfig().chatWebhookUrl;
  if (!url) return false;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true,
  });
  const status = res.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(`챗 웹훅 응답 ${status}: ${res.getContentText().slice(0, 200)}`);
  return true;
}
