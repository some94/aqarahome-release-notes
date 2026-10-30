// GAS 진입점. 여기서 export한 함수는 빌드 시 같은 이름의 최상위 함수로 노출된다
// (메뉴·트리거·google.script.run은 최상위 함수만 찾을 수 있음).
import { handleEdit } from './edits';
import {
  buildMenu,
  checkConfig,
  collectNow,
  installTriggersMenu,
  previewBackfillMenu,
  rebuildGmailLinksMenu,
  chatTestMenu,
  reparseMenu,
  resetTestDataMenu,
  retranslateSelectedMenu,
  runBackfillMenu,
  runSetup,
  translateTestMenu,
} from './menu';
import { continuePipeline, runPipeline } from './pipeline';
import { setup as setupTabs } from './setup';
import { installTriggers as installWeekly } from './triggers';
import { doGet, getViewerData } from './webapp';

export function onOpen(): void {
  buildMenu();
}

/** simple 트리거: 항목 탭 한국어 수정 → 수정 여부 표시 */
export function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  handleEdit(e);
}

/** 탭·헤더 생성(트리거는 만들지 않음). 스크립트 편집기에서 실행하면 결과가 실행 로그에 남는다 */
export function setup(): void {
  for (const line of setupTabs()) console.log(line);
}

/** 이어서 처리용 일회성 트리거 핸들러 — 시작하자마자 자기 트리거를 지운다 */
export function continueRun(): void {
  for (const line of continuePipeline().summary) console.log(line);
}

/** 주간 자동 수집 트리거 핸들러 */
export function scheduledCollect(): void {
  for (const line of runPipeline('트리거').summary) console.log(line);
}

/** 주간 트리거 설치(스크립트 편집기에서도 실행 가능). setup()과 분리 — SPEC/PLAN */
export function installTriggers(): void {
  console.log(installWeekly());
}

export {
  chatTestMenu,
  checkConfig,
  rebuildGmailLinksMenu,
  collectNow,
  doGet,
  getViewerData,
  installTriggersMenu,
  previewBackfillMenu,
  reparseMenu,
  resetTestDataMenu,
  retranslateSelectedMenu,
  runBackfillMenu,
  runSetup,
  translateTestMenu,
};
