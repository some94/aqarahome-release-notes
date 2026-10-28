// GAS 진입점. 여기서 export한 함수는 빌드 시 같은 이름의 최상위 함수로 노출된다
// (메뉴·트리거·google.script.run은 최상위 함수만 찾을 수 있음).
import { buildMenu, checkConfig } from './menu';
import { doGet, ping } from './webapp';

export function onOpen(): void {
  buildMenu();
}

export { checkConfig, doGet, ping };
