// 번역 요청·응답 규칙 (SPEC 6번). GAS API에 의존하지 않는 순수 함수.
// - 요청: 항목 단위 [{id, text, context}] — context(섹션 제목·상위 항목 원문)는 참고용, 번역 대상 아님
// - 응답: 구조화 출력(JSON 스키마)으로 같은 ID 집합의 {id, ko, platforms, devices, tags}
// - 검증: ID 집합 일치, 빈 번역 없음, 원문 대비 길이가 비정상적으로 짧지 않음

export interface TranslationRequestItem {
  id: string;
  /** 번역할 원문(플랫폼 접두어 제거본) */
  text: string;
  context: {
    section: string;
    /** 상위 항목 원문(하위 항목일 때) */
    parent?: string;
  };
}

export interface GlossaryEntry {
  source: string;
  korean: string;
  note?: string;
}

export interface TranslationResult {
  id: string;
  ko: string;
  platforms: string[];
  devices: string[];
  tags: string[];
}

export const PLATFORM_VALUES = ['Android', 'iOS', 'Mac', 'Google Play', 'HarmonyOS', 'Web'] as const;

/** 기능 분류 태그 후보 — 일관성을 위해 이 안에서 고르게 한다(없으면 새 태그 허용) */
export const SUGGESTED_TAGS = [
  '카메라', '도어락', '허브', '센서', '조명', '스위치', '온도조절', '에너지', '자동화', '장면', '대시보드',
  '알림', '보안', '계정', '결제·구독', 'AI', 'Copilot', 'Matter', 'Thread', 'HomeKit', '음성', '위젯',
  '설정', 'UI', '성능', '안정성', '규정 준수', '지역·다국어', '출시 일정', '기타',
];

/** Claude 구조화 출력 스키마 — 모든 object에 additionalProperties: false, 모든 필드 required */
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translations'],
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'ko', 'platforms', 'devices', 'tags'],
        properties: {
          id: { type: 'string', description: '요청 항목의 id 그대로' },
          ko: { type: 'string', description: '원문 전체를 빠짐없이 옮긴 한국어 번역' },
          platforms: {
            type: 'array',
            description: '원문이 특정 플랫폼에 한정될 때만. 공통이면 빈 배열',
            items: { type: 'string', enum: [...PLATFORM_VALUES] },
          },
          devices: { type: 'array', description: '원문에 나온 기기 제품명·모델명(원문 표기 그대로)', items: { type: 'string' } },
          tags: { type: 'array', description: '기능 분류 태그 1~3개', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export function buildSystemPrompt(): string {
  return [
    '당신은 Aqara Home 앱 릴리즈 노트를 한국어로 옮기는 번역가입니다. 결과는 한국 지사 팀원들이 사내에서 참고합니다.',
    '',
    '번역 원칙 (가장 중요한 순서)',
    '1. 정보를 하나도 빠뜨리지 마세요. 요약·생략·의역으로 내용을 줄이지 말고 원문의 모든 문장을 빠짐없이 옮기세요.',
    '   숫자·버전·날짜·기간·수치·단위·모델명·조건·예외·괄호 속 설명도 모두 유지합니다.',
    '2. 원문의 줄바꿈 구조를 유지하세요(원문에 줄바꿈이 있으면 번역에도 같은 위치에 줄바꿈).',
    '3. 용어집이 주어지면 그 표기를 따르세요. 용어집에서 원어와 한국어 표기가 같은 용어(제품명·서비스명)는 영문 그대로 둡니다.',
    '   용어집에 없는 제품명·서비스명·모델명도 영문 그대로 둡니다.',
    '4. 앱 메뉴 경로, 화면 문구, 따옴표로 묶인 기능·그룹·버튼 이름은 한국어로 옮기고 바로 뒤 괄호에 원문을 병기하세요.',
    '   예: "Me → Settings → Account & Security" → "나 → 설정 → 계정 및 보안 (Me → Settings → Account & Security)"',
    '   예: "Lost Mode" → "분실 모드(Lost Mode)"',
    '5. 중국어가 섞인 원문도 한국어로 옮기세요. 이미 한국어인 원문은 그대로 두세요.',
    '6. 자연스러운 업무용 한국어로 쓰세요. 문체는 "~했습니다/~합니다"로 통일합니다.',
    '',
    '입력 형식',
    '- items: [{id, text, context}] 배열입니다. text만 번역합니다.',
    '- context.section(섹션 제목)과 context.parent(상위 항목 원문)는 뜻을 이해하기 위한 참고용입니다. 번역하거나 결과에 넣지 마세요.',
    '',
    '출력',
    '- 모든 id에 대해 정확히 하나씩 결과를 내고, 요청에 없는 id를 만들지 마세요.',
    '- ko: text의 한국어 번역 전체.',
    `- platforms: text가 특정 플랫폼에만 해당하면 그 플랫폼(${PLATFORM_VALUES.join(', ')}). 여러 플랫폼 공통이거나 알 수 없으면 빈 배열.`,
    '- devices: text에 나온 기기 제품명·모델명을 원문 표기 그대로(예: Hub M3, G410, FP400, Magic Switch S1E). 없으면 빈 배열.',
    `- tags: 기능 분류 태그 1~3개. 가능하면 다음 중에서 고르세요: ${SUGGESTED_TAGS.join(', ')}`,
  ].join('\n');
}

export function buildUserPayload(items: TranslationRequestItem[], glossary: GlossaryEntry[]): string {
  return JSON.stringify({
    glossary: glossary.map((g) => (g.note ? { source: g.source, korean: g.korean, note: g.note } : { source: g.source, korean: g.korean })),
    items,
  });
}

// ---------- 검증 ----------

/**
 * 영어 원문 대비 한국어 번역 길이(공백 제외 글자 수)의 하한.
 * 실측(2026-10-30, v5.1.8·v6.4.1 75개 항목): 문장은 0.32~0.6, 평균 0.6. 0.2 미만이면 요약·생략 의심
 */
const MIN_RATIO_FROM_LATIN = 0.2;
/** 중국어 원문 대비 하한. 한국어가 보통 더 길다 */
const MIN_RATIO_FROM_CJK = 0.6;
/**
 * 이보다 짧은 원문은 길이 비율 검사를 하지 않는다. 제목·명사구는 한국어가 훨씬 짧아질 수 있음
 * (실측: "3. Notification Sound Settings" → "3. 알림음 설정" = 0.26)
 */
const MIN_CHECK_LENGTH = 60;
/** 중국어는 글자당 정보량이 많아 짧은 원문도 검사한다 */
const MIN_CHECK_LENGTH_CJK = 20;

function visibleLength(s: string): number {
  return s.replace(/\s+/g, '').length;
}

/** 번역 길이가 원문 대비 비정상적으로 짧은지 */
export function isSuspiciouslyShort(source: string, ko: string): boolean {
  const srcLen = visibleLength(source);
  const isCjk = (source.match(/[一-鿿]/g) ?? []).length * 2 > srcLen;
  if (srcLen < (isCjk ? MIN_CHECK_LENGTH_CJK : MIN_CHECK_LENGTH)) return false;
  return visibleLength(ko) < srcLen * (isCjk ? MIN_RATIO_FROM_CJK : MIN_RATIO_FROM_LATIN);
}

export interface ValidationOutcome {
  /** 검증을 통과한 결과(ID별) */
  valid: TranslationResult[];
  /** 통과하지 못한 요청 ID */
  failedIds: string[];
  errors: string[];
}

/**
 * 응답 검증. 요청 ID 집합과 정확히 일치해야 전체 통과(ok).
 * 부분 실패여도 통과한 항목은 valid로 돌려준다 — 재시도 후에도 실패한 것만 비워 두기 위함.
 */
export function validateTranslations(request: TranslationRequestItem[], response: unknown): ValidationOutcome & { ok: boolean } {
  const errors: string[] = [];
  const requested = new Map(request.map((r) => [r.id, r]));
  const list = (response as { translations?: unknown })?.translations;
  if (!Array.isArray(list)) {
    return { ok: false, valid: [], failedIds: [...requested.keys()], errors: ['응답에 translations 배열이 없음'] };
  }

  const seen = new Map<string, TranslationResult>();
  for (const raw of list as Partial<TranslationResult>[]) {
    const id = String(raw?.id ?? '');
    if (!requested.has(id)) {
      errors.push(`요청에 없는 id: ${id || '(빈 값)'}`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`중복 id: ${id}`);
      continue;
    }
    seen.set(id, {
      id,
      ko: String(raw.ko ?? '').trim(),
      platforms: arrayOfStrings(raw.platforms).filter((p) => (PLATFORM_VALUES as readonly string[]).includes(p)),
      devices: arrayOfStrings(raw.devices),
      tags: arrayOfStrings(raw.tags),
    });
  }

  const valid: TranslationResult[] = [];
  const failedIds: string[] = [];
  for (const [id, item] of requested) {
    const result = seen.get(id);
    if (!result) {
      errors.push(`응답에 없는 id: ${id}`);
      failedIds.push(id);
    } else if (!result.ko) {
      errors.push(`빈 번역: ${id}`);
      failedIds.push(id);
    } else if (isSuspiciouslyShort(item.text, result.ko)) {
      errors.push(`번역이 원문보다 비정상적으로 짧음: ${id} (원문 ${visibleLength(item.text)}자 → ${visibleLength(result.ko)}자)`);
      failedIds.push(id);
    } else {
      valid.push(result);
    }
  }
  return { ok: errors.length === 0, valid, failedIds, errors };
}

function arrayOfStrings(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))] : [];
}

/** 묶음 나누기: 항목 수와 글자 수 상한을 함께 본다(긴 항목이 몰리면 응답이 너무 길어짐) */
export function chunkItems<T extends { text: string }>(items: T[], maxItems: number, maxChars = 8000): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const item of items) {
    const len = item.text.length;
    if (current.length && (current.length >= maxItems || chars + len > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
