// 알림: 오류·검수 필요 시 스크립트 소유자에게 메일(MailApp, script.send_mail).
// 구글 챗 웹훅은 구조만 준비 — CHAT_WEBHOOK_URL이 있을 때만 보낸다.
import { getConfig } from './config';

export function notifyOwner(subject: string, lines: string[]): void {
  const to = Session.getEffectiveUser().getEmail();
  if (!to) return;
  const sheetUrl = getConfig().spreadsheetId ? `https://docs.google.com/spreadsheets/d/${getConfig().spreadsheetId}/edit` : '';
  MailApp.sendEmail({
    to,
    subject: `[Aqara Home 릴리즈 노트] ${subject}`,
    body: [...lines, '', sheetUrl ? `시트: ${sheetUrl}` : '', '(실행 로그 탭에서 자세한 내용을 확인하세요)'].filter((l) => l !== undefined).join('\n'),
  });
}

/** 구글 챗 웹훅 알림. URL이 없으면 아무것도 하지 않는다 */
export function notifyChat(text: string): void {
  const url = getConfig().chatWebhookUrl;
  if (!url) return;
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true,
  });
}
