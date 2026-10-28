// 로컬 백필 미리보기: fixtures/private/*.eml(또는 --dir 폴더)을 파싱해서 결과만 출력한다. 시트에 아무것도 쓰지 않는다.
//   npm run preview-backfill                  메일별 요약 + 전체 요약
//   npm run preview-backfill -- --items       항목까지 출력
//   npm run preview-backfill -- --version 6.3.3 --items   특정 버전만
//   npm run preview-backfill -- --json out.json            선택된 버전 전체를 JSON으로 저장
import { build } from 'esbuild';
import PostalMime from 'postal-mime';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = option('--dir') ?? join(root, 'fixtures', 'private');
const onlyVersion = option('--version');
const jsonOut = option('--json');

// 파서(TypeScript)를 메모리에서 번들해서 불러온다
const bundle = await build({
  entryPoints: [join(root, 'src', 'parser', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'warning',
});
const parser = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { parseReleaseMail, selectVersions, checkSubject, SECTION_LABELS, CHANNEL_LABELS } = parser;

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.eml'));
if (files.length === 0) {
  console.log(`${dir}에 .eml 파일이 없습니다.`);
  process.exit(0);
}

const mails = [];
for (const file of files) {
  const m = await PostalMime.parse(readFileSync(join(dir, file)));
  mails.push({ file, subject: m.subject ?? '', date: m.date ? new Date(m.date).toISOString() : '', html: m.html, text: m.text });
}
// 오래된 메일부터 (SPEC 9)
mails.sort((a, b) => a.date.localeCompare(b.date));

const candidates = [];
const excluded = [];
const failed = [];
const line = (s = '') => console.log(s);

for (const mail of mails) {
  const check = checkSubject(mail.subject);
  if (!check.ok) {
    excluded.push({ ...mail, reason: check.reason });
    continue;
  }
  const result = parseReleaseMail(mail);
  line(`■ ${mail.date.slice(0, 10)}  ${mail.subject}  [${mail.file}, ${result.mode}, 블록 ${result.blockCount}개]`);
  for (const v of result.versions) {
    candidates.push({ mailId: mail.file, mailDate: mail.date, parsed: v });
    const counts = {};
    for (const item of v.items) counts[item.section] = (counts[item.section] ?? 0) + 1;
    const where = v.source.depth === 0 ? '원본' : `인용${v.source.depth}(${v.source.headerFormat ?? '?'})`;
    const sectionSummary = Object.entries(counts).map(([k, n]) => `${SECTION_LABELS[k]} ${n}`).join(' · ');
    line(`   - v${v.version.padEnd(7)} ${where.padEnd(9)} 승인일 ${v.approvalDate ?? '?'}  ${sectionSummary}`);
    if (v.appVersion || v.googlePlayVersion) line(`       채널 버전: Android/iOS ${v.appVersion ?? '-'} / Google Play ${v.googlePlayVersion ?? '-'}`);
    for (const w of v.warnings) line(`       ⚠ ${w}`);
  }
  for (const f of result.failures) {
    failed.push({ mail, ...f });
    line(`   ✗ 깊이 ${f.depth} ${f.subject ?? ''} — ${f.reason}`);
  }
}

const selection = selectVersions(candidates, []);

if (flag('--items') || onlyVersion) {
  for (const s of selection.selected) {
    const v = s.parsed;
    if (onlyVersion && v.version !== onlyVersion) continue;
    line();
    line(`======== v${v.version} (${s.origin === 'original' ? '원본' : '인용본'}, ${s.mailId}) ========`);
    for (const [k, c] of Object.entries(v.channels)) line(`  [${CHANNEL_LABELS[k]}] ${c.label}${c.date ? ` (${c.date})` : ''}  ← ${c.raw}`);
    let lastSection = '';
    for (const item of v.items) {
      if (item.section !== lastSection) {
        lastSection = item.section;
        const title = v.sections.find((sec) => sec.key === item.section)?.title ?? '';
        line(`  ── ${SECTION_LABELS[item.section]}  ${title ? `"${title}"` : ''}`);
      }
      const indent = '  '.repeat(item.depth + 2);
      const text = item.original.replace(/\n/g, ` ⏎ `);
      line(`${indent}${item.id} [${item.platform}] ${text.length > 140 ? `${text.slice(0, 140)}…` : text}`);
    }
  }
}

line();
line('================ 요약 ================');
line(`메일 ${mails.length}건 (본문 확인 ${mails.length - excluded.length}건, 제목 키워드로 제외 ${excluded.length}건)`);
line(`추출 버전 ${selection.selected.length}개: ${selection.selected.map((s) => `v${s.parsed.version}`).join(', ')}`);
const quoteOnly = selection.selected.filter((s) => s.origin === 'quote');
line(`인용본에서만 추출 ${quoteOnly.length}개: ${quoteOnly.map((s) => `v${s.parsed.version}`).join(', ') || '없음'}`);
const warned = selection.selected.filter((s) => s.parsed.warnings.length);
line(`경고 있는 버전 ${warned.length}개: ${warned.map((s) => `v${s.parsed.version}`).join(', ') || '없음'}`);
line(`중복으로 건너뛴 블록 ${selection.superseded.length}개`);
if (excluded.length) {
  line('제목 키워드로 제외된 메일(본문 열지 않음):');
  for (const e of excluded) line(`  - ${e.date.slice(0, 10)} ${e.subject} (${e.reason})`);
}
if (failed.length) {
  line('버전 추출 실패:');
  for (const f of failed) line(`  - ${f.mail.file} 깊이 ${f.depth} ${f.subject ?? ''}: ${f.reason}`);
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(selection.selected, null, 2), 'utf8');
  line(`JSON 저장: ${jsonOut}`);
}
