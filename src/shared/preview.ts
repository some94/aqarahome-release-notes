// 백필 미리보기 보고서 (SPEC 9번). 시트에 쓰지 않고 파싱 결과만 문자열로 만든다.
// GAS 메뉴(백필 미리보기)와 로컬 npm run preview-backfill이 같은 형식을 쓴다.
import { CHANNEL_LABELS, SECTION_LABELS, selectVersions } from '../parser';
import type { MailParseResult, SectionKey } from '../parser';

export { checkSubject, parseReleaseMail } from '../parser';

export interface PreviewMail {
  id: string;
  subject: string;
  /** ISO 수신 시각 */
  date: string;
}

export interface PreviewEntry {
  mail: PreviewMail;
  /** 제목 키워드로 제외된 사유(본문을 열지 않음) */
  excluded?: string;
  result?: MailParseResult;
  /** 본문 읽기·파싱 중 예외 */
  error?: string;
}

export interface PreviewOptions {
  /** 이미 시트에 저장된 버전(건너뛸 대상) */
  stored?: Iterable<string>;
  /** 항목까지 출력 */
  items?: boolean;
  /** 이 버전만 항목 출력 */
  onlyVersion?: string;
}

export function buildPreviewReport(entries: PreviewEntry[], options: PreviewOptions = {}): string[] {
  const out: string[] = [];
  const sorted = [...entries].sort((a, b) => a.mail.date.localeCompare(b.mail.date));
  const candidates = [];

  for (const { mail, excluded, result, error } of sorted) {
    if (excluded) continue;
    const mode = result ? `, ${result.mode}, 블록 ${result.blockCount}개` : '';
    out.push(`■ ${mail.date.slice(0, 10)}  ${mail.subject}${mode}`);
    if (error) out.push(`   ✗ 오류: ${error}`);
    if (!result) continue;
    for (const v of result.versions) {
      candidates.push({ mailId: mail.id, mailDate: mail.date, parsed: v });
      const counts = new Map<SectionKey, number>();
      for (const item of v.items) counts.set(item.section, (counts.get(item.section) ?? 0) + 1);
      const where = v.source.depth === 0 ? '원본' : `인용${v.source.depth}(${v.source.headerFormat ?? '?'})`;
      const sections = [...counts].map(([k, n]) => `${SECTION_LABELS[k]} ${n}`).join(' · ');
      out.push(`   - v${v.version.padEnd(7)} ${where.padEnd(9)} 승인일 ${v.approvalDate ?? '?'}  ${sections}`);
      if (v.appVersion || v.googlePlayVersion) {
        out.push(`       채널 버전: Android/iOS ${v.appVersion ?? '-'} / Google Play ${v.googlePlayVersion ?? '-'}`);
      }
      const others = v.items.filter((i) => i.section === 'other' && i.parentId === null).map((i) => i.original);
      if (others.length) out.push(`       기타로 분류: ${others.join(' / ')}`);
      for (const w of v.warnings) out.push(`       ⚠ ${w}`);
    }
    for (const f of result.failures) out.push(`   ✗ 인용 ${f.depth}단계 ${f.subject ?? ''} — ${f.reason}`);
  }

  const stored = [...(options.stored ?? [])];
  const selection = selectVersions(candidates, stored);

  if (options.items || options.onlyVersion) {
    for (const s of selection.selected) {
      const v = s.parsed;
      if (options.onlyVersion && v.version !== options.onlyVersion) continue;
      out.push('', `======== v${v.version} (${s.origin === 'original' ? '원본' : '인용본'}, ${s.mailId}) ========`);
      for (const [k, c] of Object.entries(v.channels)) {
        out.push(`  [${CHANNEL_LABELS[k as keyof typeof CHANNEL_LABELS]}] ${c!.label}${c!.date ? ` (${c!.date})` : ''}  ← ${c!.raw}`);
      }
      let last = '';
      for (const item of v.items) {
        if (item.section !== last) {
          last = item.section;
          const title = v.sections.find((sec) => sec.key === item.section)?.title ?? '';
          out.push(`  ── ${SECTION_LABELS[item.section]}  ${title ? `"${title}"` : ''}`);
        }
        const text = item.original.replace(/\n/g, ' ⏎ ');
        out.push(`${'  '.repeat(item.depth + 2)}${item.id} [${item.platform}] ${text.length > 140 ? `${text.slice(0, 140)}…` : text}`);
      }
    }
  }

  const excluded = sorted.filter((e) => e.excluded);
  const failures = sorted.flatMap((e) => (e.result?.failures ?? []).map((f) => ({ e, f })));
  const errors = sorted.filter((e) => e.error);
  const quoteOnly = selection.selected.filter((s) => s.origin === 'quote');
  const warned = selection.selected.filter((s) => s.parsed.warnings.length);
  const v = (xs: string[]) => xs.map((x) => `v${x}`).join(', ') || '없음';

  out.push('', '================ 요약 ================');
  out.push(`메일 ${entries.length}건 (본문 확인 ${entries.length - excluded.length}건, 제목 키워드로 제외 ${excluded.length}건)`);
  out.push(`새로 저장될 버전 ${selection.selected.length}개: ${v(selection.selected.map((s) => s.parsed.version))}`);
  out.push(`인용본에서만 추출 ${quoteOnly.length}개: ${v(quoteOnly.map((s) => s.parsed.version))}`);
  out.push(`이미 저장되어 건너뛸 버전 ${selection.skippedExisting.length}개: ${v(selection.skippedExisting)}`);
  out.push(`경고 있는 버전 ${warned.length}개: ${v(warned.map((s) => s.parsed.version))}`);
  out.push(`중복으로 건너뛴 블록 ${selection.superseded.length}개`);
  out.push(`발신자는 맞지만 제목 키워드로 제외된 메일 ${excluded.length}건${excluded.length ? ':' : ''}`);
  for (const e of excluded) out.push(`  - ${e.mail.date.slice(0, 10)} ${e.mail.subject} (${e.excluded})`);
  out.push(`버전 추출 실패 ${failures.length + errors.length}건${failures.length + errors.length ? ':' : ''}`);
  for (const { e, f } of failures) out.push(`  - ${e.mail.date.slice(0, 10)} ${e.mail.subject} — 인용 ${f.depth}단계 ${f.subject ?? ''}: ${f.reason}`);
  for (const e of errors) out.push(`  - ${e.mail.date.slice(0, 10)} ${e.mail.subject} — 오류: ${e.error}`);
  return out;
}
