// HtmlService 페이지에서 쓰는 google.script.* 최소 타입.
// 서버 함수 이름은 src/server/main.ts의 export와 맞춰서 추가한다.
declare namespace google.script {
  interface Runner {
    withSuccessHandler<T>(handler: (result: T) => void): Runner;
    withFailureHandler(handler: (error: Error) => void): Runner;
    getViewerData(): void;
  }
  const run: Runner;

  interface UrlLocation {
    hash: string;
    parameter: Record<string, string>;
    parameters: Record<string, string[]>;
  }
  namespace url {
    function getLocation(callback: (location: UrlLocation) => void): void;
  }
  namespace history {
    function replace(stateObject: object | null, params: Record<string, string>, hash?: string): void;
    function push(stateObject: object | null, params: Record<string, string>, hash?: string): void;
    function setChangeHandler(handler: (event: { state: object | null; location: UrlLocation }) => void): void;
  }
}
