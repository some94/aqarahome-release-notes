// 트리거 관리. 이어서 처리용 일회성 트리거는 항상 최대 1개 — 걸기 전에도, 실행이 시작될 때도 지운다.

export const CONTINUE_HANDLER = 'continueRun';
const CONTINUE_DELAY_MS = 60 * 1000;

/** 지정한 핸들러의 트리거를 모두 지우고 지운 개수를 돌려준다 */
export function deleteTriggers(handler: string): number {
  let count = 0;
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  }
  return count;
}

/** 1분 뒤 이어서 처리. 기존 continueRun 트리거는 먼저 지운다(누적 방지) */
export function scheduleContinuation(): void {
  deleteTriggers(CONTINUE_HANDLER);
  ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(CONTINUE_DELAY_MS).create();
}

export function clearContinuation(): number {
  return deleteTriggers(CONTINUE_HANDLER);
}
