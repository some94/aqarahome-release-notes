import { previewBackfill } from './backfill';
import { describeConfig } from './config';
import { hasPendingRun, runPipeline, type RunOutcome } from './pipeline';
import { reparseVersion } from './reparse';
import { setup } from './setup';
import { getSpreadsheet } from './sheets/repo';
import { TABS } from '../shared/schema';

export const MENU_TITLE = '릴리즈 노트';

export function buildMenu(): void {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu(MENU_TITLE)
    // 메뉴 항목의 두 번째 인자는 최상위 함수 이름(main.ts에서 export한 이름)
    .addItem('지금 수집', 'collectNow')
    .addItem('설정 점검', 'checkConfig')
    .addSeparator()
    .addSubMenu(
      ui
        .createMenu('관리')
        .addItem('백필 미리보기(시트 기록 없음)', 'previewBackfillMenu')
        .addItem('백필 실행(전체 메일)…', 'runBackfillMenu')
        .addItem('저장된 버전 재파싱…', 'reparseMenu')
        .addSeparator()
        .addItem('초기 설정(탭·헤더)', 'runSetup'),
    )
    .addToUi();
}

/** 긴 결과는 스크롤되는 대화상자로 보여준다 */
function showReport(title: string, lines: string[]): void {
  const escaped = lines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = HtmlService.createHtmlOutput(
    `<pre style="font:12px/1.5 Consolas,'Malgun Gothic',monospace;white-space:pre-wrap;margin:0">${escaped}</pre>`,
  )
    .setWidth(960)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

function showOutcome(title: string, outcome: RunOutcome): void {
  SpreadsheetApp.getUi().alert(title, outcome.summary.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

export function collectNow(): void {
  showOutcome('지금 수집', runPipeline('수동'));
}

export function runBackfillMenu(): void {
  const ui = SpreadsheetApp.getUi();
  const pending = hasPendingRun() ? '\n\n※ 진행 중인 수집이 있어 그 작업을 이어서 처리합니다.' : '';
  const answer = ui.alert(
    '백필 실행',
    `검색 쿼리에 맞는 전체 메일을 오래된 순으로 처리해 시트에 저장합니다.\n이미 저장된 버전은 건너뜁니다. 시간이 부족하면 1분 뒤 자동으로 이어서 처리합니다.${pending}\n\n먼저 "백필 미리보기"로 결과를 확인하셨나요? 계속할까요?`,
    ui.ButtonSet.YES_NO,
  );
  if (answer !== ui.Button.YES) return;
  showOutcome('백필 실행', runPipeline('백필'));
}

export function previewBackfillMenu(): void {
  const { lines } = previewBackfill();
  for (const line of lines) console.log(line);
  showReport('백필 미리보기 — 시트에 기록하지 않음', lines);
}

export function reparseMenu(): void {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    '저장된 버전 재파싱',
    '다시 읽을 버전을 입력하세요(예: 6.4.1).\n원본 메일을 다시 파싱해 항목을 교체하고 처리 상태를 "번역 대기"로 되돌립니다.\n사람이 고친 항목이 있으면 중단합니다.',
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const result = reparseVersion(res.getResponseText());
  ui.alert(result.ok ? '재파싱 완료' : '재파싱 중단', result.message, ui.ButtonSet.OK);
}

/** 메뉴용: setup() 실행 후 결과를 대화상자로 보여준다 */
export function runSetup(): void {
  const report = setup();
  SpreadsheetApp.getUi().alert('초기 설정 완료', report.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

export function checkConfig(): void {
  const lines = [
    `빌드 시각: ${__BUILD_TIME__}`,
    `스크립트 시간대: ${Session.getScriptTimeZone()}`,
    `실행 계정: ${Session.getEffectiveUser().getEmail()}`,
    `Gmail API: ${gmailStatus()}`,
    `트리거: ${triggerSummary()}`,
    `진행 중인 수집: ${hasPendingRun() ? '있음(이어서 처리 대기)' : '없음'}`,
    `마지막 처리 시점: ${lastProcessed()}`,
    '',
    '[탭]',
    ...tabSummary(),
    '',
    '[Script Properties]',
    ...describeConfig(),
  ];
  SpreadsheetApp.getUi().alert('설정 점검', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** 고급 서비스 연결 확인. 프로필(주소·메일 수)만 읽고 메일 본문은 읽지 않는다. */
function gmailStatus(): string {
  if (typeof Gmail === 'undefined' || !Gmail.Users) return '고급 서비스 꺼짐 (appsscript.json 확인)';
  try {
    const profile = Gmail.Users.getProfile('me');
    return `정상 (${profile.emailAddress})`;
  } catch (e) {
    return `오류 — ${(e as Error).message}`;
  }
}

/** 핸들러별 트리거 개수. 이어서 처리용 일회성 트리거가 쌓이는지 확인하는 용도 */
function triggerSummary(): string {
  const counts = new Map<string, number>();
  for (const t of ScriptApp.getProjectTriggers()) {
    const name = t.getHandlerFunction();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return '없음';
  return [...counts].map(([name, n]) => `${name} ${n}개`).join(', ');
}

function lastProcessed(): string {
  const ms = Number(PropertiesService.getScriptProperties().getProperty('LAST_PROCESSED_AT') ?? 0);
  return ms ? Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : '없음(첫 수집은 전체 메일 대상)';
}

function tabSummary(): string[] {
  const ss = getSpreadsheet();
  return Object.values(TABS).map((name) => {
    const sheet = ss.getSheetByName(name);
    return sheet ? `${name}: 데이터 ${Math.max(sheet.getLastRow() - 1, 0)}행` : `${name}: 없음 — "관리 → 초기 설정" 필요`;
  });
}
