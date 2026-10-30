import { describe, expect, it } from 'vitest';
import { parseReleaseMail } from '../src/parser';
import {
  COLUMNS,
  editedFlagAfterEdit,
  fromRow,
  GLOSSARY_SEED,
  HIDDEN_COLUMNS,
  isBlankRow,
  isEditedItem,
  itemRecords,
  planHeaders,
  planRowCleanup,
  toRow,
  versionRecord,
} from '../src/shared/schema';
import { sample } from './helpers';

const parsed = () =>
  parseReleaseMail({ subject: '【Aqara Home Version Release Notice】v6.4.1-20260904', date: '2026-09-16T02:40:21.000Z', html: sample('nested-9-versions.html') })
    .versions;

describe('버전 행', () => {
  const now = new Date('2026-10-28T08:00:00Z');

  it('원본: 루미 메일, 메일 수신일, 채널 상태 한국어, 처리 상태는 번역 대기', () => {
    const v = parsed()[0]!;
    const rec = versionRecord({ parsed: v, origin: 'original', mailId: 'abc123', mailDate: '2026-09-16T02:40:21.000Z' }, now);
    expect(rec).toMatchObject({
      '버전': '6.4.1',
      '승인일': '2026-09-04',
      '메일 수신일': '2026-09-16',
      'Android 상태': '출시 완료',
      'Google Play 상태': '제출 예정',
      '처리 상태': '번역 대기',
      '출처': '루미 메일',
      'Gmail 링크': 'https://mail.google.com/mail/#all/abc123',
      '항목 수': v.items.length,
      '인용 깊이': 0,
    });
    expect(Object.keys(rec).sort()).toEqual([...COLUMNS.versions].sort());
  });

  it('인용본: 출처 인용본, 메일 수신일은 인용 헤더 날짜, 메일 제목은 인용 헤더 주제, 채널별 버전', () => {
    const v = parsed().find((x) => x.version === '6.3.3')!;
    const rec = versionRecord({ parsed: v, origin: 'quote', mailId: 'abc123', mailDate: '2026-09-16T02:40:21.000Z' }, now);
    expect(rec).toMatchObject({
      '출처': '인용본',
      '메일 수신일': '2026-06-25',
      '메일 제목': 'Aqara Home Version Release Notice v6.3.3-20260619',
      'Android/iOS 버전': '6.3.3',
      'Google Play 버전': '6.3.4',
      'iOS 상태': '심사 제출 (2026-06-19)',
      '인용 깊이': 2,
    });
  });
});

describe('항목 행', () => {
  it('섹션 한국어 이름, 내부용 표시, 영어 원문은 접두어 포함 원문, 번역 칸은 비어 있음', () => {
    const v = parsed().find((x) => x.version === '6.3.3')!;
    const recs = itemRecords(v);
    expect(recs).toHaveLength(v.items.length);
    const internal = recs.find((r) => r['항목 ID'] === 'v6.3.3-int-001-01')!;
    expect(internal).toMatchObject({ '섹션': '기능 상세(내부용)', '내부용': true, '부모 항목 ID': 'v6.3.3-int-001', '순번': 1, '한국어': '', '수정 여부': false });
    const ver = recs.find((r) => r['항목 ID'] === 'v6.3.3-ver-002')!;
    expect(ver).toMatchObject({ '섹션': '버전', '내부용': false, '플랫폼': 'Google Play', '영어 원문': 'Google Play: v6.3.4', '원문 언어': 'en' });
    expect(Object.keys(internal).sort()).toEqual([...COLUMNS.items].sort());
  });
});

describe('행 ↔ 레코드', () => {
  it('헤더 순서가 바뀌어도 이름으로 값을 맞춘다', () => {
    const headers = ['한국어', '항목 ID', '사람이 추가한 열'];
    const row = toRow(headers, { '항목 ID': 'v1-notes-001', '한국어': '번역' });
    expect(row).toEqual(['번역', 'v1-notes-001', '']);
    expect(fromRow(headers, row)).toEqual({ '한국어': '번역', '항목 ID': 'v1-notes-001', '사람이 추가한 열': '' });
  });
});

describe('사람이 고친 번역 판정', () => {
  it.each([
    [{ '수정 여부': true, '한국어': '기계', '기계 번역': '기계' }, true],
    [{ '수정 여부': false, '한국어': '사람이 고침', '기계 번역': '기계' }, true],
    [{ '수정 여부': false, '한국어': '기계', '기계 번역': '기계' }, false],
    [{ '수정 여부': false, '한국어': '', '기계 번역': '기계' }, false],
    [{ '수정 여부': '', '한국어': '번역 전 사람이 직접 입력', '기계 번역': '' }, true],
    [{ '수정 여부': 'TRUE', '한국어': '', '기계 번역': '' }, true],
  ])('%j → %s', (record, expected) => {
    expect(isEditedItem(record)).toBe(expected);
  });

  it('onEdit: 비우거나 기계 번역으로 되돌리면 수정 여부 해제', () => {
    expect(editedFlagAfterEdit('새 번역', '기계')).toBe(true);
    expect(editedFlagAfterEdit('기계', '기계')).toBe(false);
    expect(editedFlagAfterEdit('', '기계')).toBe(false);
    expect(editedFlagAfterEdit('  기계 ', '기계')).toBe(false);
  });
});

describe('헤더 맞추기 (setup idempotent)', () => {
  const required = ['A', 'B', 'C'];
  it('빈 시트는 전체 헤더', () => {
    expect(planHeaders([], required)).toEqual({ headers: ['A', 'B', 'C'], added: ['A', 'B', 'C'] });
  });
  it('이미 맞으면 변경 없음 — 두 번 실행해도 같다', () => {
    const first = planHeaders([], required).headers;
    expect(planHeaders(first, required)).toEqual({ headers: ['A', 'B', 'C'], added: [] });
  });
  it('사람이 순서를 바꾸거나 열을 추가해도 그대로 두고, 빠진 열만 뒤에 붙인다', () => {
    expect(planHeaders(['C', '메모', 'A', ''], required)).toEqual({ headers: ['C', '메모', 'A', 'B'], added: ['B'] });
  });
});

describe('빈 행 정리 계획 (체크박스 규칙으로 데이터가 1001행부터 쌓인 경우 복구)', () => {
  const blank = ['', '', false, '', false];
  it('헤더와 데이터 사이의 완전히 빈 행(FALSE 포함)만 지우고, 마지막 데이터 행은 키 열로 판단한다', () => {
    const values = [blank, blank, ['v1-a', '1.0.0', false, '', false], ['v1-b', '1.0.0', true, '', false], blank, blank];
    expect(planRowCleanup(values, 0)).toEqual({ lastDataRow: 5, deleteRows: [2, 3] });
  });
  it('사람이 뭔가 적은 행은 키가 없어도 남긴다', () => {
    const values = [['', '', false, '메모', false], ['v1-a', '1.0.0', false, '', false]];
    expect(planRowCleanup(values, 0)).toEqual({ lastDataRow: 3, deleteRows: [] });
  });
  it('데이터가 없으면 지울 것도 없다', () => {
    expect(planRowCleanup([blank, blank], 0)).toEqual({ lastDataRow: 1, deleteRows: [] });
  });
  it('isBlankRow', () => {
    expect(isBlankRow(blank)).toBe(true);
    expect(isBlankRow(['', true])).toBe(false);
    expect(isBlankRow(['', 0])).toBe(false);
  });
});

describe('스키마 정의', () => {
  it('숨김 열은 실제 열 안에 있다', () => {
    for (const [tab, hidden] of Object.entries(HIDDEN_COLUMNS)) {
      for (const h of hidden!) expect(COLUMNS[tab as keyof typeof COLUMNS]).toContain(h);
    }
  });
  it('용어집 초기값은 원어가 겹치지 않는다', () => {
    const terms = GLOSSARY_SEED.map(([t]) => t.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });
});
