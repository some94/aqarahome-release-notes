// 저장된 버전의 Gmail 링크를 Message-ID 검색 링크로 다시 만든다(헤더만 읽음, 여러 번 실행해도 같음).
import { gmailLink } from '../shared/schema';
import { getMeta } from './gmail';
import { readTable, writeCells } from './sheets/repo';

export function rebuildGmailLinks(): { updated: number; failed: string[] } {
  const rows = readTable('versions').rows;
  const updates: { rowNumber: number; values: { 'Gmail 링크': string } }[] = [];
  const failed: string[] = [];
  const cache = new Map<string, string>();
  for (const row of rows) {
    const mailId = String(row.record['Gmail 메시지 ID'] ?? '').trim();
    if (!mailId) continue;
    try {
      // 여러 버전이 같은 메일(인용본)에서 왔으면 헤더는 한 번만 읽는다
      if (!cache.has(mailId)) cache.set(mailId, gmailLink(mailId, getMeta(mailId).rfc822Id));
      const link = cache.get(mailId)!;
      if (link !== row.record['Gmail 링크']) updates.push({ rowNumber: row.rowNumber, values: { 'Gmail 링크': link } });
    } catch (e) {
      failed.push(`v${row.record['버전']}: ${(e as Error).message}`);
    }
  }
  writeCells('versions', updates);
  return { updated: updates.length, failed };
}
