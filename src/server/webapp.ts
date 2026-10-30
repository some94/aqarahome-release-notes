import { toViewerItemRow, toViewerVersion, type ViewerData } from '../shared/viewer';
import { readTable } from './sheets/repo';
import { CACHE_META, cacheChunkKey as CACHE_CHUNK } from './viewer-cache';

/**
 * 뷰어 데이터 캐시. 7단계 실측: 시트 직접 읽기 서버 1.9~2.1초 + 호출 왕복 약 1.4초 = 3.3~3.8초(기준 3초 초과)
 * → CacheService에 나눠 저장(키당 100KB 제한, 한글 3바이트 기준 3만 자씩).
 * 버전·항목 탭이 바뀌면 지우고(sheets/repo 쓰기 함수·onEdit·초기화), 최대 6시간 유지.
 */
const CHUNK_CHARS = 30000;
const CACHE_TTL_SEC = 6 * 60 * 60;

export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Aqara Home 릴리즈 노트')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function buildViewerData(): Omit<ViewerData, 'serverMs'> {
  const tz = Session.getScriptTimeZone();
  const formatDate = (d: Date) => Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return {
    versions: readTable('versions').rows.map((r) => toViewerVersion(r.record, formatDate)),
    items: readTable('items').rows.map((r) => toViewerItemRow(r.record, formatDate)),
    generatedAt: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'),
  };
}

function readCache(): Omit<ViewerData, 'serverMs'> | null {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(CACHE_META);
  if (!meta) return null;
  const count = Number(meta);
  const keys = Array.from({ length: count }, (_, i) => CACHE_CHUNK(i));
  const parts = cache.getAll(keys);
  if (keys.some((k) => parts[k] === undefined)) return null;
  try {
    return JSON.parse(keys.map((k) => parts[k]).join(''));
  } catch {
    return null;
  }
}

function writeCache(data: Omit<ViewerData, 'serverMs'>): void {
  const json = JSON.stringify(data);
  const chunks: Record<string, string> = {};
  let count = 0;
  for (let i = 0; i < json.length; i += CHUNK_CHARS) chunks[CACHE_CHUNK(count++)] = json.slice(i, i + CHUNK_CHARS);
  try {
    const cache = CacheService.getScriptCache();
    cache.putAll(chunks, CACHE_TTL_SEC);
    cache.put(CACHE_META, String(count), CACHE_TTL_SEC);
  } catch {
    // 캐시 저장 실패는 무시(다음 요청에서 시트를 다시 읽음)
  }
}

/**
 * 뷰어 전체 데이터. executeAs: USER_DEPLOYING 이라 열람자에게 시트 권한이 없어도 읽을 수 있다.
 */
export function getViewerData(): ViewerData {
  const started = Date.now();
  let data = readCache();
  if (!data) {
    data = buildViewerData();
    writeCache(data);
  }
  return { ...data, serverMs: Date.now() - started };
}
