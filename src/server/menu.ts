export const MENU_TITLE = '릴리즈 노트';

export function buildMenu(): void {
  SpreadsheetApp.getUi()
    .createMenu(MENU_TITLE)
    // 메뉴 항목의 두 번째 인자는 최상위 함수 이름(main.ts에서 export한 이름)
    .addItem('설정 점검', 'checkConfig')
    .addToUi();
}

export function checkConfig(): void {
  const lines = [
    `빌드 시각: ${__BUILD_TIME__}`,
    `스크립트 시간대: ${Session.getScriptTimeZone()}`,
    `실행 계정: ${Session.getEffectiveUser().getEmail()}`,
    `Gmail API: ${gmailStatus()}`,
    `트리거: ${triggerSummary()}`,
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
