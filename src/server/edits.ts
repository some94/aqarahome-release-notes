// 항목 탭에서 사람이 한국어를 고치면 '수정 여부'를 표시한다 (simple onEdit 트리거).
// 붙여넣기·스크립트 수정처럼 onEdit이 못 잡는 경우는 isEditedItem()이 기계 번역과 비교해서 보완한다.
import { editedFlagAfterEdit, TABS } from '../shared/schema';
import { readHeaders } from './sheets/repo';
import { invalidateViewerCache } from './viewer-cache';

export function handleEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  const range = e.range;
  const sheet = range.getSheet();
  // 사람이 버전·항목 탭을 고치면 뷰어 캐시를 지운다(번역 수정, 처리 상태 변경 등)
  if (sheet.getName() === TABS.versions || sheet.getName() === TABS.items) invalidateViewerCache();
  if (sheet.getName() !== TABS.items) return;

  const headers = readHeaders(sheet);
  const koCol = headers.indexOf('한국어') + 1;
  const machineCol = headers.indexOf('기계 번역') + 1;
  const flagCol = headers.indexOf('수정 여부') + 1;
  if (koCol === 0 || flagCol === 0) return;
  if (koCol < range.getColumn() || koCol > range.getLastColumn()) return;

  const firstRow = Math.max(range.getRow(), 2);
  const lastRow = range.getLastRow();
  if (lastRow < firstRow) return;
  const count = lastRow - firstRow + 1;

  const idCol = headers.indexOf('항목 ID') + 1;
  const ko = sheet.getRange(firstRow, koCol, count, 1).getValues();
  const machine = machineCol ? sheet.getRange(firstRow, machineCol, count, 1).getValues() : ko.map(() => ['']);
  const ids = idCol ? sheet.getRange(firstRow, idCol, count, 1).getValues() : ko.map(() => ['x']);
  // 항목 ID가 없는 행(데이터 아래 빈 행)은 비워 둔다
  const flags = ko.map((row, i) => [String(ids[i]![0]).trim() ? editedFlagAfterEdit(row[0], machine[i]![0]) : '']);
  sheet.getRange(firstRow, flagCol, count, 1).setValues(flags);
}
