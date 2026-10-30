import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('빌드 결과', () => {
  beforeAll(() => {
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
  });

  it('main.ts의 export마다 최상위 함수 래퍼가 생긴다', () => {
    const code = read('dist/Code.js');
    for (const name of [
      'onOpen', 'onEdit', 'setup', 'runSetup', 'checkConfig', 'doGet', 'getViewerData',
      'collectNow', 'continueRun', 'previewBackfillMenu', 'runBackfillMenu', 'reparseMenu',
      'retranslateSelectedMenu', 'translateTestMenu', 'resetTestDataMenu',
      'scheduledCollect', 'installTriggers', 'installTriggersMenu',
    ]) {
      expect(code).toContain(`function ${name}() { return App.${name}.apply(this, arguments); }`);
    }
    expect(code).not.toContain('__BUILD_TIME__');
  });

  it('웹 뷰어는 CSS·JS가 인라인된 단일 HTML이다', () => {
    const html = read('dist/index.html');
    expect(html).not.toContain('<!-- @styles -->');
    expect(html).not.toContain('<!-- @script -->');
    expect(html).toMatch(/<style>[\s\S]+<\/style>/);
    expect(html).toMatch(/<script>[\s\S]+google\.script\.run[\s\S]+<\/script>/);
  });

  it('매니페스트가 그대로 복사된다', () => {
    expect(read('dist/appsscript.json')).toBe(read('src/appsscript.json'));
  });
});

describe('매니페스트 규칙 (SPEC 3번)', () => {
  const manifest = JSON.parse(read('src/appsscript.json'));

  it('웹앱은 도메인 사용자만, 배포자 권한으로 실행', () => {
    expect(manifest.webapp).toEqual({ access: 'DOMAIN', executeAs: 'USER_DEPLOYING' });
  });

  it('Gmail은 읽기 전용 scope만 요청', () => {
    const scopes: string[] = manifest.oauthScopes;
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(scopes.filter((s) => s.includes('mail.google.com') || /gmail\.(modify|compose|send|insert|labels)/.test(s))).toEqual([]);
  });

  it('시간대는 Asia/Seoul, 런타임은 V8', () => {
    expect(manifest.timeZone).toBe('Asia/Seoul');
    expect(manifest.runtimeVersion).toBe('V8');
  });
});
