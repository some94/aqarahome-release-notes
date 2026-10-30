// 저장된 버전 재파싱 — 별도 메뉴 전용(자동 수집·백필에서는 호출하지 않음).
// 사람이 고친 항목이 하나라도 있으면 경고하고 중단한다(덮어쓰지 않음).
import { parseReleaseMail } from '../parser';
import { isEditedItem, SOURCE } from '../shared/schema';
import { getBody, getMeta, gmailIso } from './gmail';
import { deleteRows, readTable, saveParsedVersion } from './sheets/repo';

export interface ReparseResult {
  ok: boolean;
  message: string;
}

export function reparseVersion(input: string): ReparseResult {
  const version = input.trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { ok: false, message: `버전 형식이 아닙니다: "${input}" (예: 6.4.1)` };

  const row = readTable('versions').rows.find((r) => String(r.record['버전']).trim() === version);
  if (!row) return { ok: false, message: `v${version}은 시트에 없습니다.` };
  if (row.record['출처'] === SOURCE.internal) return { ok: false, message: `v${version}은 사내 번역본이라 메일에서 다시 읽을 수 없습니다.` };

  const edited = readTable('items').rows.filter((r) => String(r.record['버전']).trim() === version && isEditedItem(r.record));
  if (edited.length) {
    const ids = edited.map((r) => String(r.record['항목 ID']));
    return {
      ok: false,
      message: [
        `v${version}에 사람이 고친 항목이 ${ids.length}개 있어 중단했습니다(덮어쓰지 않음).`,
        ...ids.slice(0, 20).map((id) => `- ${id}`),
        ids.length > 20 ? `… 외 ${ids.length - 20}개` : '',
        '수정한 번역을 따로 보관한 뒤 "수정 여부"를 해제하고 한국어 칸을 비우면 다시 실행할 수 있습니다.',
      ].filter(Boolean).join('\n'),
    };
  }

  const mailId = String(row.record['Gmail 메시지 ID'] ?? '').trim();
  if (!mailId) return { ok: false, message: `v${version} 행에 Gmail 메시지 ID가 없습니다.` };
  const meta = getMeta(mailId);
  const result = parseReleaseMail({ subject: meta.subject, date: gmailIso(meta.receivedAt), ...getBody(mailId) });
  const parsed = result.versions.filter((v) => v.version === version).sort((a, b) => a.source.depth - b.source.depth)[0];
  if (!parsed) return { ok: false, message: `메일 "${meta.subject}"에서 v${version}을 다시 찾지 못했습니다. 기존 데이터는 그대로 둡니다.` };

  // 새로 읽는 데 성공한 뒤에만 지운다
  const removedItems = deleteRows('items', (r) => String(r['버전']).trim() === version);
  deleteRows('versions', (r) => String(r['버전']).trim() === version);
  saveParsedVersion({ parsed, origin: parsed.source.depth === 0 ? 'original' : 'quote', mailId, mailDate: gmailIso(meta.receivedAt) });
  return {
    ok: true,
    message: `v${version} 재파싱 완료 — 항목 ${removedItems}개 → ${parsed.items.length}개, 처리 상태 "번역 대기"${parsed.warnings.length ? `\n⚠ ${parsed.warnings.join('\n⚠ ')}` : ''}`,
  };
}
