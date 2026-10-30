// 백필 미리보기(시트에 쓰지 않음)와 실제 백필 실행 (SPEC 9번)
import { checkSubject, parseReleaseMail } from '../parser';
import { buildPreviewReport, type PreviewEntry } from '../shared/preview';
import { getConfig } from './config';
import { getBody, getMeta, gmailIso, listMessageIds } from './gmail';
import { storedVersions } from './sheets/repo';

/** 미리보기는 이어서 처리하지 않으므로, 시간이 부족하면 거기까지만 보여준다 */
const PREVIEW_BUDGET_MS = 5 * 60 * 1000;

/** 전체 메일을 읽어 파싱 결과만 만든다. 제목 키워드에 걸린 메일은 본문을 열지 않는다 */
export function previewBackfill(): { lines: string[]; partial: boolean } {
  const deadline = Date.now() + PREVIEW_BUDGET_MS;
  const config = getConfig();
  const entries: PreviewEntry[] = [];
  let partial = false;

  const metas = listMessageIds(config.gmailQuery).map(getMeta).sort((a, b) => a.receivedAt - b.receivedAt);
  for (const meta of metas) {
    const mail = { id: meta.id, subject: meta.subject, date: gmailIso(meta.receivedAt) };
    const check = checkSubject(meta.subject, config.subjectKeywords);
    if (!check.ok) {
      entries.push({ mail, excluded: check.reason });
      continue;
    }
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    try {
      entries.push({ mail, result: parseReleaseMail({ subject: meta.subject, date: mail.date, ...getBody(meta.id) }) });
    } catch (e) {
      entries.push({ mail, error: (e as Error).message });
    }
  }

  const lines = buildPreviewReport(entries, { stored: storedVersions() });
  if (partial) lines.unshift(`⚠ 시간 제한으로 일부만 확인했습니다(${entries.length}/${metas.length}건).`);
  return { lines, partial };
}
