// 웹앱 배포: 검사 → 빌드 → push → 새 버전 생성 → 고정 deployment ID를 새 버전으로 갱신(URL 불변).
//   npm run deploy                         평소 배포 (deploy.config.json의 deploymentId 사용)
//   npm run deploy -- -m "설명"            배포 설명 지정
//   npm run deploy -- --create             최초 1회: 배포를 새로 만들고 deploy.config.json에 ID 저장
// 웹앱 설정(access: DOMAIN, executeAs: USER_DEPLOYING)은 src/appsscript.json에서 온다.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'deploy.config.json');
const args = process.argv.slice(2);
const create = args.includes('--create');
const mIndex = args.findIndex((a) => a === '-m' || a === '--message');
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const description = mIndex >= 0 && args[mIndex + 1] ? args[mIndex + 1] : `deploy ${stamp}`;

/** 명령 실행. 실패하면 출력과 함께 중단 */
function run(cmd, { capture = false } = {}) {
  console.log(`> ${cmd}`);
  try {
    const out = execSync(cmd, { cwd: root, encoding: 'utf8', shell: true, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    if (capture) console.log(out.trim());
    return out ?? '';
  } catch (e) {
    console.error(`\n✗ 실패: ${cmd}`);
    process.exit(e.status || 1);
  }
}

function webAppUrl(id) {
  return `https://script.google.com/a/macros/aqara.kr/s/${id}/exec`;
}

// 0) 매니페스트 안전 확인 — 익명 공개 배포 금지 (SPEC 3번)
const manifest = JSON.parse(readFileSync(join(root, 'src', 'appsscript.json'), 'utf8'));
if (manifest.webapp?.access !== 'DOMAIN' || manifest.webapp?.executeAs !== 'USER_DEPLOYING') {
  console.error('✗ src/appsscript.json의 webapp 설정이 access: DOMAIN, executeAs: USER_DEPLOYING이 아닙니다. 배포를 중단합니다.');
  process.exit(1);
}

let config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
if (create && config?.deploymentId) {
  console.error(`✗ 이미 배포가 있습니다(${config.deploymentId}). URL을 유지하려면 --create 없이 npm run deploy를 쓰세요.`);
  process.exit(1);
}
if (!create && !config?.deploymentId) {
  console.error('✗ deploy.config.json에 deploymentId가 없습니다. 최초 1회는 npm run deploy -- --create 로 배포를 만드세요.');
  process.exit(1);
}

// 1) 검사 → 빌드·push
run('npm run typecheck --silent');
run('npm test --silent');
run('npm run push --silent');

// 2) 새 버전 생성
const versionOut = run(`clasp create-version "${description.replace(/"/g, "'")}"`, { capture: true });
const versionNumber = versionOut.match(/version\s+(\d+)/i)?.[1];
if (!versionNumber) {
  console.error('✗ 생성된 버전 번호를 출력에서 찾지 못했습니다.');
  process.exit(1);
}

// 3) 배포 생성(최초) 또는 고정 ID 갱신
if (create) {
  const out = run(`clasp create-deployment -V ${versionNumber} -d "${description.replace(/"/g, "'")}"`, { capture: true });
  const deploymentId = out.match(/AKfy[\w-]+/)?.[0];
  if (!deploymentId) {
    console.error('✗ 배포 ID를 출력에서 찾지 못했습니다. clasp list-deployments로 확인한 뒤 deploy.config.json에 직접 적어 주세요.');
    process.exit(1);
  }
  config = { deploymentId, url: webAppUrl(deploymentId) };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`\n✓ 새 배포 생성(버전 ${versionNumber}) — deploy.config.json 저장. 이 파일은 커밋하세요(비밀값 아님).`);
} else {
  run(`clasp update-deployment ${config.deploymentId} -V ${versionNumber} -d "${description.replace(/"/g, "'")}"`, { capture: true });
  console.log(`\n✓ 배포 갱신(버전 ${versionNumber}) — URL은 그대로입니다.`);
}
console.log(`  웹앱: ${webAppUrl(config.deploymentId)}`);
