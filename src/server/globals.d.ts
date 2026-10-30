/** scripts/build.mjs가 esbuild define으로 주입하는 빌드 시각(ISO 문자열) */
declare const __BUILD_TIME__: string;
/** 운영 웹앱 주소(deploy.config.json의 url). 배포 전이면 빈 문자열 */
declare const __VIEWER_URL__: string;
