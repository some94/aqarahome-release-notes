// 시트 탭·열 정의와 레코드 변환. GAS API에 의존하지 않는 순수 함수 (SPEC 5번).
// 시트에서는 열 순서가 아니라 헤더 이름으로 값을 찾는다 → 사람이 열 순서를 바꿔도 동작.
import type { ChannelStatus, ParsedVersion } from '../parser/types';
import { SECTION_LABELS } from '../parser/sections';
import { CHANNEL_LABELS } from '../parser/status';

export const TABS = {
  versions: '버전',
  items: '항목',
  glossary: '용어집',
  runs: '실행 로그',
} as const;
export type TabKey = keyof typeof TABS;

export const VERSION_STATUS = {
  pending: '번역 대기',
  ok: '정상',
  review: '검수 필요',
  error: '오류',
} as const;
export type VersionStatus = (typeof VERSION_STATUS)[keyof typeof VERSION_STATUS];

export const SOURCE = {
  lumi: '루미 메일',
  quote: '인용본',
  internal: '사내 번역본',
} as const;

export const COLUMNS = {
  versions: [
    '버전', 'Android/iOS 버전', 'Google Play 버전', '승인일', '메일 수신일',
    'Android 상태', 'iOS 상태', 'Google Play 상태', '처리 상태', '출처',
    '메일 제목', 'Gmail 링크', '항목 수', '경고', '등록 시각', '갱신 시각',
    'Gmail 메시지 ID', '인용 깊이',
  ],
  items: [
    '항목 ID', '버전', '섹션', '순번', '부모 항목 ID', '플랫폼', '관련 기기', '기능 분류 태그',
    '내부용', '한국어', '영어 원문', '수정 여부', '기계 번역', '원문 언어',
  ],
  glossary: ['원어', '한국어 표기', '비고'],
  runs: ['실행 시각', '실행 방식', '확인 메일 수', '신규 버전', '검수 필요 건수', '오류 내용', '소요 시간(초)', '비고'],
} as const satisfies Record<TabKey, readonly string[]>;

/** 사람이 볼 필요 없는 보조 열(숨김) */
export const HIDDEN_COLUMNS: Partial<Record<TabKey, readonly string[]>> = {
  versions: ['Gmail 메시지 ID', '인용 깊이'],
  items: ['기계 번역', '원문 언어'],
};

/** 행이 데이터인지 판단하는 열 — 이 열이 비어 있으면 빈 행으로 본다 */
export const KEY_COLUMN: Record<TabKey, string> = {
  versions: '버전',
  items: '항목 ID',
  glossary: '원어',
  runs: '실행 시각',
};

/** 날짜·시각으로 표시할 열 */
export const DATETIME_COLUMNS: Partial<Record<TabKey, readonly string[]>> = {
  versions: ['등록 시각', '갱신 시각'],
  runs: ['실행 시각'],
};

/** 체크박스로 표시할 열 */
export const CHECKBOX_COLUMNS: Partial<Record<TabKey, readonly string[]>> = {
  items: ['내부용', '수정 여부'],
};

/** 열 너비(px). 없는 열은 시트 기본값 */
export const COLUMN_WIDTHS: Partial<Record<TabKey, Record<string, number>>> = {
  versions: { '메일 제목': 320, '경고': 280, 'Android 상태': 150, 'iOS 상태': 150, 'Google Play 상태': 150 },
  items: { '항목 ID': 190, '한국어': 420, '영어 원문': 420, '관련 기기': 160, '기능 분류 태그': 160 },
  glossary: { '원어': 220, '한국어 표기': 220, '비고': 320 },
  runs: { '실행 시각': 150, '오류 내용': 360, '비고': 280 },
};

/**
 * 용어집 초기값 (SPEC 5번). 제품명·서비스명은 영문 유지, 일반 용어는 한국어 표기.
 * setup()은 용어집 탭이 비어 있을 때만 넣는다 — 이후 수정은 시트에서.
 */
export const GLOSSARY_SEED: readonly [string, string, string][] = [
  ['Aqara Home', 'Aqara Home', '앱 이름 — 영문 유지'],
  ['Magic Switch S1E', 'Magic Switch S1E', '제품명 — 영문 유지'],
  ['Thermostat W200', 'Thermostat W200', '제품명 — 영문 유지'],
  ['Home Guard Plus', 'Home Guard Plus', '서비스명 — 영문 유지'],
  ['Home Guardian', 'Home Guardian', '서비스명 — 영문 유지'],
  ['Security Guardian', 'Security Guardian', '서비스명 — 영문 유지'],
  ['Aqara Copilot', 'Aqara Copilot', '서비스명 — 영문 유지'],
  ['Copilot', 'Copilot', '서비스명 — 영문 유지'],
  ['AI Lab', 'AI Lab', '메뉴명 — 영문 유지'],
  ['Matter', 'Matter', '표준명 — 영문 유지'],
  ['Thread', 'Thread', '표준명 — 영문 유지'],
  ['HomeKit', 'HomeKit', '서비스명 — 영문 유지'],
  ['Apple Home', 'Apple Home', '서비스명 — 영문 유지'],
  ['SmartThings', 'SmartThings', '서비스명 — 영문 유지'],
  ['Google Play', 'Google Play', '스토어명 — 영문 유지'],
  ['App Store', 'App Store', '스토어명 — 영문 유지'],
  ['Automation 2.0', 'Automation 2.0', '기능명 — 영문 유지'],
  ['Hub M3', 'Hub M3', '제품명 — 영문 유지'],
  ['Aqara Spec', 'Aqara Spec', '플랫폼 사양명 — 영문 유지'],
  ['automation', '자동화', ''],
  ['scene', '장면', ''],
  ['dashboard', '대시보드', ''],
  ['hub', '허브', ''],
  ['device', '기기', ''],
  ['firmware', '펌웨어', ''],
  ['soft sensor', '소프트 센서', ''],
  ['push notification', '푸시 알림', ''],
  ['domestic', '중국 내수', '"domestic app stores" 등 — 중국 내수 시장을 뜻함'],
  ['overseas', '해외', ''],
];

export type CellValue = string | number | boolean | Date;
export type SheetRecord = Record<string, CellValue>;

export interface VersionInput {
  parsed: ParsedVersion;
  origin: 'original' | 'quote';
  mailId: string;
  /** 이 블록이 들어 있던 메일의 수신일 */
  mailDate: string;
}

export function gmailLink(messageId: string): string {
  return `https://mail.google.com/mail/#all/${messageId}`;
}

export function formatChannel(status?: ChannelStatus): string {
  if (!status) return '';
  return status.date ? `${status.label} (${status.date})` : status.label;
}

/** 버전 탭 한 행. 처리 상태는 항상 '번역 대기'로 시작한다 (번역은 별도 단계) */
export function versionRecord(input: VersionInput, now: Date): SheetRecord {
  const { parsed, origin, mailId, mailDate } = input;
  return {
    '버전': parsed.version,
    'Android/iOS 버전': parsed.appVersion ?? '',
    'Google Play 버전': parsed.googlePlayVersion ?? '',
    '승인일': parsed.approvalDate ?? '',
    // 인용본이면 인용 헤더의 발송일(그 버전 메일이 실제로 나간 날)
    '메일 수신일': (origin === 'quote' ? parsed.source.date : mailDate)?.slice(0, 10) ?? '',
    'Android 상태': formatChannel(parsed.channels.android),
    'iOS 상태': formatChannel(parsed.channels.ios),
    'Google Play 상태': formatChannel(parsed.channels.googlePlay),
    '처리 상태': VERSION_STATUS.pending,
    '출처': origin === 'original' ? SOURCE.lumi : SOURCE.quote,
    '메일 제목': parsed.source.subject ?? '',
    'Gmail 링크': gmailLink(mailId),
    '항목 수': parsed.items.length,
    '경고': parsed.warnings.join('\n'),
    '등록 시각': now,
    '갱신 시각': now,
    'Gmail 메시지 ID': mailId,
    '인용 깊이': parsed.source.depth,
  };
}

/** 항목 탭 행들. 한국어·관련 기기·태그는 번역 단계에서 채운다 */
export function itemRecords(parsed: ParsedVersion): SheetRecord[] {
  return parsed.items.map((item) => ({
    '항목 ID': item.id,
    '버전': parsed.version,
    '섹션': SECTION_LABELS[item.section],
    '순번': item.seq,
    '부모 항목 ID': item.parentId ?? '',
    '플랫폼': item.platform,
    '관련 기기': '',
    '기능 분류 태그': '',
    '내부용': item.section === 'internal',
    '한국어': '',
    '영어 원문': item.original,
    '수정 여부': false,
    '기계 번역': '',
    '원문 언어': item.lang,
  }));
}

/** 레코드 → 시트 행(헤더 순서대로). 레코드에 없는 열은 빈 칸 */
export function toRow(headers: readonly string[], record: SheetRecord): CellValue[] {
  return headers.map((h) => (h in record ? record[h]! : ''));
}

/** 시트 행 → 레코드 */
export function fromRow(headers: readonly string[], row: readonly unknown[]): SheetRecord {
  const record: SheetRecord = {};
  headers.forEach((h, i) => {
    if (h) record[h] = (row[i] ?? '') as CellValue;
  });
  return record;
}

export function asBool(v: unknown): boolean {
  return v === true || (typeof v === 'string' && ['true', 'y', 'yes', 'o', '1'].includes(v.trim().toLowerCase()));
}

/**
 * 사람이 고친 번역인지 (재번역 시 덮어쓰지 않음, SPEC 5번)
 * - 수정 여부가 체크되어 있거나
 * - 한국어 칸이 비어 있지 않고 기계 번역과 다르면(onEdit이 못 잡은 붙여넣기·스크립트 수정 대비)
 */
export function isEditedItem(record: SheetRecord): boolean {
  if (asBool(record['수정 여부'])) return true;
  const ko = String(record['한국어'] ?? '').trim();
  const machine = String(record['기계 번역'] ?? '').trim();
  return ko !== '' && ko !== machine;
}

/** onEdit에서 한국어 칸을 고쳤을 때 수정 여부 값. 비우거나 기계 번역으로 되돌리면 해제 */
export function editedFlagAfterEdit(ko: unknown, machine: unknown): boolean {
  const k = String(ko ?? '').trim();
  return k !== '' && k !== String(machine ?? '').trim();
}

/** 아무것도 없는 행(빈 칸이거나 체크박스 규칙 때문에 생긴 FALSE뿐) */
export function isBlankRow(row: readonly unknown[]): boolean {
  return row.every((v) => v === '' || v === false || v === null || v === undefined);
}

/**
 * 데이터 행 범위 정리 계획. values는 2행부터의 값(헤더 제외).
 * 체크박스 규칙이 걸린 빈 행은 시트에서 FALSE 값으로 취급되어 getLastRow()를 늘리므로
 * 마지막 데이터 행은 키 열로 판단한다.
 * - lastDataRow: 키 열이 채워진 마지막 행 번호(없으면 1 = 헤더)
 * - deleteRows: 헤더와 마지막 데이터 행 사이의 완전히 빈 행(사람이 뭔가 적은 행은 남김)
 */
export function planRowCleanup(values: readonly (readonly unknown[])[], keyIndex: number): { lastDataRow: number; deleteRows: number[] } {
  let lastDataRow = 1;
  values.forEach((row, i) => {
    if (String(row[keyIndex] ?? '').trim()) lastDataRow = i + 2;
  });
  const deleteRows: number[] = [];
  for (let r = 2; r < lastDataRow; r++) if (isBlankRow(values[r - 2]!)) deleteRows.push(r);
  return { lastDataRow, deleteRows };
}

/** 헤더 행을 스키마에 맞춘다: 비어 있으면 전체, 빠진 열만 뒤에 추가. 기존 열은 지우거나 옮기지 않는다 */
export function planHeaders(existing: readonly string[], required: readonly string[]): { headers: string[]; added: string[] } {
  const current = existing.map((h) => String(h ?? '').trim());
  while (current.length && !current[current.length - 1]) current.pop();
  if (current.length === 0) return { headers: [...required], added: [...required] };
  const added = required.filter((c) => !current.includes(c));
  return { headers: [...current, ...added], added };
}

export { CHANNEL_LABELS };
