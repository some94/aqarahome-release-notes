// 실제 메일(fixtures/private, git 제외) 회귀 테스트. 파일이 없으면 건너뛴다.
// 내용 문구는 검사하지 않고 구조(버전 목록·섹션·실패 없음)만 검사한다.
import { describe, expect, it } from 'vitest';
import { checkSubject, parseReleaseMail, selectVersions } from '../src/parser';
import type { VersionCandidate } from '../src/parser';
import { hasPrivateFixtures, loadEml, privateEmlExists } from './helpers';

const FILES = ['v5.3.0-5.3.1.eml', 'v6.0.3.eml', 'v6.1.3.eml', 'v6.3.1.eml', 'v6.3.3.eml', 'v6.4.1.eml'];

describe.skipIf(!hasPrivateFixtures)('실제 메일 (fixtures/private)', () => {
  it.skipIf(!privateEmlExists('v6.4.1.eml'))('v6.4.1 메일에서 9개 버전', async () => {
    const result = parseReleaseMail(await loadEml('v6.4.1.eml'));
    expect(result.failures).toEqual([]);
    expect(result.versions.map((v) => v.version)).toEqual(['6.4.1', '6.3.6', '6.3.3', '6.3.2', '6.3.1', '6.1.6', '6.1.5', '6.1.4', '6.1.3']);
  });

  it.skipIf(!privateEmlExists('v6.0.3.eml'))('V6.0.3 메일(대문자 V)에서 V5.1.2까지 15개 버전', async () => {
    const result = parseReleaseMail(await loadEml('v6.0.3.eml'));
    expect(result.failures).toEqual([]);
    expect(result.versions[0]!.version).toBe('6.0.3');
    expect(result.versions).toHaveLength(15);
    expect(result.versions.at(-1)!.version).toBe('5.1.2');
  });

  it.skipIf(!privateEmlExists('v6.3.3.eml'))('v6.3.3 채널별 버전', async () => {
    const v = parseReleaseMail(await loadEml('v6.3.3.eml')).versions[0]!;
    expect(v).toMatchObject({ version: '6.3.3', appVersion: '6.3.3', googlePlayVersion: '6.3.4' });
  });

  it.skipIf(!FILES.every(privateEmlExists))('전체: 24개 버전, 실패 없음, 모든 버전에 버전·릴리즈 노트 섹션', async () => {
    const candidates: VersionCandidate[] = [];
    for (const file of FILES) {
      const mail = await loadEml(file);
      expect(checkSubject(mail.subject).ok).toBe(true);
      const result = parseReleaseMail(mail);
      expect(result.failures).toEqual([]);
      candidates.push(...result.versions.map((parsed) => ({ mailId: file, mailDate: mail.date ?? '', parsed })));
    }
    const { selected } = selectVersions(candidates);
    expect(selected).toHaveLength(24);
    for (const s of selected) {
      const keys = new Set(s.parsed.items.map((i) => i.section));
      expect(keys.has('version'), `v${s.parsed.version} 버전 섹션`).toBe(true);
      expect(keys.has('notes'), `v${s.parsed.version} 릴리즈 노트`).toBe(true);
      expect(s.parsed.items.every((i) => i.text.trim().length > 0)).toBe(true);
    }
    expect(selected.filter((s) => s.origin === 'original').map((s) => s.parsed.version)).toEqual(['5.3.1', '6.0.3', '6.1.3', '6.3.1', '6.3.3', '6.4.1']);
  });
});
