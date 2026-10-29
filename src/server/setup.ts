// 초기 설정: 탭·헤더·숨김 열·체크박스·용어집 초기값. 트리거는 만들지 않는다(installTriggers 담당).
// 여러 번 실행해도 결과가 같다(idempotent): 있는 탭·열·데이터는 그대로 두고 빠진 것만 채운다.
import { setProperty } from './config';
import { readHeaders } from './sheets/repo';
import {
  CHECKBOX_COLUMNS,
  COLUMN_WIDTHS,
  COLUMNS,
  GLOSSARY_SEED,
  HIDDEN_COLUMNS,
  planHeaders,
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
  const dataRows = Math.max(sheet.getMaxRows() - 1, 1);
  // insertCheckboxes()는 빈 행에 FALSE 값을 채워 getLastRow()가 맨 아래 행이 되므로,
  // 값은 비워 두고 체크박스 데이터 확인 규칙만 건다
  const checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  for (const header of CHECKBOX_COLUMNS[tab] ?? []) {
    if (col(header) > 0) sheet.getRange(2, col(header), dataRows, 1).setDataValidation(checkbox);
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

  if (created) return `${name}: 탭 생성, 열 ${headers.length}개`;
  if (added.length) return `${name}: 빠진 열 추가 — ${added.join(', ')}`;
  return `${name}: 변경 없음`;
}
