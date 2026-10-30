// 4단계: Gmail payload 파트 찾기, 증분 처리 시 인용본 미루기, 백필 미리보기 보고서
import { describe, expect, it } from 'vitest';
import { parseReleaseMail, selectVersions } from '../src/parser';
import type { VersionCandidate } from '../src/parser';
import { charsetOf, findBodyParts, type PayloadPart } from '../src/shared/gmail-payload';
import { buildPreviewReport, type PreviewEntry } from '../src/shared/preview';
import { sample } from './helpers';

describe('Gmail payload 본문 파트', () => {
  const payload: PayloadPart = {
    mimeType: 'multipart/mixed',
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="GBK"' }], body: { data: 'cGxhaW4' } },
          { mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }], body: { data: [60, 112, 62] } },
        ],
      },
      { mimeType: 'text/html', filename: 'attached.html', body: { attachmentId: 'att-1' } },
    ],
  };

  it('첨부가 아닌 첫 text/html·text/plain을 찾는다', () => {
    const { html, text } = findBodyParts(payload);
    expect(html?.body?.data).toEqual([60, 112, 62]);
    expect(text?.body?.data).toBe('cGxhaW4');
  });

  it('charset을 읽고 없으면 utf-8', () => {
    const { html, text } = findBodyParts(payload);
    expect(charsetOf(text!)).toBe('gbk');
    expect(charsetOf(html!)).toBe('utf-8');
    expect(charsetOf({ mimeType: 'text/plain' })).toBe('utf-8');
  });

  it('첨부만 있으면 본문 없음', () => {
    expect(findBodyParts({ mimeType: 'text/html', headers: [{ name: 'Content-Disposition', value: 'attachment; filename=a.html' }] })).toEqual({});
  });
});

describe('메일을 하나씩 처리할 때 원본 우선 (인용본 미루기)', () => {
  const nested = () =>
    parseReleaseMail({ subject: '【Aqara Home Version Release Notice】v6.4.1-20260904', html: sample('nested-9-versions.html') }).versions.map(
      (parsed): VersionCandidate => ({ mailId: 'mail-641', mailDate: '2026-09-16T00:00:00Z', parsed }),
    );

  it('원본 메일이 큐에 남은 버전은 인용본을 저장하지 않고 미룬다', () => {
    const { selected, deferred } = selectVersions(nested(), [], { defer: ['6.1.3', '6.3.3'] });
    expect(deferred).toEqual(['6.1.3', '6.3.3']);
    expect(selected.map((s) => s.parsed.version)).not.toContain('6.1.3');
    expect(selected.find((s) => s.parsed.version === '6.4.1')?.origin).toBe('original');
  });

  it('미루기 대상이어도 원본 블록이면 그대로 저장한다', () => {
    const { selected, deferred } = selectVersions(nested(), [], { defer: ['6.4.1'] });
    expect(deferred).toEqual([]);
    expect(selected.find((s) => s.parsed.version === '6.4.1')?.origin).toBe('original');
  });
});

describe('백필 미리보기 보고서', () => {
  const entries = (): PreviewEntry[] => [
    {
      mail: { id: 'm1', subject: '【Aqara Home Version Release Notice】v6.4.1-20260904', date: '2026-09-16T02:40:21Z' },
      result: parseReleaseMail({ subject: '【Aqara Home Version Release Notice】v6.4.1-20260904', html: sample('nested-9-versions.html') }),
    },
    {
      mail: { id: 'm2', subject: '回复：Clarification on Recent Changes', date: '2025-08-08T00:00:00Z' },
      excluded: '회신 메일',
    },
    {
      mail: { id: 'm3', subject: 'Release Notice without version', date: '2026-01-02T00:00:00Z' },
      result: parseReleaseMail({ subject: 'Release Notice without version', html: '<p>1.3 Update Notes:</p><ul><li>Something.</li></ul>' }),
    },
  ];

  it('메일별 추출 버전과 섹션 분류, 요약을 만든다', () => {
    const report = buildPreviewReport(entries(), { stored: ['6.4.1'] }).join('\n');
    expect(report).toContain('- v6.3.3   인용2(A)');
    expect(report).toContain('채널 버전: Android/iOS 6.3.3 / Google Play 6.3.4');
    expect(report).toContain('기타로 분류: 1.6 Known Limitations:');
    expect(report).toContain('새로 저장될 버전 8개');
    expect(report).toContain('이미 저장되어 건너뛸 버전 1개: v6.4.1');
  });

  it('제목 키워드로 제외된 메일과 버전 추출 실패 메일 목록을 따로 보여준다', () => {
    const report = buildPreviewReport(entries());
    const at = report.indexOf('발신자는 맞지만 제목 키워드로 제외된 메일 1건:');
    expect(at).toBeGreaterThan(0);
    expect(report[at + 1]).toBe('  - 2025-08-08 回复：Clarification on Recent Changes (회신 메일)');
    const failAt = report.indexOf('버전 추출 실패 1건:');
    expect(report[failAt + 1]).toBe('  - 2026-01-02 Release Notice without version — 인용 0단계 Release Notice without version: 버전 번호를 찾지 못함');
  });
});
