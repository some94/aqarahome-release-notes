// HtmlService 페이지에서 쓰는 google.script.run 최소 타입.
// 서버 함수 이름은 src/server/main.ts의 export와 맞춰서 추가한다.
declare namespace google.script {
  interface Runner {
    withSuccessHandler<T>(handler: (result: T) => void): Runner;
    withFailureHandler(handler: (error: Error) => void): Runner;
    ping(): void;
  }
  const run: Runner;
}
