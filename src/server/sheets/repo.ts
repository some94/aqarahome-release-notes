// 시트 읽기·쓰기. 열은 헤더 이름으로 찾는다(사람이 열 순서를 바꿔도 동작).
// 마지막 행은 getLastRow()가 아니라 키 열로 판단한다 — 체크박스 규칙이 걸린 빈 칸은
// 시트에서 FALSE 값으로 취급되어 getLastRow()가 실제 데이터보다 커진다.
import { getConfig } from '../config';
import { invalidateViewerCache } from '../viewer-cache';
import {
  CHECKBOX_COLUMNS,
  COLUMNS,
  fromRow,
  itemRecords,
  KEY_COLUMN,
  TABS,
  toRow,
  versionRecord,
  type SheetRecord,
  type TabKey,
  type VersionInput,
} from '../../shared/schema';

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;

/** 뷰어에 보이는 탭이 바뀌면 뷰어 캐시를 지운다 */
function touched(tab: TabKey): void {
  if (tab === 'versions' || tab === 'items') invalidateViewerCache();
}

export function getSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  // 시트에서 실행하면 활성 시트, 웹앱·트리거처럼 활성 시트가 없을 수 있는 곳에서는 setup()이 저장한 ID
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const id = getConfig().spreadsheetId;
  if (!id) throw new Error('스프레드시트를 찾을 수 없습니다. 시트 메뉴에서 "초기 설정"을 먼저 실행하세요.');
  return SpreadsheetApp.openById(id);
}

export function getSheet(tab: TabKey): Sheet {
  const sheet = getSpreadsheet().getSheetByName(TABS[tab]);
  if (!sheet) throw new Error(`"${TABS[tab]}" 탭이 없습니다. 시트 메뉴에서 "초기 설정"을 먼저 실행하세요.`);
  return sheet;
}

export function readHeaders(sheet: Sheet): string[] {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0]!.map((v) => String(v).trim());
}

/** 키 열이 채워진 마지막 행 번호(데이터가 없으면 1 = 헤더) */
export function lastDataRow(sheet: Sheet, headers: string[], tab: TabKey): number {
  const keyCol = headers.indexOf(KEY_COLUMN[tab]) + 1;
  const last = sheet.getLastRow();
  if (keyCol === 0 || last < 2) return Math.min(last, 1);
  const keys = sheet.getRange(2, keyCol, last - 1, 1).getValues();
  for (let i = keys.length - 1; i >= 0; i--) if (String(keys[i]![0]).trim()) return i + 2;
  return 1;
}

export interface TableRow {
  /** 시트 행 번호(1부터, 헤더가 1) */
  rowNumber: number;
  record: SheetRecord;
}

export function readTable(tab: TabKey): { sheet: Sheet; headers: string[]; rows: TableRow[] } {
  const sheet = getSheet(tab);
  const headers = readHeaders(sheet);
  const last = lastDataRow(sheet, headers, tab);
  if (last < 2 || headers.length === 0) return { sheet, headers, rows: [] };
  const key = KEY_COLUMN[tab];
  const values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  const rows = values
    .map((row, i) => ({ rowNumber: i + 2, record: fromRow(headers, row) }))
    .filter((r) => String(r.record[key] ?? '').trim() !== '');
  return { sheet, headers, rows };
}

/** 여러 행을 한 번에 추가 (setValues 1회). 체크박스 열은 새로 쓴 행에만 규칙을 건다 */
export function appendRecords(tab: TabKey, records: SheetRecord[]): void {
  if (records.length === 0) return;
  const sheet = getSheet(tab);
  const headers = readHeaders(sheet);
  const missing = COLUMNS[tab].filter((c) => !headers.includes(c));
  if (missing.length) throw new Error(`"${TABS[tab]}" 탭에 열이 없습니다: ${missing.join(', ')} — "초기 설정"을 다시 실행하세요.`);
  const start = lastDataRow(sheet, headers, tab) + 1;
  const rows = records.map((r) => toRow(headers, r));
  sheet.getRange(start, 1, rows.length, headers.length).setValues(rows);
  const checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  for (const header of CHECKBOX_COLUMNS[tab] ?? []) {
    sheet.getRange(start, headers.indexOf(header) + 1, rows.length, 1).setDataValidation(checkbox);
  }
  touched(tab);
}

/** 지정한 열만 고친다(다른 열 — 특히 사람이 고친 칸 — 은 건드리지 않음) */
export function updateCells(tab: TabKey, rowNumber: number, values: SheetRecord): void {
  const sheet = getSheet(tab);
  const headers = readHeaders(sheet);
  for (const [key, value] of Object.entries(values)) {
    const col = headers.indexOf(key);
    if (col < 0) throw new Error(`"${TABS[tab]}" 탭에 "${key}" 열이 없습니다.`);
    sheet.getRange(rowNumber, col + 1).setValue(value);
  }
  touched(tab);
}

/** 조건에 맞는 행 삭제. 연속 구간은 한 번에 지운다(아래에서 위로). 지운 행 수를 돌려준다 */
export function deleteRows(tab: TabKey, match: (record: SheetRecord) => boolean): number {
  const { sheet, rows } = readTable(tab);
  const deleted = deleteRowNumbers(sheet, rows.filter((r) => match(r.record)).map((r) => r.rowNumber));
  if (deleted) touched(tab);
  return deleted;
}

export function deleteRowNumbers(sheet: Sheet, rowNumbers: number[]): number {
  const targets = [...rowNumbers].sort((a, b) => b - a);
  let i = 0;
  while (i < targets.length) {
    const end = targets[i]!;
    let start = end;
    while (i + 1 < targets.length && targets[i + 1] === start - 1) {
      i++;
      start--;
    }
    sheet.deleteRows(start, end - start + 1);
    i++;
  }
  return targets.length;
}

/** 시트에 저장된 버전 번호 목록 (자동 수집에서 건너뛸 대상) */
export function storedVersions(): Set<string> {
  return new Set(readTable('versions').rows.map((r) => String(r.record['버전']).trim()).filter(Boolean));
}

/** 파싱한 버전 1개를 저장: 버전 행 1개 + 항목 행들. 처리 상태는 '번역 대기' */
export function saveParsedVersion(input: VersionInput, now = new Date()): void {
  if (storedVersions().has(input.parsed.version)) {
    throw new Error(`v${input.parsed.version}은 이미 저장되어 있습니다(자동 수집은 저장된 버전을 다시 쓰지 않음).`);
  }
  // 항목을 먼저 쓰고 버전 행을 나중에 쓴다 → 중간에 실패해도 '버전 행 없음 = 미저장'으로 다시 처리됨.
  // 그때 남은 항목 행(버전 행 없는 고아)은 다시 쓰기 전에 지운다
  deleteRows('items', (r) => String(r['버전']).trim() === input.parsed.version);
  appendRecords('items', itemRecords(input.parsed));
  appendRecords('versions', [versionRecord(input, now)]);
}

export function appendRunLog(record: SheetRecord): void {
  appendRecords('runs', [record]);
}

/**
 * 여러 행의 지정 열만 고친다. 열마다 연속한 행 구간을 한 번에 쓴다(행별 setValue보다 훨씬 빠름).
 * 지정하지 않은 열은 건드리지 않는다.
 */
export function writeCells(tab: TabKey, updates: { rowNumber: number; values: SheetRecord }[]): void {
  if (updates.length === 0) return;
  const sheet = getSheet(tab);
  const headers = readHeaders(sheet);
  const columns = new Set(updates.flatMap((u) => Object.keys(u.values)));
  for (const column of columns) {
    const col = headers.indexOf(column) + 1;
    if (col === 0) throw new Error(`"${TABS[tab]}" 탭에 "${column}" 열이 없습니다.`);
    const rows = updates.filter((u) => column in u.values).sort((a, b) => a.rowNumber - b.rowNumber);
    let i = 0;
    while (i < rows.length) {
      let j = i;
      while (j + 1 < rows.length && rows[j + 1]!.rowNumber === rows[j]!.rowNumber + 1) j++;
      const run = rows.slice(i, j + 1);
      sheet.getRange(run[0]!.rowNumber, col, run.length, 1).setValues(run.map((u) => [u.values[column]!]));
      i = j + 1;
    }
  }
  touched(tab);
}

export function readGlossary(): { source: string; korean: string; note?: string }[] {
  return readTable('glossary').rows
    .map((r) => ({ source: String(r.record['원어']).trim(), korean: String(r.record['한국어 표기'] ?? '').trim(), note: String(r.record['비고'] ?? '').trim() }))
    .filter((g) => g.source && g.korean)
    .map((g) => (g.note ? g : { source: g.source, korean: g.korean }));
}

/** 버전 행의 처리 상태 변경, 경고 추가, 갱신 시각 기록 */
export function updateVersionStatus(version: string, status: string, addWarnings: string[] = []): void {
  const row = readTable('versions').rows.find((r) => String(r.record['버전']).trim() === version);
  if (!row) return;
  const values: SheetRecord = { '처리 상태': status, '갱신 시각': new Date() };
  if (addWarnings.length) {
    const existing = String(row.record['경고'] ?? '').trim();
    // 셀 크기 제한 대비 길이 제한
    values['경고'] = [existing, ...addWarnings].filter(Boolean).join('\n').slice(0, 5000);
  }
  writeCells('versions', [{ rowNumber: row.rowNumber, values }]);
}
