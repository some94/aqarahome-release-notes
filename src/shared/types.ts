// 서버(GAS)와 웹 뷰어가 함께 쓰는 타입. GAS·DOM API에 의존하지 않는다.

export interface PingResult {
  serverTime: string;
  viewer: string;
  buildTime: string;
}
