import type { PingResult } from '../shared/types';

export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Aqara Home 릴리즈 노트')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 1단계 연결 확인용. 7단계에서 getViewerData로 대체 */
export function ping(): PingResult {
  return {
    serverTime: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
    viewer: Session.getActiveUser().getEmail(),
    buildTime: __BUILD_TIME__,
  };
}
