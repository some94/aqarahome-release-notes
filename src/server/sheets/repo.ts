// 시트 읽기·쓰기. 열은 헤더 이름으로 찾는다(사람이 열 순서를 바꿔도 동작).
import { getConfig } from '../config';
import {
  COLUMNS,
  fromRow,
  itemRecords,
  TABS,
  toRow,
  versionRecord,
  type SheetRecord,
  type TabKey,
  type VersionInput,
} from '../../shared/schema';

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;

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

export interface TableRow {
  /** 시트 행 번호(1부터, 헤더가 1) */
  rowNumber: number;
  record: SheetRecord;
}

export function readTable(tab: TabKey): { sheet: Sheet; headers: string[]; rows: TableRow[] } {
  const sheet = getSheet(tab);
  const headers = readHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || headers.length === 0) return { sheet, headers, rows: [] };
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rows = values
    .map((row, i) => ({ rowNumber: i + 2, record: fromRow(headers, row) }))
    .filter((r) => Object.values(r.record).some((v) => v !== ''));
  return { sheet, headers, rows };
}

/** 여러 행을 한 번에 추가 (setValues 1회) */
export function appendRecords(tab: TabKey, records: SheetRecord[]): void {
  if (records.length === 0) return;
  const sheet = getSheet(tab);
  const headers = readHeaders(sheet);
  const missing = COLUMNS[tab].filter((c) => !headers.includes(c));
  if (missing.length) throw new Error(`"${TABS[tab]}" 탭에 열이 없습니다: ${missing.join(', ')} — "초기 설정"을 다시 실행하세요.`);
  const rows = records.map((r) => toRow(headers, r));
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
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
}

/** 조건에 맞는 행 삭제. 연속 구간은 한 번에 지운다(아래에서 위로). 지운 행 수를 돌려준다 */
export function deleteRows(tab: TabKey, match: (record: SheetRecord) => boolean): number {
  const { sheet, rows } = readTable(tab);
  const targets = rows.filter((r) => match(r.record)).map((r) => r.rowNumber).sort((a, b) => b - a);
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
