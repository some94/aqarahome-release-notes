// 초기 설정: 탭·헤더·숨김 열·체크박스·용어집 초기값. 트리거는 만들지 않는다(installTriggers 담당).
// 여러 번 실행해도 결과가 같다(idempotent): 있는 탭·열·데이터는 그대로 두고 빠진 것만 채운다.
import { setProperty } from './config';
import { deleteRowNumbers, readHeaders } from './sheets/repo';
import {
  CHECKBOX_COLUMNS,
  COLUMN_WIDTHS,
  COLUMNS,
  DATETIME_COLUMNS,
  GLOSSARY_SEED,
  HIDDEN_COLUMNS,
  KEY_COLUMN,
  planHeaders,
  planRowCleanup,
  TABS,
  type TabKey,
} from '../shared/schema';

const HEADER_GUARD = 'header-guard';
const DEFAULT_SHEET_NAMES = ['Sheet1', '시트1'];
const TAB_ORDER: TabKey[] = ['versions', 'items', 'glossary', 'runs'];

export function setup(): string[] {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('시트에서 실행해야 합니다(메뉴 "릴리즈 노트 → 초기 설정" 또는 바인딩된 스크립트 편집기).');
  const report: string[] = [];

  // 웹앱·트리거에서 시트를 열 때 쓰는 ID
  setProperty('SPREADSHEET_ID', ss.getId());

  TAB_ORDER.forEach((tab, index) => report.push(ensureTab(ss, tab, index)));

  const glossary = ss.getSheetByName(TABS.glossary)!;
  if (glossary.getLastRow() < 2) {
    glossary.getRange(2, 1, GLOSSARY_SEED.length, 3).setValues(GLOSSARY_SEED.map((row) => [...row]));
    report.push(`용어집: 초기값 ${GLOSSARY_SEED.length}개 입력`);
  } else {
    report.push(`용어집: 기존 ${glossary.getLastRow() - 1}행 유지(초기값 넣지 않음)`);
  }

  // 새 시트에 기본으로 있던 빈 탭 정리 (내용이 있으면 남김)
  for (const name of DEFAULT_SHEET_NAMES) {
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() === 0 && sheet.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sheet);
      report.push(`빈 기본 탭 "${name}" 삭제`);
    }
  }
  return report;
}

function ensureTab(ss: GoogleAppsScript.Spreadsheet.Spreadsheet, tab: TabKey, index: number): string {
  const name = TABS[tab];
  let sheet = ss.getSheetByName(name);
  const created = !sheet;
  if (!sheet) sheet = ss.insertSheet(name, index);

  const { headers, added } = planHeaders(readHeaders(sheet), COLUMNS[tab]);
  if (added.length) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // 서식은 매번 같은 값으로 다시 적용(결과가 같음)
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold').setBackground('#eef1f5').setWrap(true).setVerticalAlignment('middle');
  sheet.setFrozenRows(1);

  const col = (header: string) => headers.indexOf(header) + 1;
  for (const [header, width] of Object.entries(COLUMN_WIDTHS[tab] ?? {})) {
    if (col(header) > 0) sheet.setColumnWidth(col(header), width);
  }
  for (const header of HIDDEN_COLUMNS[tab] ?? []) {
    if (col(header) > 0) sheet.hideColumns(col(header));
  }
  const cleanup = cleanUpRows(sheet, headers, tab);

  const dataRows = Math.max(sheet.getMaxRows() - 1, 1);
  // 체크박스 규칙은 데이터 행에만(빈 행에 걸면 시트가 FALSE 값으로 취급 → 마지막 행 계산이 틀어짐).
  // 새 행에는 appendRecords가 건다
  const checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  for (const header of CHECKBOX_COLUMNS[tab] ?? []) {
    if (col(header) > 0 && cleanup.lastDataRow >= 2) {
      sheet.getRange(2, col(header), cleanup.lastDataRow - 1, 1).setDataValidation(checkbox);
    }
  }
  for (const header of DATETIME_COLUMNS[tab] ?? []) {
    if (col(header) > 0) sheet.getRange(2, col(header), dataRows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  }
  if (tab === 'items') {
    // 긴 원문·번역은 줄바꿈해서 보이게
    for (const header of ['한국어', '영어 원문']) {
      if (col(header) > 0) sheet.getRange(2, col(header), dataRows, 1).setWrap(true).setVerticalAlignment('top');
    }
  }

  // 헤더 행 실수 수정 방지(경고만 — 편집은 가능)
  const guarded = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).some((p) => p.getDescription() === HEADER_GUARD);
  if (!guarded) sheet.getRange('1:1').protect().setDescription(HEADER_GUARD).setWarningOnly(true);

  const notes: string[] = [];
  if (created) notes.push(`탭 생성, 열 ${headers.length}개`);
  else if (added.length) notes.push(`빠진 열 추가 — ${added.join(', ')}`);
  if (cleanup.deleted) notes.push(`데이터 위쪽 빈 행 ${cleanup.deleted}개 정리`);
  if (cleanup.clearedBelow) notes.push('데이터 아래 빈 행의 체크박스 규칙 정리');
  return `${name}: ${notes.length ? notes.join(', ') : '변경 없음'}`;
}

/**
 * 헤더와 데이터 사이의 완전히 빈 행을 지우고, 데이터 아래 빈 행에 남은 체크박스 규칙·FALSE 값을 지운다.
 * (이전 버전 setup이 빈 행 전체에 체크박스 규칙을 걸어 데이터가 1001행부터 쌓인 경우의 복구 포함)
 */
function cleanUpRows(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  headers: string[],
  tab: TabKey,
): { lastDataRow: number; deleted: number; clearedBelow: boolean } {
  const last = sheet.getLastRow();
  const keyIndex = headers.indexOf(KEY_COLUMN[tab]);
  if (last < 2 || keyIndex < 0) return { lastDataRow: 1, deleted: 0, clearedBelow: false };
  const values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  const plan = planRowCleanup(values, keyIndex);
  const deleted = deleteRowNumbers(sheet, plan.deleteRows);
  const lastDataRow = plan.lastDataRow - deleted;

  let clearedBelow = false;
  const below = sheet.getMaxRows() - lastDataRow;
  const checkboxCols = (CHECKBOX_COLUMNS[tab] ?? []).map((h) => headers.indexOf(h) + 1).filter((c) => c > 0);
  if (below > 0 && checkboxCols.length) {
    for (const c of checkboxCols) {
      const range = sheet.getRange(lastDataRow + 1, c, below, 1);
      // 빈 칸·FALSE만 있는 경우에만 지운다(사람이 적은 값은 남김)
      if (range.getValues().every((r) => r[0] === '' || r[0] === false)) {
        range.clearDataValidations().clearContent();
        clearedBelow = true;
      }
    }
  }
  return { lastDataRow, deleted, clearedBelow };
}
