// SPEC 10번 필수 테스트 + 실제 메일에서 찾은 형식 변형. 공유 가능한 가공 샘플(fixtures/sample) 기준.
import { describe, expect, it } from 'vitest';
import { parseReleaseMail, selectVersions, checkSubject, extractSubjectVersions } from '../src/parser';
import type { ParsedVersion, VersionCandidate } from '../src/parser';
import { classifySectionTitle } from '../src/parser/sections';
import { splitHtmlMail, splitPlainMail } from '../src/parser/quote-split';
import { splitPlatform } from '../src/parser/items';
import { sample } from './helpers';

const NESTED_SUBJECT = '【Aqara Home Version Release Notice】v6.4.1-20260904';
const nested = () => parseReleaseMail({ subject: NESTED_SUBJECT, date: '2026-09-16T02:40:21Z', html: sample('nested-9-versions.html') });
const legacy = () => parseReleaseMail({ subject: '[APP Version Release Notice] V6.0.3-20251017', date: '2025-10-20T02:50:16Z', html: sample('v6.0.3-legacy.html') });
const byVersion = (versions: ParsedVersion[], v: string) => {
  const found = versions.find((x) => x.version === v);
  if (!found) throw new Error(`v${v} 없음: ${versions.map((x) => x.version).join(', ')}`);
  return found;
};
const texts = (v: ParsedVersion, section: string) => v.items.filter((i) => i.section === section).map((i) => i.original);

describe('인용 구분자 2종 분리', () => {
  it('HTML: 형식 A(대시 + 日　期：)와 형식 B(原始邮件 + 发送时间:)의 헤더를 모두 읽는다', () => {
    const blocks = splitHtmlMail(sample('nested-9-versions.html'));
    const quoted = blocks.filter((b) => b.depth > 0 && b.header);
    expect(quoted.map((b) => b.header!.format)).toEqual(['A', 'A', 'A', 'A', 'A', 'B', 'B', 'A']);
    const b = quoted.find((q) => q.header!.format === 'B')!;
    expect(b.header).toMatchObject({ date: '2026-04-07 14:22:12', subject: 'APP Version Release Notification v6.1.5-20260407' });
    const a = quoted[0]!;
    expect(a.header).toMatchObject({ date: '2026-07-16 14:36:59', subject: 'Aqara Home Version Release Notice v6.3.6' });
    // 헤더 줄은 본문 블록에서 빠진다
    expect(a.groups.flatMap((g) => g.lines.map((l) => l.text)).some((t) => /发件人|主\s*题/.test(t))).toBe(false);
  });

  it('텍스트 본문(보조): 구분자 줄 기준으로 나누고 헤더를 읽는다', () => {
    const blocks = splitPlainMail(sample('plain-quoted.txt'));
    expect(blocks.map((b) => b.header?.format)).toEqual([undefined, 'A', 'B']);
    const result = parseReleaseMail({ subject: 'Aqara Home Version Release Notice v6.3.6', text: sample('plain-quoted.txt') });
    expect(result.mode).toBe('text');
    expect(result.versions.map((v) => v.version)).toEqual(['6.3.6', '6.3.3', '6.1.5']);
  });
});

describe('9개 버전 추출', () => {
  it('v6.4.1 메일 하나에서 인용된 9개 버전을 원본→인용 순으로 뽑는다', () => {
    const result = nested();
    expect(result.failures).toEqual([]);
    expect(result.versions.map((v) => v.version)).toEqual(['6.4.1', '6.3.6', '6.3.3', '6.3.2', '6.3.1', '6.1.6', '6.1.5', '6.1.4', '6.1.3']);
    expect(result.versions.map((v) => v.source.depth)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('인용 헤더의 날짜·제목을 메타데이터로 보관한다', () => {
    const v = byVersion(nested().versions, '6.3.3');
    expect(v.source).toMatchObject({ depth: 2, date: '2026-06-25 14:03:43', subject: 'Aqara Home Version Release Notice v6.3.3-20260619', headerFormat: 'A' });
    expect(v.approvalDate).toBe('2026-06-18');
  });
});

describe('섹션 제목 변형 분류', () => {
  // SPEC 4.3 목록 + 실제 메일(2024-12 ~ 2026-09)에서 확인한 변형
  const cases: [string, string][] = [
    ['Release Version', 'version'], ['Released Version', 'version'], ['Release versions', 'version'], ['Release version', 'version'],
    ['Released Versions', 'version'], ['Version Information', 'version'], ['Version Info', 'version'],
    ['Upgrade Schedule and Release Channels', 'schedule'], ['Upgrade Time and Release Channels', 'schedule'],
    ['Upgrade timeline and release channels', 'schedule'], ['Release Timeline & Distribution Channels', 'schedule'],
    ['Upgrade Timing and Release Channels', 'schedule'], ['Release Schedule & Channels', 'schedule'],
    ['Release Timing & Channels', 'schedule'], ['Release Time and Channels', 'schedule'], ['Release Timeline & Channels', 'schedule'],
    ['Upgrade Time & Release Channels', 'schedule'],
    ['Release Notes', 'notes'], ['Update Notes', 'notes'], ['Update notes', 'notes'], ['Update Description', 'notes'],
    ['Update Highlights', 'notes'], ['Update Summary', 'notes'], ['Update Details', 'notes'], ['Key New Features', 'notes'],
    ['Feature details and notes (internal)', 'internal'], ['Feature Details & Notes (Internal)', 'internal'],
    ['Function Details and Notes (for internal awareness)', 'internal'], ['Feature Details and Important Notes (Internal use only)', 'internal'],
    ['Features and Notes (for internal reference)', 'internal'], ['Feature Details and Notes (Internal Awareness)', 'internal'],
    ['Feature details and notes (internal use)', 'internal'], ['Feature Details and Notes', 'internal'],
    ['Feature Highlights & Internal Notes', 'internal'], ['Feature Details & Internal Notes', 'internal'],
    ['Online Issue Fixes and Optimizations', 'fixes'], ['Online Issues Fixed and Optimized', 'fixes'],
    ['Online Fixes and Optimizations', 'fixes'], ['Bug Fixes & Optimizations', 'fixes'], ['Bug Fixes and Online Optimizations', 'fixes'],
    ['Online Bug Fixes and Optimizations', 'fixes'],
  ];
  it.each(cases)('"%s" → %s', (title, key) => {
    expect(classifySectionTitle(title)).toBe(key);
  });

  it('번호가 메일마다 달라도(1.4가 이슈 수정) 제목으로 분류한다', () => {
    const v = byVersion(nested().versions, '6.4.1');
    expect(v.sections.map((s) => s.key)).toEqual(['version', 'schedule', 'notes', 'fixes']);
    expect(v.sections[3]!.title).toBe('1.4 Online Issue Fixes and Optimizations Including, but not limited to:');
  });

  it('한 단계 번호 제목(1. Version Information)을 읽고, 기능 상세 안의 "1. …" 하위 제목은 섹션으로 보지 않는다', () => {
    const v = byVersion(legacy().versions, '5.3.1');
    expect(v.sections.map((s) => s.key)).toEqual(['version', 'schedule', 'notes', 'internal', 'fixes']);
    expect(texts(v, 'internal')[0]).toBe('1. Sample Release Notes Sync');
  });

  it('한 문단·한 줄 안에 섞인 섹션 제목도 나눈다 (v5.1.6, v5.1.7)', () => {
    const v517 = byVersion(legacy().versions, '5.1.7');
    expect(v517.sections.map((s) => s.title)).toEqual([
      '1.1 Release Version', '1.2 Upgrade Time and Release Channels', '1.3 Update Notes', '1.4 Features and Notes (For Internal Use)', '1.5 Online Issue Fixes and Optimizations',
    ]);
    expect(texts(v517, 'version')).toEqual(['V5.1.7']);
    const v516 = byVersion(legacy().versions, '5.1.6');
    expect(v516.sections.map((s) => s.key)).toEqual(['version', 'schedule', 'notes']);
    expect(texts(v516, 'version')).toEqual(['v5.1.6 (v5.1.4 and v5.1.5 were emergency versions)']);
    expect(v516.channels.ios).toMatchObject({ label: '출시 완료', date: '2025-02-24' });
  });
});

describe('미분류 문단은 기타로 저장', () => {
  it('분류되지 않는 1.x 제목은 기타 섹션 — 제목 자체도 항목으로 남기고 내용은 하위로', () => {
    const v = byVersion(nested().versions, '6.1.6');
    const other = v.items.filter((i) => i.section === 'other');
    expect(other.map((i) => i.original)).toEqual(['1.6 Known Limitations:', 'Sample limitation paragraph that matches no known section.']);
    expect(other[1]!.parentId).toBe(other[0]!.id);
  });

  it('첫 문단은 개요로 저장하고 인사말·서명·제목 반복 줄은 버린다', () => {
    const v = byVersion(nested().versions, '6.1.3');
    expect(texts(v, 'overview')).toEqual(['Version v6.1.3 has completed release approval on March 5, 2026.']);
    const all = v.items.map((i) => i.original).join('\n');
    expect(all).not.toMatch(/Hi all|Best regards|Isabel|\[APP Version Release Notice\]/);
  });

  it('버전 체계 안내 문구(v6.3.1)는 버전 섹션 항목으로 남는다', () => {
    const v = byVersion(nested().versions, '6.3.1');
    expect(texts(v, 'version')).toEqual(['v6.3.1\nTo align with the new versioning strategy, this release is labeled as 6.3.1, and future versions will increment based on this version.']);
  });
});

describe('채널별 버전 (v6.3.3 / v6.3.4)', () => {
  it('Android/iOS와 Google Play 버전을 따로 뽑고, "다음 버전" 줄은 버전으로 쓰지 않는다', () => {
    const v = byVersion(nested().versions, '6.3.3');
    expect(v).toMatchObject({ version: '6.3.3', appVersion: '6.3.3', googlePlayVersion: '6.3.4' });
    expect(texts(v, 'version')).toContain('The next iteration version number will continue as v6.3.5');
  });

  it('채널 제출 상태를 한국어로 정규화한다', () => {
    const v641 = byVersion(nested().versions, '6.4.1');
    expect(v641.channels.android?.label).toBe('출시 완료');
    expect(v641.channels.googlePlay?.label).toBe('제출 예정');
    const v636 = byVersion(nested().versions, '6.3.6');
    expect(v636.channels.googlePlay).toMatchObject({ label: '심사 제출', date: '2026-07-06' });
    expect(v636.channels.ios).toMatchObject({ label: '심사 제출', date: '2026-07-03' });
  });
});

describe('플랫폼 접두어 분리', () => {
  it.each([
    ['iOS: Fixed abnormal NAS login issues.', ['iOS'], 'Fixed abnormal NAS login issues.'],
    ['Android / iOS: v6.3.3', ['Android', 'iOS'], 'v6.3.3'],
    ['Google Play version: Submitted for review.', ['Google Play'], 'Submitted for review.'],
    ['[iOS] Fixed a sample timeline issue.', ['iOS'], 'Fixed a sample timeline issue.'],
    ['Android:\nFix app crash issue', ['Android'], 'Fix app crash issue'],
    ['iOS: Fixed an issue where the App crashed when used on Mac.', ['Mac'], 'Fixed an issue where the App crashed when used on Mac.'],
    ['Fixed an issue on Android where the window would slide.', ['Android'], 'Fixed an issue on Android where the window would slide.'],
    ['Fixed known issues.', [], 'Fixed known issues.'],
  ])('%j', (input, platforms, text) => {
    expect(splitPlatform(input)).toEqual({ platforms, text });
  });

  it('접두어 없음 → 공통, 하위 항목은 상위 플랫폼을 물려받음, 원문은 그대로 보관', () => {
    const v = byVersion(nested().versions, '6.4.1');
    const fixes = v.items.filter((i) => i.section === 'fixes');
    expect(fixes.map((i) => i.platform)).toEqual(['iOS', 'Mac', '공통']);
    expect(fixes[0]).toMatchObject({ text: 'Fixed the issue where the Sample Switch could not be renamed.', original: 'iOS: Fixed the issue where the Sample Switch could not be renamed.' });
    const v616 = byVersion(nested().versions, '6.1.6');
    expect(v616.items.find((i) => i.section === 'fixes')).toMatchObject({ platform: 'Android', text: 'Fix app crash issue on some device models' });
  });
});

describe('중첩 목록 부모-자식 관계', () => {
  it('번호 목록 안의 불릿은 하위 항목, 같은 <li>의 뒤쪽 문단은 같은 항목에 합친다', () => {
    const v = byVersion(nested().versions, '6.1.3');
    const internal = v.items.filter((i) => i.section === 'internal');
    expect(internal.map((i) => [i.id, i.parentId, i.depth])).toEqual([
      ['v6.1.3-int-001', null, 0],
      ['v6.1.3-int-001-01', 'v6.1.3-int-001', 1],
      ['v6.1.3-int-001-02', 'v6.1.3-int-001', 1],
    ]);
    expect(internal[0]!.original).toBe(
      '[Compliance] Sample Security Log\nUsers will be able to view sample records for events such as:\nEntry path:\n“Me” → Settings → “Account & Security”',
    );
  });

  it('번호 목록 바로 뒤의 불릿 목록은 앞 번호 항목의 하위 (v6.3.2 Copilot)', () => {
    const internal = byVersion(nested().versions, '6.3.2').items.filter((i) => i.section === 'internal');
    expect(internal.map((i) => [i.original, i.parentId])).toEqual([
      ['Copilot', null],
      ['Supports viewing images in full screen in Copilot conversations', 'v6.3.2-int-001'],
    ]);
  });

  it('<h4> 소제목·[Fix] 표시 줄·콜론으로 끝난 문단은 뒤따르는 내용의 부모', () => {
    const v = byVersion(nested().versions, '6.1.6');
    const internal = v.items.filter((i) => i.section === 'internal');
    expect(internal.map((i) => [i.id, i.original])).toEqual([
      ['v6.1.6-int-001', '1. Sample Soft Sensor:'],
      ['v6.1.6-int-001-01', 'The sample soft sensor is a made-up feature for testing.'],
      ['v6.1.6-int-001-02', 'Entry:\nDevice tab → top right “+” → add sample sensor.'],
      ['v6.1.6-int-001-03', 'Automation actions:'],
      ['v6.1.6-int-001-03-01', 'Set color and brightness'],
      ['v6.1.6-int-001-03-02', 'Set color temperature and brightness'],
      ['v6.1.6-int-002', '2. [Camera] Sample Snapshot Switch:'],
      ['v6.1.6-int-002-01', 'All sample cameras have added a switch.'],
    ]);
    const notes = v.items.filter((i) => i.section === 'notes');
    expect(notes.map((i) => [i.original, i.parentId])).toEqual([['【Fix】', null], ['Fix known issues.', 'v6.1.6-notes-001']]);
  });

  it('항목 ID는 버전+섹션+순번이라 다시 파싱해도 같다', () => {
    expect(nested().versions.flatMap((v) => v.items.map((i) => i.id))).toEqual(nested().versions.flatMap((v) => v.items.map((i) => i.id)));
    const ids = nested().versions.flatMap((v) => v.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('대문자 V 제목·여러 버전 제목', () => {
  it.each([
    ['[APP Version Release Notice] V6.0.3-20251017', ['6.0.3']],
    ['【Aqara Home Version Release Notice】v6.4.1-20260904', ['6.4.1']],
    ['Aqara Home App Release Notice – v6.1.6 (2026-04-17)', ['6.1.6']],
    ['[APP Version Release Notice] v6.1.3 – 20260305', ['6.1.3']],
    ['Aqara Home App Version Release Notice — V5.3.0 & V5.3.1-20250801', ['5.3.0', '5.3.1']],
  ])('%s', (subject, versions) => {
    expect(extractSubjectVersions(subject)).toEqual(versions);
  });

  it('V6.0.3 메일을 파싱하고, 제목에 버전이 2개면 본문 버전으로 저장하며 경고를 남긴다', () => {
    const result = legacy();
    expect(result.failures).toEqual([]);
    expect(result.versions.map((v) => v.version)).toEqual(['6.0.3', '5.3.1', '5.1.7', '5.1.6']);
    expect(byVersion(result.versions, '5.3.1').warnings).toEqual(['제목에 버전이 여러 개(v5.3.0, v5.3.1) — 본문 기준 v5.3.1로 저장']);
  });
});

describe('중복 제거 (SPEC 4.2)', () => {
  const candidates = (): VersionCandidate[] => {
    const nestedMail = nested().versions.map((parsed) => ({ mailId: 'mail-641', mailDate: '2026-09-16T02:40:21Z', parsed }));
    const original = parseReleaseMail({ subject: '[APP Version Release Notice] v6.1.3 – 20260305', date: '2026-03-12T01:52:24Z', html: sample('v6.1.3-original.html') });
    return [...nestedMail, ...original.versions.map((parsed) => ({ mailId: 'mail-613', mailDate: '2026-03-12T01:52:24Z', parsed }))];
  };

  it('같은 버전이 원본·인용본에 있으면 원본 기준으로 1회만 고르고 메일 링크도 원본 메일', () => {
    const { selected, superseded } = selectVersions(candidates());
    const v613 = selected.filter((s) => s.parsed.version === '6.1.3');
    expect(v613).toHaveLength(1);
    expect(v613[0]).toMatchObject({ origin: 'original', mailId: 'mail-613' });
    expect(v613[0]!.parsed.items.some((i) => i.original === 'Fixed known issues (original).')).toBe(true);
    expect(superseded).toContainEqual({ version: '6.1.3', mailId: 'mail-641', depth: 8 });
  });

  it('원본 메일이 없는 버전은 인용본에서 가져오고 출처를 인용본으로 표시', () => {
    const { selected } = selectVersions(candidates());
    expect(selected.find((s) => s.parsed.version === '6.3.3')).toMatchObject({ origin: 'quote', mailId: 'mail-641' });
    expect(selected.map((s) => s.parsed.version)).toEqual(['6.1.3', '6.1.4', '6.1.5', '6.1.6', '6.3.1', '6.3.2', '6.3.3', '6.3.6', '6.4.1']);
  });

  it('이미 저장된 버전은 건너뛴다', () => {
    const { selected, skippedExisting } = selectVersions(candidates(), ['6.4.1', '6.3.3']);
    expect(skippedExisting).toEqual(['6.3.3', '6.4.1']);
    expect(selected.map((s) => s.parsed.version)).not.toContain('6.4.1');
    expect(selected).toHaveLength(7);
  });
});

describe('제목 키워드 판정 (본문을 열기 전)', () => {
  it.each([
    ['【Aqara Home Version Release Notice】v6.4.1-20260904', true],
    ['APP Version Release Notification v6.1.5-20260407', true],
    ['回复：Clarification on Recent Changes to Remote Unlock Logic', false],
    ['Re: [APP Version Release Notice] V6.0.3-20251017', false],
    ['Weekly sync agenda', false],
  ])('%s → %s', (subject, ok) => {
    expect(checkSubject(subject).ok).toBe(ok);
  });

  it('키워드는 설정값으로 바꿀 수 있다', () => {
    expect(checkSubject('App update v7.0.0', ['update']).ok).toBe(true);
  });
});

describe('버전 추출 실패', () => {
  it('버전이 없는 블록은 실패 사유와 함께 돌려주고, 다른 블록 처리는 계속한다', () => {
    const html = `<p>Hi all,</p><p>1.3 Update Notes:</p><ul><li>Something changed.</li></ul>
      <blockquote>------------------------------------------------------------------<br>发件人：a&lt;a@example.com&gt;<br>日　期：2026年01月01日 10:00:00<br>主　题：Release Notice v6.0.9<br><p>1.1 Release Version:</p><p>v6.0.9</p></blockquote>`;
    const result = parseReleaseMail({ subject: 'Release Notice without version', html });
    expect(result.failures).toEqual([{ depth: 0, subject: 'Release Notice without version', date: undefined, reason: '버전 번호를 찾지 못함' }]);
    expect(result.versions.map((v) => v.version)).toEqual(['6.0.9']);
  });
});
