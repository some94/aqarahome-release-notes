// 제목만 보고 릴리즈 노트 메일인지 판정한다. 통과한 메일만 본문을 연다 (SPEC 4.1, 11)

export const DEFAULT_SUBJECT_KEYWORDS = ['release', 'notice', 'notification'];

/** 회신 메일은 같은 발신 주소라도 릴리즈 노트가 아니다. 예: "回复：Clarification on Recent Changes …" */
const REPLY_PREFIX = /^\s*(re|回复|答复|回覆)\s*[:：]/i;

export type SubjectCheck = { ok: true } | { ok: false; reason: string };

export function checkSubject(subject: string, keywords: string[] = DEFAULT_SUBJECT_KEYWORDS): SubjectCheck {
  if (REPLY_PREFIX.test(subject)) return { ok: false, reason: '회신 메일' };
  const lower = subject.toLowerCase();
  const hit = keywords.some((k) => {
    const word = k.trim().toLowerCase();
    return word.length > 0 && new RegExp(`\\b${escapeRegExp(word)}\\b`).test(lower);
  });
  return hit ? { ok: true } : { ok: false, reason: `제목 키워드 없음(${keywords.join(', ')})` };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
