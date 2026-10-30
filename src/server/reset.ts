// 테스트 데이터 초기화 (6단계 전). 실행 전에 4개 탭을 새 스프레드시트로 백업한다.
// - 지움: 버전·항목·실행 로그 탭의 데이터 행(헤더 유지), 진행 상태·마지막 처리 시점, 이어서 처리 트리거
// - 유지: 용어집 탭, API 키 등 설정값, 주간 트리거
import { TABS, type TabKey } from '../shared/schema';
import { clearRunState } from './pipeline';
import { getSpreadsheet } from './sheets/repo';
import { clearContinuation } from './triggers';
import { invalidateViewerCache } from './viewer-cache';

const CLEAR_TABS: TabKey[] = ['versions', 'items', 'runs'];

export interface ResetResult {
  backupUrl: string;
  cleared: string[];
}

/** 탭 4개를 스크립트 없는 새 스프레드시트로 복사(통째 복사는 바인딩된 스크립트까지 복제되므로 쓰지 않음) */
function backup(): string {
  const ss = getSpreadsheet();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
  const target = SpreadsheetApp.create(`${ss.getName()} 백업 ${stamp}`);
  const placeholder = target.getSheets()[0]!;
  for (const name of Object.values(TABS)) {
    const sheet = ss.getSheetByName(name);
    if (sheet) sheet.copyTo(target).setName(name);
  }
  if (target.getSheets().length > 1) target.deleteSheet(placeholder);
  return target.getUrl();
}

export function resetTestData(): ResetResult {
  const backupUrl = backup();
  const ss = getSpreadsheet();
  const cleared: string[] = [];
  for (const tab of CLEAR_TABS) {
    const sheet = ss.getSheetByName(TABS[tab]);
    if (!sheet) continue;
    const rows = sheet.getMaxRows() - 1;
    const cols = sheet.getMaxColumns();
    const before = Math.max(sheet.getLastRow() - 1, 0);
    // 행 삭제 대신 내용·체크박스 규칙만 지운다(고정 행 아래 모든 행 삭제는 시트가 거부함)
    if (rows > 0) sheet.getRange(2, 1, rows, cols).clearContent().clearDataValidations();
    cleared.push(`${TABS[tab]}: ${before}행 삭제`);
  }
  invalidateViewerCache();
  clearRunState();
  PropertiesService.getScriptProperties().deleteProperty('LAST_PROCESSED_AT');
  const triggers = clearContinuation();
  cleared.push(`진행 상태·마지막 처리 시점 초기화${triggers ? `, 이어서 처리 트리거 ${triggers}개 삭제` : ''}`);
  return { backupUrl, cleared };
}
