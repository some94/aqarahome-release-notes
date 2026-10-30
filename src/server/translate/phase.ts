// 시트의 '번역 대기' 버전·선택 항목을 번역해서 기록한다.
// 진행 상황은 시트 자체(기계 번역 칸이 채워졌는지)로 판단하므로 중간에 멈춰도 이어서 할 수 있다.
import { splitPlatform } from '../../parser/items';
import { isEditedItem, VERSION_STATUS, type SheetRecord } from '../../shared/schema';
import { chunkItems, type TranslationRequestItem, type TranslationResult } from '../../shared/translation';
import { getConfig } from '../config';
import { readGlossary, readTable, updateVersionStatus, writeCells, type TableRow } from '../sheets/repo';
import { compareVersions } from '../../parser/version';
import { translateBatch, type CallStats } from './translate';

/** 묶음 하나(요청 + 재시도)가 넘지 않을 것으로 보는 시간. 이보다 남은 시간이 적으면 다음 실행으로 넘긴다 */
const BATCH_RESERVE_MS = 100 * 1000;

export interface TranslateProgress {
  stats: CallStats;
  translatedItems: number;
  /** 번역에 실패한 항목 ID(버전별) — 버전이 끝날 때 검수 필요 판단에 쓴다 */
  failedIds: Record<string, string[]>;
  /** 검수 필요로 바뀐 버전 */
  reviewVersions: string[];
  errors: string[];
}

export function emptyProgress(stats: CallStats): TranslateProgress {
  return { stats, translatedItems: 0, failedIds: {}, reviewVersions: [], errors: [] };
}

function toRequest(row: TableRow, byId: Map<string, TableRow>): TranslationRequestItem {
  const original = String(row.record['영어 원문'] ?? '');
  const parentId = String(row.record['부모 항목 ID'] ?? '').trim();
  const parent = parentId ? byId.get(parentId) : undefined;
  const request: TranslationRequestItem = {
    id: String(row.record['항목 ID']),
    text: splitPlatform(original).text || original,
    context: { section: String(row.record['섹션'] ?? '') },
  };
  if (parent) request.context.parent = String(parent.record['영어 원문'] ?? '');
  return request;
}

/** 번역 결과를 시트에 쓴다. 쓰기 직전에 사람이 고친 항목은 다시 확인해서 건너뛴다(번역 중 수정 대비) */
function writeResults(results: TranslationResult[], rowsById: Map<string, TableRow>, options: { overwriteEdited?: Set<string> } = {}): number {
  const fresh = new Map(readTable('items').rows.map((r) => [String(r.record['항목 ID']), r]));
  const updates: { rowNumber: number; values: SheetRecord }[] = [];
  for (const res of results) {
    const row = fresh.get(res.id) ?? rowsById.get(res.id);
    if (!row) continue;
    const overwrite = options.overwriteEdited?.has(res.id) ?? false;
    if (!overwrite && isEditedItem(row.record)) continue;
    const values: SheetRecord = {
      '한국어': res.ko,
      '기계 번역': res.ko,
      '관련 기기': res.devices.join(', '),
      '기능 분류 태그': res.tags.join(', '),
    };
    if (overwrite) values['수정 여부'] = false;
    // 접두어로 정한 플랫폼이 없을 때(공통)만 번역 단계에서 찾은 플랫폼을 쓴다
    if (String(row.record['플랫폼']) === '공통' && res.platforms.length) values['플랫폼'] = res.platforms.join(', ');
    updates.push({ rowNumber: row.rowNumber, values });
  }
  writeCells('items', updates);
  return updates.length;
}

/**
 * 버전 1개 번역. 아직 기계 번역이 없고 사람이 고치지 않은 항목만 대상.
 * @returns 'done' 이 버전 끝 / 'paused' 시간이 부족해 중단(다음 실행에서 이어서)
 */
export function translateVersion(version: string, deadline: number, progress: TranslateProgress): 'done' | 'paused' {
  const config = getConfig();
  const glossary = readGlossary();
  const all = readTable('items').rows.filter((r) => String(r.record['버전']).trim() === version);
  const byId = new Map(all.map((r) => [String(r.record['항목 ID']), r]));
  const failedBefore = new Set(progress.failedIds[version] ?? []);
  const targets = all.filter(
    (r) => !isEditedItem(r.record) && !String(r.record['기계 번역'] ?? '').trim() && !failedBefore.has(String(r.record['항목 ID'])),
  );

  for (const batch of chunkItems(targets.map((r) => toRequest(r, byId)), config.translateBatchSize)) {
    if (Date.now() > deadline - BATCH_RESERVE_MS) return 'paused';
    const outcome = translateBatch(config, glossary, batch, progress.stats);
    progress.translatedItems += writeResults(outcome.results, byId);
    if (outcome.failedIds.length) {
      progress.failedIds[version] = [...(progress.failedIds[version] ?? []), ...outcome.failedIds];
      progress.errors.push(...outcome.errors.map((e) => `v${version}: ${e}`));
    }
  }

  const failed = progress.failedIds[version] ?? [];
  if (failed.length) {
    updateVersionStatus(version, VERSION_STATUS.review, [
      `[번역 실패 ${failed.length}개 — 원문은 저장됨, "선택 항목 재번역"으로 다시 시도] ${failed.slice(0, 30).join(', ')}${failed.length > 30 ? ' …' : ''}`,
    ]);
    progress.reviewVersions.push(`v${version}`);
  } else {
    updateVersionStatus(version, VERSION_STATUS.ok);
  }
  return 'done';
}

/** '번역 대기' 버전을 오래된 버전부터 번역. 모두 끝나면 true, 시간이 부족하면 false */
export function translatePendingVersions(deadline: number, progress: TranslateProgress): boolean {
  const pending = readTable('versions')
    .rows.filter((r) => r.record['처리 상태'] === VERSION_STATUS.pending)
    .map((r) => String(r.record['버전']).trim())
    .sort(compareVersions);
  for (const version of pending) {
    if (translateVersion(version, deadline, progress) === 'paused') return false;
  }
  return true;
}

/** 선택한 항목 재번역(메뉴). overwriteEdited에 있는 항목은 사람이 고친 번역도 덮어쓴다 */
export function retranslateItems(ids: string[], overwriteEdited: Set<string>, deadline: number, progress: TranslateProgress): { done: number; remaining: number } {
  const config = getConfig();
  const glossary = readGlossary();
  const all = readTable('items').rows;
  const byId = new Map(all.map((r) => [String(r.record['항목 ID']), r]));
  const targets = ids.map((id) => byId.get(id)).filter((r): r is TableRow => !!r);
  const batches = chunkItems(targets.map((r) => toRequest(r, byId)), config.translateBatchSize);
  let done = 0;
  for (const batch of batches) {
    if (Date.now() > deadline - BATCH_RESERVE_MS) break;
    const outcome = translateBatch(config, glossary, batch, progress.stats);
    const written = writeResults(outcome.results, byId, { overwriteEdited });
    done += written;
    progress.translatedItems += written;
    if (outcome.failedIds.length) progress.errors.push(...outcome.errors);
  }
  return { done, remaining: targets.length - done };
}
