// GAS 진입점. 여기서 export한 함수는 빌드 시 같은 이름의 최상위 함수로 노출된다
// (메뉴·트리거·google.script.run은 최상위 함수만 찾을 수 있음).
import { handleEdit } from './edits';
import {
  buildMenu,
  checkConfig,
  collectNow,
  previewBackfillMenu,
  reparseMenu,
  resetTestDataMenu,
  retranslateSelectedMenu,
  runBackfillMenu,
  runSetup,
  translateTestMenu,
} from './menu';
import { continuePipeline } from './pipeline';
import { setup as setupTabs } from './setup';
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

export {
  checkConfig,
  collectNow,
  doGet,
  getViewerData,
  previewBackfillMenu,
  reparseMenu,
  resetTestDataMenu,
  retranslateSelectedMenu,
  runBackfillMenu,
  runSetup,
  translateTestMenu,
};
