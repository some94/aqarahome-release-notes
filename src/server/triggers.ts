// 트리거 관리.
// - 주간 수집 트리거(scheduledCollect): installTriggers()로 설치, 항상 1개(설치 전에 기존 것을 지움)
// - 이어서 처리용 일회성 트리거(continueRun): 항상 최대 1개 — 걸기 전에도, 실행이 시작될 때도 지운다.
import { getConfig } from './config';

export const WEEKLY_HANDLER = 'scheduledCollect';
export const CONTINUE_HANDLER = 'continueRun';

const WEEKDAY_LABELS: Record<string, string> = {
  MONDAY: '월요일', TUESDAY: '화요일', WEDNESDAY: '수요일', THURSDAY: '목요일', FRIDAY: '금요일', SATURDAY: '토요일', SUNDAY: '일요일',
};

/**
 * 주간 수집 트리거 설치(여러 번 실행해도 1개). 요일·시각은 Script Properties TRIGGER_WEEKDAY·TRIGGER_HOUR(기본 월요일 9시, 스크립트 시간대).
 * Apps Script 시간 트리거는 지정 시각부터 1시간 안의 임의 시점에 실행된다.
 */
export function installTriggers(): string {
  const { triggerWeekday, triggerHour } = getConfig();
  const weekday = ScriptApp.WeekDay[triggerWeekday as keyof typeof ScriptApp.WeekDay];
  if (!weekday || !WEEKDAY_LABELS[triggerWeekday]) throw new Error(`TRIGGER_WEEKDAY 값이 올바르지 않습니다: ${triggerWeekday} (예: MONDAY)`);
  const removed = deleteTriggers(WEEKLY_HANDLER);
  ScriptApp.newTrigger(WEEKLY_HANDLER).timeBased().onWeekDay(weekday).atHour(triggerHour).everyWeeks(1).create();
  return `주간 자동 수집: 매주 ${WEEKDAY_LABELS[triggerWeekday]} ${triggerHour}시대(${Session.getScriptTimeZone()})${removed ? ` — 기존 트리거 ${removed}개 교체` : ''}`;
}
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
