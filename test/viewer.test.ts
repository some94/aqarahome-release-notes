// 7단계: 웹 뷰어 데이터 변환·검색·필터 (SPEC 8번)
import { describe, expect, it } from 'vitest';
import {
  compareVersionDesc,
  EMPTY_FILTERS,
  fromItemRow,
  hasActiveFilters,
  matchesFilters,
  matchesPlatform,
  matchesQuery,
  toViewerItemRow,
  toViewerVersion,
  VIEWER_SECTION_ORDER,
  type ViewerItem,
  type ViewerVersion,
} from '../src/shared/viewer';

const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('시트 행 → 뷰어 데이터', () => {
  it('날짜 셀(Date)은 문자열로 바꾼다 — google.script.run은 Date를 돌려줄 수 없음', () => {
    const v = toViewerVersion({ '버전': '6.4.1', '승인일': new Date(2026, 8, 4), '메일 수신일': '2026-09-16', '항목 수': 11, '처리 상태': '정상' }, fmt);
    expect(v).toMatchObject({ version: '6.4.1', approvalDate: '2026-09-04', receivedDate: '2026-09-16', itemCount: 11, status: '정상', android: '' });
    expect(JSON.stringify(v)).not.toMatch(/T\d\d:/);
  });

  it('항목은 배열로 보내고 브라우저에서 되살린다(기기·태그는 목록)', () => {
    const row = toViewerItemRow(
      { '항목 ID': 'v6.3.6-fix-001', '버전': '6.3.6', '섹션': '온라인 이슈 수정', '순번': 1, '부모 항목 ID': '', '플랫폼': 'Android', '관련 기기': 'Thermostat W200', '기능 분류 태그': '온도조절, 안정성', '내부용': false, '한국어': '수정했습니다.', '영어 원문': 'Android: Fixed.' },
      fmt,
    );
    expect(fromItemRow(row)).toEqual({
      id: 'v6.3.6-fix-001', version: '6.3.6', section: '온라인 이슈 수정', seq: 1, parentId: '', platform: 'Android',
      devices: ['Thermostat W200'], tags: ['온도조절', '안정성'], internal: false, ko: '수정했습니다.', en: 'Android: Fixed.',
    });
  });

  it('플랫폼이 비면 공통, 내부용은 문자열 TRUE도 인정', () => {
    const row = toViewerItemRow({ '항목 ID': 'x', '플랫폼': '', '내부용': 'TRUE' }, fmt);
    expect(row[5]).toBe('공통');
    expect(row[8]).toBe(true);
  });

  it('버전 최신순 정렬(문자열 정렬이 아닌 숫자 정렬)', () => {
    expect(['6.1.10', '6.4.1', '6.1.9', '5.3.1'].sort(compareVersionDesc)).toEqual(['6.4.1', '6.1.10', '6.1.9', '5.3.1']);
  });

  it('상세 화면 섹션 순서는 SPEC 8번 순서 + 버전', () => {
    expect(VIEWER_SECTION_ORDER).toEqual(['개요', '공개 릴리즈 노트', '기능 상세(내부용)', '온라인 이슈 수정', '출시 일정·채널', '버전', '기타']);
  });
});

describe('검색·필터', () => {
  const item = (over: Partial<ViewerItem>): ViewerItem => ({
    id: 'v1-fix-001', version: '6.3.6', section: '온라인 이슈 수정', seq: 1, parentId: '', platform: '공통',
    devices: [], tags: [], internal: false, ko: '', en: '', ...over,
  });
  const version = (approvalDate: string) => ({ version: '6.3.6', approvalDate, receivedDate: '' }) as ViewerVersion;

  it('한국어·영어 원문·기기명·태그 어디서든 찾고, 대소문자 무시', () => {
    const it1 = item({ ko: 'LAN 환경에서 온도 표시 오류 수정', en: 'Fixed temperature display', devices: ['Thermostat W200'], tags: ['온도조절'] });
    expect(matchesQuery(it1, 'w200')).toBe(true);
    expect(matchesQuery(it1, '온도조절')).toBe(true);
    expect(matchesQuery(it1, 'TEMPERATURE')).toBe(true);
    expect(matchesQuery(it1, '카메라')).toBe(false);
  });

  it('여러 단어는 모두 포함해야 함(AND)', () => {
    const it1 = item({ ko: '카메라 NAS 로그인 문제 수정', platform: 'iOS' });
    expect(matchesQuery(it1, '카메라 NAS')).toBe(true);
    expect(matchesQuery(it1, '카메라 Matter')).toBe(false);
    expect(matchesQuery(it1, '카메라 ios')).toBe(true);
  });

  it('플랫폼을 고르면 공통 항목도 함께(공통은 모든 플랫폼에 해당)', () => {
    expect(matchesPlatform(item({ platform: 'iOS' }), 'iOS')).toBe(true);
    expect(matchesPlatform(item({ platform: '공통' }), 'iOS')).toBe(true);
    expect(matchesPlatform(item({ platform: 'Android' }), 'iOS')).toBe(false);
    expect(matchesPlatform(item({ platform: 'Android, iOS' }), 'iOS')).toBe(true);
    expect(matchesPlatform(item({ platform: 'iOS' }), '공통')).toBe(false);
  });

  it('내부용만·섹션·기기·기간(승인일, 양끝 포함)', () => {
    const it1 = item({ internal: true, section: '기능 상세(내부용)', devices: ['Hub M3'] });
    const f = { ...EMPTY_FILTERS };
    expect(matchesFilters(it1, version('2026-04-17'), { ...f, internalOnly: true })).toBe(true);
    expect(matchesFilters(item({}), version('2026-04-17'), { ...f, internalOnly: true })).toBe(false);
    expect(matchesFilters(it1, version('2026-04-17'), { ...f, section: '온라인 이슈 수정' })).toBe(false);
    expect(matchesFilters(it1, version('2026-04-17'), { ...f, device: 'Hub M3' })).toBe(true);
    expect(matchesFilters(it1, version('2026-04-17'), { ...f, from: '2026-04-17', to: '2026-04-17' })).toBe(true);
    expect(matchesFilters(it1, version('2026-04-17'), { ...f, from: '2026-05-01' })).toBe(false);
  });

  it('필터 사용 여부', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: '  ' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, internalOnly: true })).toBe(true);
  });
});
