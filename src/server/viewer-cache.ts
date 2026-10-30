// 뷰어 데이터 캐시 키·무효화. 시트 쓰기(repo)와 뷰어(webapp)가 함께 쓰므로 따로 둔다(순환 import 방지).

export const CACHE_META = 'viewer:meta';
export const cacheChunkKey = (i: number) => `viewer:chunk:${i}`;

/** 버전·항목 데이터가 바뀌면 호출. 다음 열람 때 시트를 다시 읽는다 */
export function invalidateViewerCache(): void {
  try {
    CacheService.getScriptCache().remove(CACHE_META);
  } catch {
    // 캐시를 못 지워도 최대 6시간 뒤 만료
  }
}
