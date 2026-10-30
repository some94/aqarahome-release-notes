// 5단계: 번역 요청·응답 검증 (SPEC 6번)
import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPayload,
  chunkItems,
  isSuspiciouslyShort,
  OUTPUT_SCHEMA,
  validateTranslations,
  type TranslationRequestItem,
} from '../src/shared/translation';

const req = (id: string, text: string): TranslationRequestItem => ({ id, text, context: { section: '온라인 이슈 수정' } });
const ok = (id: string, ko: string) => ({ id, ko, platforms: [], devices: [], tags: ['안정성'] });

describe('응답 검증', () => {
  const request = [req('a', 'Fixed known issues.'), req('b', 'Fixed the issue where the local recording download progress remained at 0%.')];

  it('ID 집합이 같고 번역이 모두 있으면 통과', () => {
    const res = validateTranslations(request, { translations: [ok('b', '로컬 녹화 다운로드 진행률이 0%에 머무는 문제를 수정했습니다.'), ok('a', '알려진 문제를 수정했습니다.')] });
    expect(res.ok).toBe(true);
    expect(res.valid.map((v) => v.id).sort()).toEqual(['a', 'b']);
  });

  it('빠진 ID·없는 ID·중복 ID·빈 번역을 잡는다', () => {
    const res = validateTranslations(request, { translations: [ok('a', ''), ok('a', '중복'), ok('zzz', '요청에 없음')] });
    expect(res.ok).toBe(false);
    expect(res.failedIds.sort()).toEqual(['a', 'b']);
    expect(res.errors).toEqual(expect.arrayContaining(['요청에 없는 id: zzz', '중복 id: a', '빈 번역: a', '응답에 없는 id: b']));
  });

  it('원문 대비 비정상적으로 짧은 번역은 실패(요약 의심), 통과한 항목은 따로 돌려준다', () => {
    const res = validateTranslations(request, { translations: [ok('a', '알려진 문제를 수정했습니다.'), ok('b', '다운로드 수정.')] });
    expect(res.ok).toBe(false);
    expect(res.valid.map((v) => v.id)).toEqual(['a']);
    expect(res.failedIds).toEqual(['b']);
    expect(res.errors[0]).toMatch(/비정상적으로 짧음: b/);
  });

  it('translations 배열이 없으면 전체 실패', () => {
    expect(validateTranslations(request, { foo: 1 })).toMatchObject({ ok: false, failedIds: ['a', 'b'] });
  });

  it('플랫폼은 허용 값만, 기기·태그는 중복·빈 값 제거', () => {
    const res = validateTranslations([req('a', 'iOS fix')], {
      translations: [{ id: 'a', ko: 'iOS 수정', platforms: ['iOS', 'Windows'], devices: ['G410', 'G410', ' '], tags: ['카메라', ''] }],
    });
    expect(res.valid[0]).toEqual({ id: 'a', ko: 'iOS 수정', platforms: ['iOS'], devices: ['G410'], tags: ['카메라'] });
  });
});

describe('길이 검사', () => {
  it('짧은 원문·제목은 검사하지 않는다(실측: 제목은 한국어가 훨씬 짧아짐)', () => {
    expect(isSuspiciouslyShort('Copilot', 'Copilot')).toBe(false);
    expect(isSuspiciouslyShort('[Fixes]', '[수정]')).toBe(false);
    expect(isSuspiciouslyShort('3. Notification Sound Settings', '3. 알림음 설정')).toBe(false);
    expect(isSuspiciouslyShort('2. Security Device Permission Process Optimization', '2. 보안 기기 권한 프로세스 최적화')).toBe(false);
  });
  it('영어 문장: 한국어가 글자 수 20% 미만이면 의심', () => {
    const en = 'Added an option for camera AI summary detail level, allowing users to choose between modes.';
    expect(isSuspiciouslyShort(en, '카메라 AI 요약의 상세 수준 옵션을 추가하여 사용자가 모드를 선택할 수 있습니다.')).toBe(false);
    expect(isSuspiciouslyShort(en, 'AI 요약 옵션 추가')).toBe(true);
    // 실측 최저 비율(0.32) 문장은 통과
    expect(
      isSuspiciouslyShort(
        'Turning ON detection features (e.g., face recognition, vehicle recognition, human shape recognition, presence detection) will also enable detection, recording, and push notifications.',
        '감지 기능(예: 얼굴 인식, 차량 인식, 사람 형태 인식, 재실 감지)을 켜면 감지, 녹화, 푸시 알림도 함께 활성화됩니다.',
      ),
    ).toBe(false);
  });
  it('중국어 원문: 한국어가 60% 미만이면 의심', () => {
    const zh = '修复了部分机型在后台运行时应用崩溃的问题以及其他已知问题和体验优化';
    expect(isSuspiciouslyShort(zh, '일부 기종에서 백그라운드 실행 시 앱이 비정상 종료되는 문제와 기타 알려진 문제를 수정하고 사용성을 개선했습니다.')).toBe(false);
    expect(isSuspiciouslyShort(zh, '버그 수정')).toBe(true);
  });
});

describe('묶음 나누기', () => {
  const items = (n: number, len = 10) => Array.from({ length: n }, (_, i) => ({ id: String(i), text: 'x'.repeat(len) }));
  it('항목 수 상한', () => {
    expect(chunkItems(items(45), 20).map((c) => c.length)).toEqual([20, 20, 5]);
  });
  it('글자 수 상한 — 긴 항목이 몰리면 더 잘게', () => {
    expect(chunkItems(items(5, 3000), 20, 8000).map((c) => c.length)).toEqual([2, 2, 1]);
  });
  it('상한보다 긴 항목 하나도 단독 묶음으로 보낸다', () => {
    expect(chunkItems(items(1, 20000), 20, 8000).map((c) => c.length)).toEqual([1]);
  });
});

describe('요청 형식', () => {
  it('구조화 출력 스키마: 모든 object에 additionalProperties false, 모든 속성이 required', () => {
    const check = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown; items?: unknown };
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required ?? [])].sort()).toEqual(Object.keys(n.properties ?? {}).sort());
      }
      Object.values(n.properties ?? {}).forEach(check);
      check(n.items);
    };
    check(OUTPUT_SCHEMA);
  });

  it('요청 본문에 용어집·항목·참고 맥락이 들어가고, 프롬프트는 맥락을 번역하지 말라고 지시한다', () => {
    const payload = JSON.parse(
      buildUserPayload([{ id: 'v1-int-001-01', text: 'Set color', context: { section: '기능 상세(내부용)', parent: 'Automation actions:' } }], [
        { source: 'Copilot', korean: 'Copilot', note: '서비스명' },
      ]),
    );
    expect(payload.items[0].context).toEqual({ section: '기능 상세(내부용)', parent: 'Automation actions:' });
    expect(payload.glossary[0]).toEqual({ source: 'Copilot', korean: 'Copilot', note: '서비스명' });
    expect(buildSystemPrompt()).toMatch(/참고용입니다\. 번역하거나 결과에 넣지 마세요/);
    expect(buildSystemPrompt()).toMatch(/요약·생략·의역/);
  });
});
