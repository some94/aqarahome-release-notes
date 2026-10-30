import { previewBackfill } from './backfill';
import { describeConfig } from './config';
import { describeCallStats, hasPendingRun, runPipeline, type RunOutcome } from './pipeline';
import { reparseVersion } from './reparse';
import { resetTestData } from './reset';
import { installTriggers } from './triggers';
import { rebuildGmailLinks } from './links';
import { newVersionsMessage, notifyChat } from './notify';
import { compareVersions } from '../parser/version';
import { setup } from './setup';
import { getSpreadsheet, readTable } from './sheets/repo';
import { emptyProgress, retranslateItems, translateVersion } from './translate/phase';
import { emptyCallStats } from './translate/translate';
import { isEditedItem, TABS } from '../shared/schema';

/** 메뉴에서 직접 번역할 때 한 번에 쓸 시간(이어서 처리 없음) */
const MENU_BUDGET_MS = 5 * 60 * 1000;
/** 선택 항목 재번역 한 번에 처리할 최대 항목 수 */
const MAX_RETRANSLATE = 100;

export const MENU_TITLE = '릴리즈 노트';

export function buildMenu(): void {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu(MENU_TITLE)
    // 메뉴 항목의 두 번째 인자는 최상위 함수 이름(main.ts에서 export한 이름)
    .addItem('지금 수집', 'collectNow')
    .addItem('선택 항목 재번역', 'retranslateSelectedMenu')
    .addItem('설정 점검', 'checkConfig')
    .addSeparator()
    .addSubMenu(
      ui
        .createMenu('관리')
        .addItem('번역 테스트(버전 1개)…', 'translateTestMenu')
        .addSeparator()
        .addItem('백필 미리보기(시트 기록 없음)', 'previewBackfillMenu')
        .addItem('백필 실행(전체 메일)…', 'runBackfillMenu')
        .addItem('저장된 버전 재파싱…', 'reparseMenu')
        .addItem('Gmail 링크 다시 만들기', 'rebuildGmailLinksMenu')
        .addItem('챗 알림 테스트', 'chatTestMenu')
        .addSeparator()
        .addItem('초기 설정(탭·헤더)', 'runSetup')
        .addItem('주간 자동 수집 설치·갱신', 'installTriggersMenu')
        .addItem('테스트 데이터 초기화…', 'resetTestDataMenu'),
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

function withLock<T>(fn: () => T): T | null {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) {
    SpreadsheetApp.getUi().alert('다른 수집·번역이 실행 중입니다. 잠시 후 다시 시도하세요.');
    return null;
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** 첫 번역 테스트·응답 시간 측정용: 버전 하나만 번역하고 요청별 시간을 보여준다 */
export function translateTestMenu(): void {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    '번역 테스트(버전 1개)',
    '번역할 버전을 입력하세요(예: 6.4.1).\n아직 번역되지 않은 항목만 번역하고, 끝나면 처리 상태를 "정상" 또는 "검수 필요"로 바꿉니다.\n요청별 응답 시간을 측정해서 보여줍니다.',
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const version = res.getResponseText().trim().replace(/^v/i, '');
  if (!readTable('versions').rows.some((r) => String(r.record['버전']).trim() === version)) {
    ui.alert(`v${version}은 시트에 없습니다.`);
    return;
  }
  const progress = emptyProgress(emptyCallStats());
  const outcome = withLock(() => translateVersion(version, Date.now() + MENU_BUDGET_MS, progress));
  if (outcome === null) return;
  const lines = [
    outcome === 'paused' ? '⚠ 시간 제한으로 일부만 번역했습니다. 같은 메뉴를 다시 실행하면 이어서 번역합니다.' : `v${version} 번역 완료`,
    describeCallStats(progress) || '번역할 항목이 없습니다(이미 번역됐거나 사람이 고친 항목만 있음).',
    `요청별 응답 시간(초): ${progress.stats.elapsedMs.map((ms) => (ms / 1000).toFixed(1)).join(', ') || '-'}`,
    progress.reviewVersions.length ? '검수 필요로 표시됨 — 버전 탭 경고 열 확인' : '',
    ...progress.errors.slice(0, 20),
  ].filter(Boolean);
  for (const line of lines) console.log(line);
  showReport('번역 테스트 결과', lines);
}

/** 항목 탭에서 선택한 행을 다시 번역 (SPEC 7번 메뉴) */
export function retranslateSelectedMenu(): void {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== TABS.items) {
    ui.alert(`"${TABS.items}" 탭에서 다시 번역할 행을 선택한 뒤 실행하세요.`);
    return;
  }
  const selectedRows = new Set<number>();
  for (const range of sheet.getActiveRangeList()?.getRanges() ?? []) {
    for (let r = Math.max(range.getRow(), 2); r <= range.getLastRow(); r++) selectedRows.add(r);
  }
  const rows = readTable('items').rows.filter((r) => selectedRows.has(r.rowNumber));
  if (rows.length === 0) {
    ui.alert('선택한 행에 항목이 없습니다.');
    return;
  }
  if (rows.length > MAX_RETRANSLATE) {
    ui.alert(`한 번에 ${MAX_RETRANSLATE}개까지 재번역할 수 있습니다(선택 ${rows.length}개). 나눠서 실행하세요.`);
    return;
  }
  const edited = rows.filter((r) => isEditedItem(r.record)).map((r) => String(r.record['항목 ID']));
  let overwrite = new Set<string>();
  let ids = rows.map((r) => String(r.record['항목 ID']));
  if (edited.length) {
    const answer = ui.alert(
      '사람이 고친 번역 포함',
      `선택한 ${rows.length}개 중 ${edited.length}개는 사람이 고친 번역입니다.\n\n예: 고친 번역도 덮어쓰기\n아니오: 고친 항목은 건너뛰고 나머지만 재번역\n취소: 중단`,
      ui.ButtonSet.YES_NO_CANCEL,
    );
    if (answer === ui.Button.CANCEL || answer === ui.Button.CLOSE) return;
    if (answer === ui.Button.YES) overwrite = new Set(edited);
    else ids = ids.filter((id) => !edited.includes(id));
  }
  const progress = emptyProgress(emptyCallStats());
  const result = withLock(() => retranslateItems(ids, overwrite, Date.now() + MENU_BUDGET_MS, progress));
  if (result === null) return;
  const lines = [
    `재번역 ${result.done}개 완료${result.remaining ? `, ${result.remaining}개 남음(실패 또는 시간 부족)` : ''}`,
    describeCallStats(progress),
    ...progress.errors.slice(0, 20),
    '버전의 처리 상태는 바뀌지 않습니다. 검수가 끝났으면 버전 탭에서 "정상"으로 바꿔 주세요.',
  ].filter(Boolean);
  showReport('선택 항목 재번역', lines);
}

export function resetTestDataMenu(): void {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    '테스트 데이터 초기화',
    '버전·항목·실행 로그 탭의 데이터를 모두 지우고 진행 상태·마지막 처리 시점을 초기화합니다.\n' +
      '용어집과 설정값(API 키 등)은 유지합니다. 지우기 전에 4개 탭을 새 스프레드시트로 백업합니다.\n\n' +
      '계속하려면 아래에 "초기화"를 입력하세요.',
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  if (res.getResponseText().trim() !== '초기화') {
    ui.alert('입력이 "초기화"와 달라 중단했습니다. 아무것도 지우지 않았습니다.');
    return;
  }
  const result = withLock(() => resetTestData());
  if (result === null) return;
  const lines = ['초기화 완료', ...result.cleared, '', `백업: ${result.backupUrl}`];
  for (const line of lines) console.log(line);
  showReport('테스트 데이터 초기화', lines);
}

export function rebuildGmailLinksMenu(): void {
  const result = withLock(() => rebuildGmailLinks());
  if (result === null) return;
  const lines = [
    `Gmail 링크 ${result.updated}개 갱신(메일을 받은 계정이면 누구나 열리는 검색 링크)`,
    ...result.failed.map((f) => `실패: ${f}`),
  ];
  SpreadsheetApp.getUi().alert('Gmail 링크 다시 만들기', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** 챗 웹훅 연결 확인: 가장 최근 버전으로 실제 알림과 같은 형식의 테스트 메시지를 보낸다 */
export function chatTestMenu(): void {
  const ui = SpreadsheetApp.getUi();
  const latest = readTable('versions').rows.map((r) => String(r.record['버전']).trim()).sort((a, b) => compareVersions(b, a))[0];
  try {
    const sent = notifyChat(`[테스트] 알림 연결 확인\n${newVersionsMessage(latest ? [`v${latest}`] : [], [])}`);
    ui.alert('챗 알림 테스트', sent ? '테스트 메시지를 보냈습니다. 챗 스페이스를 확인하세요.' : 'Script Properties에 CHAT_WEBHOOK_URL이 없습니다.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('챗 알림 테스트 실패', (e as Error).message, ui.ButtonSet.OK);
  }
}

export function installTriggersMenu(): void {
  const message = installTriggers();
  SpreadsheetApp.getUi().alert('주간 자동 수집 설치', `${message}\n\n설정 점검에서 트리거가 scheduledCollect 1개인지 확인하세요.`, SpreadsheetApp.getUi().ButtonSet.OK);
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
