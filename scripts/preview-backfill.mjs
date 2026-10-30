// 로컬 백필 미리보기: fixtures/private/*.eml(또는 --dir 폴더)을 파싱해서 결과만 출력한다. 시트에 아무것도 쓰지 않는다.
// 보고서 형식은 GAS 메뉴 "백필 미리보기"와 같다(src/shared/preview.ts).
//   npm run preview-backfill                  메일별 요약 + 전체 요약
//   npm run preview-backfill -- --items       항목까지 출력
//   npm run preview-backfill -- --version 6.3.3   특정 버전만 항목 출력
//   npm run preview-backfill -- --json out.json   파싱 결과 전체를 JSON으로 저장
import { build } from 'esbuild';
import PostalMime from 'postal-mime';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = option('--dir') ?? join(root, 'fixtures', 'private');
const jsonOut = option('--json');

// TypeScript 모듈을 메모리에서 번들해서 불러온다
const bundle = await build({
  entryPoints: [join(root, 'src', 'shared', 'preview.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'warning',
});
const { buildPreviewReport, checkSubject, parseReleaseMail } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.eml'));
if (files.length === 0) {
  console.log(`${dir}에 .eml 파일이 없습니다.`);
  process.exit(0);
}

const entries = [];
for (const file of files) {
  const m = await PostalMime.parse(readFileSync(join(dir, file)));
  const mail = { id: file, subject: m.subject ?? '', date: m.date ? new Date(m.date).toISOString() : '' };
  const check = checkSubject(mail.subject);
  if (!check.ok) {
    entries.push({ mail, excluded: check.reason });
    continue;
  }
  try {
    entries.push({ mail, result: parseReleaseMail({ subject: mail.subject, date: mail.date, html: m.html, text: m.text }) });
  } catch (e) {
    entries.push({ mail, error: e.message });
  }
}

const lines = buildPreviewReport(entries, { items: args.includes('--items'), onlyVersion: option('--version') });
console.log(lines.join('\n'));
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(entries, null, 2), 'utf8');
  console.log(`JSON 저장: ${jsonOut}`);
}
