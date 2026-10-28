// 파서 입출력 타입. GAS·DOM API에 의존하지 않는다.

export type SectionKey = 'overview' | 'version' | 'schedule' | 'notes' | 'internal' | 'fixes' | 'other';

export type ChannelKey = 'android' | 'ios' | 'googlePlay';

export type SourceLang = 'en' | 'zh' | 'ko' | 'mixed';

/** HTML(또는 텍스트)에서 뽑은 한 줄 */
export interface Line {
  text: string;
  /** 줄 전체가 굵은 글씨(<strong>/<b>)인지 */
  bold: boolean;
}

/** 블록 요소(p, li, h3 …) 하나에서 나온 줄 묶음 */
export interface Group {
  /** 가장 가까운 블록 태그(p, div, li, h3 …) */
  tag: string;
  /** h1~h6 안이면 그 레벨, 아니면 0 */
  heading: number;
  /** 속한 <li>의 ID(목록 밖이면 null) */
  liId: number | null;
  /** 그 <li>를 감싸는 상위 <li>의 ID(중첩 목록) */
  liParent: number | null;
  lines: Line[];
}

/** 인용 헤더(发件人/日期/主题 …)에서 뽑은 메타데이터 */
export interface QuoteHeader {
  /** A: 대시 구분선 + 发件人：/日　期：  B: 原始邮件 + 发件人:/发送时间: */
  format: 'A' | 'B' | 'other';
  from?: string;
  /** 'YYYY-MM-DD HH:mm:ss' (시각이 없으면 날짜만) */
  date?: string;
  subject?: string;
}

/** 인용 깊이별로 나눈 메일 본문 블록. depth 0이 원본(최상단 본문) */
export interface MailBlock {
  depth: number;
  header?: QuoteHeader;
  groups: Group[];
}

export interface ChannelStatus {
  /** 한국어 상태: 출시 완료 / 심사 제출 / 제출 예정 / 확인 필요 */
  label: string;
  /** 'YYYY-MM-DD' (본문에서 찾은 경우) */
  date?: string;
  /** 원문 줄 */
  raw: string;
}

export interface ParsedItem {
  /** 버전+섹션+순번 기반 ID. 예: v6.4.1-notes-003, 하위 항목 v6.4.1-notes-003-02 */
  id: string;
  section: SectionKey;
  /** 같은 부모 안에서의 순번(1부터) */
  seq: number;
  parentId: string | null;
  depth: number;
  /** 공통 / Android / iOS / Mac / Google Play … (여러 개면 ', '로 연결) */
  platform: string;
  /** 번역 대상 원문(플랫폼 접두어 제거) */
  text: string;
  /** 메일에 적힌 그대로의 원문(접두어 포함) */
  original: string;
  lang: SourceLang;
}

export interface ParsedSection {
  key: SectionKey;
  /** 메일에 적힌 섹션 제목(번호 포함) */
  title: string;
}

export interface ParsedVersion {
  /** 'v' 없는 버전 번호. 예: '6.4.1' */
  version: string;
  /** 채널별 버전(본문에 따로 적힌 경우) */
  appVersion?: string;
  googlePlayVersion?: string;
  /** 승인일 'YYYY-MM-DD' */
  approvalDate?: string;
  channels: Partial<Record<ChannelKey, ChannelStatus>>;
  sections: ParsedSection[];
  items: ParsedItem[];
  source: {
    /** 0이면 원본, 1 이상이면 인용 깊이 */
    depth: number;
    /** 원본이면 메일 제목, 인용이면 인용 헤더의 主题 */
    subject?: string;
    /** 원본이면 메일 수신일, 인용이면 인용 헤더 날짜 */
    date?: string;
    from?: string;
    headerFormat?: QuoteHeader['format'];
  };
  /** 검수가 필요할 수 있는 점(제목·본문 버전 불일치 등) */
  warnings: string[];
}

export interface BlockFailure {
  depth: number;
  subject?: string;
  date?: string;
  reason: string;
}

export interface MailInput {
  subject: string;
  /** 메일 수신일 */
  date?: string;
  html?: string;
  text?: string;
}

export interface MailParseResult {
  mode: 'html' | 'text';
  blockCount: number;
  versions: ParsedVersion[];
  failures: BlockFailure[];
}
