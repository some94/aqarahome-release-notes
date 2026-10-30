// 수집 파이프라인 (SPEC 7번): 메일 목록 → 제목 판정 → 본문 파싱 → 원문 저장('번역 대기') → 번역 단계.
// 6분 실행 제한 대비: 메일 1건 단위로 진행 상태를 Script Properties에 저장하고, 시간이 부족하면
// 1분 뒤 일회성 트리거(continueRun)로 이어서 처리한다.
import { checkSubject, extractSubjectVersions, parseReleaseMail, selectVersions } from '../parser';
import { getConfig } from './config';
import { getBody, getMeta, gmailIso, listMessageIds } from './gmail';
import { newVersionsMessage, notifyChat, notifyOwner } from './notify';
import { appendRunLog, saveParsedVersion, storedVersions } from './sheets/repo';
import { ClaudeConfigError } from './translate/claude';
import { emptyProgress, translatePendingVersions, type TranslateProgress } from './translate/phase';
import { emptyCallStats } from './translate/translate';
import { clearContinuation, scheduleContinuation } from './triggers';

export type RunMode = '수동' | '트리거' | '백필';

/** 한 번 실행에 쓸 시간. GAS 제한 6분에서 저장·트리거 생성 여유를 뺀 값 */
const TIME_BUDGET_MS = 4.5 * 60 * 1000;
const STATE_KEY = 'RUN_STATE';
const LAST_PROCESSED_KEY = 'LAST_PROCESSED_AT';
/** 증분 수집 시 Gmail after: 조건에 주는 여유(경계 시각 메일 누락 방지). 실제 필터는 수신 시각으로 다시 한다 */
const QUERY_MARGIN_SEC = 24 * 60 * 60;
/** Script Properties 값 크기 제한(9KB) 대비 목록 길이 상한 */
const MAX_LIST = 40;

interface QueuedMail {
  id: string;
  receivedAt: number;
  subject: string;
  rfc822Id?: string;
}

interface RunState {
  mode: RunMode;
  startedAt: number;
  chunks: number;
  phase: 'collect' | 'translate';
  queue: QueuedMail[];
  next: number;
  /** 아직 처리하지 않은 메일 제목에 있는 버전 — 이 버전의 인용본은 원본 처리 때까지 미룬다 */
  pendingOriginals: string[];
  /** 이번 실행에서 처리한 메일 중 가장 늦은 수신 시각 */
  maxReceivedAt: number;
  /** 오류가 난 메일 중 가장 이른 수신 시각 — 다음 증분 수집이 이 메일부터 다시 보도록 */
  retryFrom?: number;
  stats: {
    listed: number;
    checked: number;
    excluded: string[];
    failures: string[];
    newVersions: string[];
    errors: string[];
  };
  /** 번역 단계 진행 상황(이어서 처리할 때도 유지) */
  translate: TranslateProgress;
}

export interface RunOutcome {
  finished: boolean;
  summary: string[];
}

function props(): GoogleAppsScript.Properties.Properties {
  return PropertiesService.getScriptProperties();
}

function loadState(): RunState | null {
  const raw = props().getProperty(STATE_KEY);
  return raw ? (JSON.parse(raw) as RunState) : null;
}

function saveState(state: RunState): void {
  const capped = (xs: string[]) => (xs.length > MAX_LIST ? [...xs.slice(0, MAX_LIST - 1), `… 외 ${xs.length - MAX_LIST + 1}건`] : xs);
  state.stats.excluded = capped(state.stats.excluded);
  state.stats.failures = capped(state.stats.failures);
  state.stats.errors = capped(state.stats.errors);
  state.translate.errors = capped(state.translate.errors);
  // 응답 시간은 최근 값만(평균·최대 보고용)
  state.translate.stats.elapsedMs = state.translate.stats.elapsedMs.slice(-MAX_LIST);
  props().setProperty(STATE_KEY, JSON.stringify(state));
}

export function clearRunState(): void {
  props().deleteProperty(STATE_KEY);
}

export function hasPendingRun(): boolean {
  return loadState() !== null;
}

const day = (ms: number) => Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'yyyy-MM-dd');

/**
 * 수집 실행. 진행 중인 실행이 있으면 새로 시작하지 않고 이어서 처리한다.
 * - '수동'·'트리거': 마지막 처리 시점 이후 메일만
 * - '백필': 검색 쿼리에 맞는 전체 메일(이미 저장된 버전은 건너뜀)
 */
export function runPipeline(mode: RunMode): RunOutcome {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) return { finished: false, summary: ['다른 수집이 실행 중입니다. 잠시 후 다시 시도하세요.'] };
  const started = Date.now();
  try {
    let state = loadState();
    if (!state) state = startRun(mode);
    state.chunks++;
    return step(state, started + TIME_BUDGET_MS);
  } finally {
    lock.releaseLock();
  }
}

/** continueRun 트리거 핸들러: 가장 먼저 자기 트리거를 지운다(누적 방지) */
export function continuePipeline(): RunOutcome {
  clearContinuation();
  const state = loadState();
  if (!state) return { finished: true, summary: ['이어서 처리할 작업이 없습니다.'] };
  return runPipeline(state.mode);
}

function startRun(mode: RunMode): RunState {
  const config = getConfig();
  const last = Number(props().getProperty(LAST_PROCESSED_KEY) ?? 0);
  const incremental = mode !== '백필' && last > 0;
  const query = incremental ? `(${config.gmailQuery}) after:${Math.floor(last / 1000) - QUERY_MARGIN_SEC}` : config.gmailQuery;

  const ids = listMessageIds(query);
  const queue: QueuedMail[] = [];
  const excluded: string[] = [];
  for (const id of ids) {
    const meta = getMeta(id);
    if (incremental && meta.receivedAt <= last) continue;
    const check = checkSubject(meta.subject, config.subjectKeywords);
    if (!check.ok) {
      // 릴리즈 노트가 아닌 메일: 본문을 열지 않고 제목만 기록
      excluded.push(`${day(meta.receivedAt)} ${meta.subject} (${check.reason})`);
      continue;
    }
    queue.push({ id, receivedAt: meta.receivedAt, subject: meta.subject, rfc822Id: meta.rfc822Id });
  }
  // 오래된 메일부터 (SPEC 9)
  queue.sort((a, b) => a.receivedAt - b.receivedAt);

  return {
    mode,
    startedAt: Date.now(),
    chunks: 0,
    phase: 'collect',
    queue,
    next: 0,
    pendingOriginals: [...new Set(queue.flatMap((m) => extractSubjectVersions(m.subject)))],
    maxReceivedAt: last,
    stats: { listed: ids.length, checked: 0, excluded, failures: [], newVersions: [], errors: [] },
    translate: emptyProgress(emptyCallStats()),
  };
}

function step(state: RunState, deadline: number): RunOutcome {
  if (state.phase === 'collect') {
    const stored = storedVersions();
    while (state.next < state.queue.length) {
      if (Date.now() > deadline) return pause(state);
      collectMail(state, state.queue[state.next]!, stored);
      state.next++;
      saveState(state);
    }
    // 마지막 처리 시점 = 다음 증분 수집의 기준. 오류 난 메일이 있으면 그 직전까지만 → 다음 실행에서 다시 시도
    const mark = state.retryFrom !== undefined ? Math.min(state.maxReceivedAt, state.retryFrom - 1) : state.maxReceivedAt;
    if (mark > 0) props().setProperty(LAST_PROCESSED_KEY, String(mark));
    state.phase = 'translate';
    saveState(state);
  }

  if (state.phase === 'translate') {
    try {
      const done = translatePendingVersions(deadline, state.translate);
      saveState(state);
      if (!done) return pause(state);
    } catch (e) {
      // API 키·모델 설정 문제는 계속 시도해도 소용없다 → 번역은 멈추고 '번역 대기'로 남겨 다음 실행에서 다시 시도
      const prefix = e instanceof ClaudeConfigError ? '번역 중단(설정 확인 필요)' : '번역 중 오류';
      state.translate.errors.push(`${prefix}: ${(e as Error).message}`);
    }
  }
  return finish(state);
}

function collectMail(state: RunState, mail: QueuedMail, stored: Set<string>): void {
  const label = `${day(mail.receivedAt)} ${mail.subject}`;
  const markRetry = () => {
    state.retryFrom = Math.min(state.retryFrom ?? Infinity, mail.receivedAt);
  };
  // 이 메일의 원본 버전은 지금 처리하므로 더 이상 미루지 않는다
  const own = new Set(extractSubjectVersions(mail.subject));
  state.pendingOriginals = state.pendingOriginals.filter((v) => !own.has(v));
  try {
    const body = getBody(mail.id);
    const result = parseReleaseMail({ subject: mail.subject, date: gmailIso(mail.receivedAt), ...body });
    state.stats.checked++;
    for (const f of result.failures) {
      state.stats.failures.push(`${label} — 인용 ${f.depth}단계${f.subject ? ` "${f.subject}"` : ''}: ${f.reason}`);
    }
    const candidates = result.versions.map((parsed) => ({ mailId: mail.id, mailDate: gmailIso(mail.receivedAt), parsed }));
    const selection = selectVersions(candidates, stored, { defer: state.pendingOriginals });
    for (const s of selection.selected) {
      try {
        saveParsedVersion({ ...s, rfc822MessageId: mail.rfc822Id });
        stored.add(s.parsed.version);
        state.stats.newVersions.push(`v${s.parsed.version}${s.origin === 'quote' ? '(인용본)' : ''}`);
      } catch (e) {
        state.stats.errors.push(`v${s.parsed.version} 저장 실패: ${(e as Error).message}`);
        markRetry();
      }
    }
  } catch (e) {
    state.stats.errors.push(`${label}: ${(e as Error).message}`);
    markRetry();
  }
  state.maxReceivedAt = Math.max(state.maxReceivedAt, mail.receivedAt);
}

function pause(state: RunState): RunOutcome {
  saveState(state);
  scheduleContinuation();
  const remaining = state.phase === 'collect' ? `메일 ${state.queue.length - state.next}건 남음` : '번역 진행 중';
  return { finished: false, summary: [`시간 제한으로 일시 중지 — ${remaining}. 1분 뒤 자동으로 이어서 처리합니다.`] };
}

/** 번역 요청 통계 한 줄. 예: "번역 요청 12회, 응답 평균 18.2초·최대 31.0초, 토큰 입력 41,200·출력 38,900" */
export function describeCallStats(t: TranslateProgress): string {
  const ms = t.stats.elapsedMs;
  if (t.stats.calls === 0) return '';
  const avg = ms.reduce((a, b) => a + b, 0) / Math.max(ms.length, 1) / 1000;
  const max = Math.max(...ms) / 1000;
  return `번역 ${t.translatedItems}개 항목, 요청 ${t.stats.calls}회, 응답 평균 ${avg.toFixed(1)}초·최대 ${max.toFixed(1)}초, 토큰 입력 ${t.stats.inputTokens.toLocaleString()}·출력 ${t.stats.outputTokens.toLocaleString()}`;
}

function finish(state: RunState): RunOutcome {
  const s = state.stats;
  const t = state.translate;
  const seconds = Math.round((Date.now() - state.startedAt) / 1000);
  const errors = [...s.errors, ...t.errors, ...s.failures.map((f) => `[추출 실패] ${f}`)];
  appendRunLog({
    '실행 시각': new Date(state.startedAt),
    '실행 방식': state.mode,
    '확인 메일 수': s.checked,
    '신규 버전': s.newVersions.join(', '),
    '검수 필요 건수': t.reviewVersions.length,
    '오류 내용': errors.join('\n'),
    '소요 시간(초)': seconds,
    '비고': [
      `검색 ${s.listed}건, 제목 키워드 제외 ${s.excluded.length}건`,
      describeCallStats(t),
      t.reviewVersions.length ? `검수 필요: ${t.reviewVersions.join(', ')}` : '',
      state.chunks > 1 ? `이어서 처리 ${state.chunks - 1}회` : '',
      ...s.excluded.map((x) => `[제외] ${x}`),
    ]
      .filter(Boolean)
      .join('\n'),
  });
  clearRunState();
  clearContinuation();

  const summary = [
    `확인 메일 ${s.checked}건 (검색 ${s.listed}건, 제목 키워드 제외 ${s.excluded.length}건)`,
    `신규 버전 ${s.newVersions.length}개${s.newVersions.length ? `: ${s.newVersions.join(', ')}` : ''}`,
    describeCallStats(t),
    t.reviewVersions.length ? `검수 필요 ${t.reviewVersions.length}개: ${t.reviewVersions.join(', ')}` : '',
    s.failures.length ? `버전 추출 실패 ${s.failures.length}건` : '',
    errors.length ? `오류·실패 ${errors.length}건 — 실행 로그 탭 확인` : '',
  ].filter(Boolean);

  // 알림 실패가 실행 결과를 덮지 않도록 따로 처리
  try {
    if (errors.length || t.reviewVersions.length) notifyOwner(`확인 필요 — 오류 ${errors.length}건, 검수 필요 ${t.reviewVersions.length}개`, [...summary, '', ...errors.slice(0, 30)]);
    if (s.newVersions.length) notifyChat(newVersionsMessage(s.newVersions, t.reviewVersions));
  } catch (e) {
    summary.push(`알림 전송 실패: ${(e as Error).message}`);
  }
  return { finished: true, summary };
}
