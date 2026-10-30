// 웹 뷰어로 보내는 데이터 형식과 변환 (SPEC 8번). 서버·브라우저 공용, GAS·DOM API에 의존하지 않는다.
// 전체 데이터를 한 번에 보내고 검색·필터는 브라우저에서 한다(실측 약 220KB).
import { SECTION_LABELS } from '../parser/sections';
import type { SheetRecord } from './schema';

export interface ViewerVersion {
  version: string;
  appVersion: string;
  googlePlayVersion: string;
  approvalDate: string;
  receivedDate: string;
  android: string;
  ios: string;
  googlePlay: string;
  status: string;
  source: string;
  subject: string;
  gmailLink: string;
  itemCount: number;
  warnings: string;
}

/** 항목은 크기를 줄이려고 배열로 보낸다. 순서는 ITEM_FIELDS */
export const ITEM_FIELDS = ['id', 'version', 'section', 'seq', 'parentId', 'platform', 'devices', 'tags', 'internal', 'ko', 'en'] as const;
export type ViewerItemRow = [string, string, string, number, string, string, string, string, boolean, string, string];

export interface ViewerItem {
  id: string;
  version: string;
  section: string;
  seq: number;
  parentId: string;
  platform: string;
  devices: string[];
  tags: string[];
  internal: boolean;
  ko: string;
  en: string;
}

export interface ViewerData {
  versions: ViewerVersion[];
  items: ViewerItemRow[];
  /** 'YYYY-MM-DD HH:mm' (스크립트 시간대) */
  generatedAt: string;
  /** 서버에서 데이터를 만드는 데 걸린 시간(ms) — 응답 시간 측정용 */
  serverMs: number;
}

/** 상세 화면 섹션 순서 (SPEC 8번 + 버전 섹션) */
export const VIEWER_SECTION_ORDER: string[] = [
  SECTION_LABELS.overview,
  SECTION_LABELS.notes,
  SECTION_LABELS.internal,
  SECTION_LABELS.fixes,
  SECTION_LABELS.schedule,
  SECTION_LABELS.version,
  SECTION_LABELS.other,
];

/** 시트 셀 → 문자열. Date는 호출 쪽이 시간대에 맞게 포맷(google.script.run은 Date를 돌려줄 수 없음) */
function text(value: unknown, formatDate: (d: Date) => string): string {
  if (value instanceof Date) return formatDate(value);
  return value === null || value === undefined ? '' : String(value).trim();
}

export function toViewerVersion(r: SheetRecord, formatDate: (d: Date) => string): ViewerVersion {
  const t = (k: string) => text(r[k], formatDate);
  return {
    version: t('버전'),
    appVersion: t('Android/iOS 버전'),
    googlePlayVersion: t('Google Play 버전'),
    approvalDate: t('승인일'),
    receivedDate: t('메일 수신일'),
    android: t('Android 상태'),
    ios: t('iOS 상태'),
    googlePlay: t('Google Play 상태'),
    status: t('처리 상태'),
    source: t('출처'),
    subject: t('메일 제목'),
    gmailLink: t('Gmail 링크'),
    itemCount: Number(r['항목 수']) || 0,
    warnings: t('경고'),
  };
}

export function toViewerItemRow(r: SheetRecord, formatDate: (d: Date) => string): ViewerItemRow {
  const t = (k: string) => text(r[k], formatDate);
  return [
    t('항목 ID'),
    t('버전'),
    t('섹션'),
    Number(r['순번']) || 0,
    t('부모 항목 ID'),
    t('플랫폼') || '공통',
    t('관련 기기'),
    t('기능 분류 태그'),
    r['내부용'] === true || t('내부용').toUpperCase() === 'TRUE',
    t('한국어'),
    t('영어 원문'),
  ];
}

export function fromItemRow(row: ViewerItemRow): ViewerItem {
  const list = (s: string) => s.split(/\s*,\s*/).filter(Boolean);
  return {
    id: row[0],
    version: row[1],
    section: row[2],
    seq: row[3],
    parentId: row[4],
    platform: row[5],
    devices: list(row[6]),
    tags: list(row[7]),
    internal: row[8],
    ko: row[9],
    en: row[10],
  };
}

export function compareVersionDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// ---------- 검색·필터 (브라우저에서 사용) ----------

export interface Filters {
  query: string;
  platform: string;
  section: string;
  device: string;
  internalOnly: boolean;
  /** 'YYYY-MM-DD' (승인일 기준, 포함) */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: Filters = { query: '', platform: '', section: '', device: '', internalOnly: false, from: '', to: '' };

export function hasActiveFilters(f: Filters): boolean {
  return !!(f.query.trim() || f.platform || f.section || f.device || f.internalOnly || f.from || f.to);
}

/** 대소문자·공백 무시 비교용 */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 검색어: 공백으로 나눈 단어가 모두(AND) 한국어·영어 원문·기기명·태그·플랫폼 어딘가에 있어야 함 */
export function matchesQuery(item: ViewerItem, query: string): boolean {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize([item.ko, item.en, item.devices.join(' '), item.tags.join(' '), item.platform, item.version].join(' \n '));
  return words.every((w) => haystack.includes(w));
}

/**
 * 플랫폼 필터는 3가지만: 전체(AOS+iOS) / AOS / iOS.
 * AOS·iOS를 고르면 그 OS로 표시된 항목만 보여준다('공통' 항목은 '전체'에서 확인 — 사용자 결정 2026-10-30).
 */
export const PLATFORM_FILTERS = [
  { value: '', label: '전체(AOS+iOS)' },
  { value: 'aos', label: 'AOS' },
  { value: 'ios', label: 'iOS' },
] as const;

/** 필터 값별로 해당하는 항목 플랫폼 (Google Play·HarmonyOS는 Android 앱, Mac은 iOS 앱) */
const PLATFORM_GROUPS: Record<string, string[]> = {
  aos: ['Android', 'Google Play', 'HarmonyOS'],
  ios: ['iOS', 'Mac'],
};

export function matchesPlatform(item: ViewerItem, platform: string): boolean {
  const group = PLATFORM_GROUPS[platform];
  if (!group) return true;
  return item.platform.split(/\s*,\s*/).some((p) => group.includes(p));
}

export function matchesFilters(item: ViewerItem, version: ViewerVersion | undefined, f: Filters): boolean {
  if (f.internalOnly && !item.internal) return false;
  if (f.section && item.section !== f.section) return false;
  if (f.device && !item.devices.includes(f.device)) return false;
  if (!matchesPlatform(item, f.platform)) return false;
  const date = version?.approvalDate || version?.receivedDate || '';
  if (f.from && (!date || date < f.from)) return false;
  if (f.to && (!date || date > f.to)) return false;
  return matchesQuery(item, f.query);
}
