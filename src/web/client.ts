import type { PingResult } from '../shared/types';

const status = document.getElementById('status')!;

google.script.run
  .withSuccessHandler((result: PingResult) => {
    status.textContent = [
      `서버 연결 정상`,
      `서버 시각: ${result.serverTime}`,
      `접속 계정: ${result.viewer || '(확인 불가)'}`,
      `빌드: ${result.buildTime}`,
    ].join('\n');
  })
  .withFailureHandler((error: Error) => {
    status.classList.add('error');
    status.textContent = `서버 호출 실패: ${error.message}`;
  })
  .ping();
