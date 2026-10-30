// src/ → dist/ 빌드. clasp 3.x는 TypeScript를 변환하지 않으므로 여기서 번들한 결과를 push한다.
//   dist/Code.js        서버 코드(IIFE) + GAS가 인식할 최상위 함수 래퍼
//   dist/index.html     웹 뷰어(CSS·JS 인라인)
//   dist/appsscript.json 매니페스트(src/appsscript.json 복사)
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const SERVER_ENTRY = join(src, 'server', 'main.ts');
const GLOBAL_NAME = 'App';
// GAS V8 런타임에서 안전하게 쓰는 문법 수준
const TARGET = 'es2019';
const buildTime = new Date().toISOString();
// 알림 메시지에 넣을 운영 웹앱 주소(배포 전이면 빈 문자열)
const deployConfigPath = join(root, 'deploy.config.json');
const viewerUrl = existsSync(deployConfigPath) ? (JSON.parse(readFileSync(deployConfigPath, 'utf8')).url ?? '') : '';

async function buildServer() {
  // 1) ESM으로 한 번 번들해서 main.ts의 export 이름 목록을 얻는다(파일로 쓰지 않음)
  const probe = await build({
    entryPoints: [SERVER_ENTRY],
    bundle: true,
    format: 'esm',
    write: false,
    metafile: true,
    outfile: 'probe.js',
    logLevel: 'silent',
  });
  const exportNames = Object.values(probe.metafile.outputs)[0]?.exports ?? [];
  if (exportNames.length === 0) throw new Error('src/server/main.ts에 export된 함수가 없습니다.');

  // 2) 실제 결과물: IIFE 하나로 묶어 전역 App에 담는다
  const result = await build({
    entryPoints: [SERVER_ENTRY],
    bundle: true,
    format: 'iife',
    globalName: GLOBAL_NAME,
    target: TARGET,
    charset: 'utf8',
    define: { __BUILD_TIME__: JSON.stringify(buildTime), __VIEWER_URL__: JSON.stringify(viewerUrl) },
    write: false,
    outfile: 'Code.js',
    logLevel: 'warning',
  });
  const bundle = result.outputFiles[0].text;

  // 3) GAS는 최상위 function 선언만 메뉴·트리거·google.script.run에서 찾을 수 있다
  const wrappers = exportNames
    .map((name) => `function ${name}() { return ${GLOBAL_NAME}.${name}.apply(this, arguments); }`)
    .join('\n');

  const banner = `// 자동 생성 파일입니다. src/를 수정한 뒤 npm run build 하세요. (${buildTime})\n`;
  await writeFile(join(dist, 'Code.js'), `${banner}${bundle}\n${wrappers}\n`, 'utf8');
  return exportNames;
}

async function buildWeb() {
  const html = await readFile(join(src, 'web', 'index.html'), 'utf8');
  const css = await readFile(join(src, 'web', 'styles.css'), 'utf8');
  const result = await build({
    entryPoints: [join(src, 'web', 'client.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2019',
    charset: 'utf8',
    minify: true,
    write: false,
    outfile: 'client.js',
    logLevel: 'warning',
  });
  // 인라인 스크립트 안의 "</script" 가 태그를 닫지 않도록 이스케이프
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

  if (!html.includes('<!-- @styles -->') || !html.includes('<!-- @script -->')) {
    throw new Error('src/web/index.html에 <!-- @styles --> / <!-- @script --> 자리표시가 필요합니다.');
  }
  // replace의 $ 패턴 해석을 피하려고 함수형 치환 사용
  const out = html
    .replace('<!-- @styles -->', () => `<style>\n${css}</style>`)
    .replace('<!-- @script -->', () => `<script>\n${js}</script>`);
  await writeFile(join(dist, 'index.html'), out, 'utf8');
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyFile(join(src, 'appsscript.json'), join(dist, 'appsscript.json'));
const exportNames = await buildServer();
await buildWeb();
console.log(`dist/ 빌드 완료 — 최상위 함수 ${exportNames.length}개: ${exportNames.join(', ')}`);
