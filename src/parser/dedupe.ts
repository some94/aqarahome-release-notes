// 여러 메일에서 나온 같은 버전 중 하나만 고른다 (SPEC 4.2)
// - 원본(인용이 아닌 최상단 본문)이 있으면 원본
// - 원본이 없으면 가장 이른 메일의 인용본(출처: 인용본)
// - 시트에 이미 있는 버전은 건너뜀
import type { ParsedVersion } from './types';
import { compareVersions } from './version';

export interface VersionCandidate {
  /** Gmail 메시지 ID — 메일 링크 생성용 */
  mailId: string;
  /** 메일 수신일(정렬용, ISO 문자열) */
  mailDate: string;
  parsed: ParsedVersion;
}

export interface SelectedVersion extends VersionCandidate {
  origin: 'original' | 'quote';
}

export interface SelectionResult {
  /** 버전 오름차순 */
  selected: SelectedVersion[];
  /** 이미 저장되어 건너뛴 버전 */
  skippedExisting: string[];
  /** 선택되지 않은 중복 후보(인용본 등) */
  superseded: { version: string; mailId: string; depth: number }[];
  /** 원본 메일이 아직 처리 대기 중이라 인용본을 쓰지 않고 미룬 버전 */
  deferred: string[];
}

export interface SelectOptions {
  /**
   * 원본 메일이 큐에 남아 있는 버전(제목 기준). 메일을 하나씩 처리할 때
   * 인용본이 원본보다 먼저 저장되지 않도록, 이 버전은 원본 후보가 없으면 미룬다.
   */
  defer?: Iterable<string>;
}

export function selectVersions(
  candidates: VersionCandidate[],
  existing: Iterable<string> = [],
  options: SelectOptions = {},
): SelectionResult {
  const existingSet = new Set(existing);
  const deferSet = new Set(options.defer ?? []);
  const deferred: string[] = [];
  const byVersion = new Map<string, VersionCandidate[]>();
  for (const c of candidates) {
    const list = byVersion.get(c.parsed.version) ?? [];
    list.push(c);
    byVersion.set(c.parsed.version, list);
  }

  const selected: SelectedVersion[] = [];
  const skippedExisting: string[] = [];
  const superseded: SelectionResult['superseded'] = [];

  for (const [version, list] of byVersion) {
    if (existingSet.has(version)) {
      skippedExisting.push(version);
      continue;
    }
    const sorted = [...list].sort(
      (a, b) =>
        Number(a.parsed.source.depth > 0) - Number(b.parsed.source.depth > 0) ||
        a.mailDate.localeCompare(b.mailDate) ||
        a.parsed.source.depth - b.parsed.source.depth,
    );
    const best = sorted[0]!;
    if (best.parsed.source.depth > 0 && deferSet.has(version)) {
      deferred.push(version);
      continue;
    }
    selected.push({ ...best, origin: best.parsed.source.depth === 0 ? 'original' : 'quote' });
    for (const other of sorted.slice(1)) {
      superseded.push({ version, mailId: other.mailId, depth: other.parsed.source.depth });
    }
  }

  selected.sort((a, b) => compareVersions(a.parsed.version, b.parsed.version));
  skippedExisting.sort(compareVersions);
  deferred.sort(compareVersions);
  return { selected, skippedExisting, superseded, deferred };
}
