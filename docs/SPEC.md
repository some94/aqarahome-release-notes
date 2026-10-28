# Aqara Home 앱 릴리즈 노트 관리 시스템 — 개발 요청

아래 요구사항으로 프로젝트를 처음부터 구성해줘. 지금 폴더는 WebStorm에서 만든 빈 프로젝트이고, 이 파일만 들어 있음.

진행 순서
1. **0번(환경 점검·프로젝트 초기화)부터 진행**하고 결과를 보고
2. 코드 작성 전에 **전체 구현 계획(폴더 구조, 모듈 구성, 단계별 작업 순서)을 제시하고 내 확인**을 받기
3. 이후 단계별로 진행하고, 각 단계가 끝날 때마다 결과·테스트 방법을 알려주고 다음 단계 진행 여부 확인

---

## 0. 시작 전 환경 점검·프로젝트 초기화

### 0.1 환경 점검(명령 실행 후 결과 보고)
- `node -v`, `npm -v`: Node.js LTS(20 이상) 여부
- `git --version`
- `clasp --version`: 미설치 시 `npm install -g @google/clasp` 설치 제안(설치 전 확인 받기)
- `clasp login` 상태 확인
  - 로그인 안 되어 있으면 내가 직접 실행하도록 안내(브라우저 인증 필요)
  - 반드시 **릴리즈 메일을 받는 회사 계정(aqara.kr)**으로 로그인
- Apps Script API 사용 설정 여부
  - 꺼져 있으면 clasp push가 실패함
  - https://script.google.com/home/usersettings 에서 켜도록 안내
- 운영체제 확인 후 이후 명령어를 해당 OS(Windows PowerShell/macOS 터미널)에 맞게 제시

### 0.2 프로젝트 초기화
- `git init`, `.gitignore` 생성
  - `node_modules`, `dist`, `.clasp.json`, `.clasprc.json`, `.env*`, 로컬 픽스처 원본 메일(`fixtures/private/`) 제외
- `package.json` 생성, TypeScript·테스트 도구·빌드 도구 설치(설치 목록 먼저 보여주고 확인 받기)
- `tsconfig.json`, 폴더 구조(`src/`, `src/parser/`, `src/web/`, `test/`, `fixtures/`) 생성
- npm 스크립트 구성: `build`, `test`, `push`, `deploy`, `preview-backfill` 등
- 이 요구사항 파일은 `docs/SPEC.md`로 옮기고, 프로젝트 규칙을 담은 `CLAUDE.md` 생성(이후 세션에서도 참고)

### 0.3 Apps Script 프로젝트 생성
- **스프레드시트에 바인딩된 스크립트**로 생성: `clasp create --type sheets --title "Aqara Home 릴리즈 노트"`
  - 시트 커스텀 메뉴(onOpen) 사용, 시트와 스크립트를 한 묶음으로 관리하기 위함
  - 내 Google Drive에 시트 파일이 새로 생기므로 **실행 전 확인 받기**
- `.clasp.json`의 `rootDir`을 빌드 결과 폴더로 지정
- `appsscript.json` 기본값 설정: `timeZone: Asia/Seoul`, `runtimeVersion: V8`, 웹앱·scope 설정(3번 참고)
- 생성된 시트 URL과 스크립트 편집기 URL을 보고

### 0.4 내가 직접 해야 하는 작업이 생기면
- 브라우저 인증, Script Properties 입력(API 키), 웹앱 최초 배포 권한 승인 등은 **내가 할 일을 단계별로 정리해서 알려주고 완료 확인 후 진행**

---

## 1. 목적

- 루미(Lumi) 본사가 메일로 보내는 Aqara Home 앱 릴리즈 노트를 자동 수집
- 영어·중국어 내용은 한국어로 번역하되, **원문 정보 누락 금지**(요약보다 누락 방지가 우선)
- 앱 버전별로 보기 좋게 정리하고, 이후 특정 정보(기기명, 기능, 플랫폼 등) 검색이 쉬워야 함
- 팀원과 공유 필요 → **배포까지 고려한 구조**가 필수

## 2. 확정된 기술 결정

- 실행 환경: Google Apps Script(GAS)
  - 수집·번역·저장·웹 뷰어 전부 GAS 하나로 구성
- 개발 환경: WebStorm + TypeScript, 로컬 개발 후 `clasp`로 push·deploy
  - clasp 버전별로 TypeScript 지원 방식이 다름 → 최신 clasp 문서 확인 후 결정
  - 필요하면 로컬 번들러(esbuild 등)로 빌드한 뒤 push하는 구조로 구성
- 데이터 저장소: Google Sheets(팀원이 직접 열람·수정 가능), 스크립트는 이 시트에 바인딩
- 번역: Claude API(Anthropic Messages API, `UrlFetchApp`으로 호출)
  - 모델명은 Script Properties로 설정 가능하게 구성(기본값 `claude-sonnet-5-5`)
- 스크립트 소유 계정: 내 개인 회사 계정(aqara.kr Google Workspace)
- 실행 주기: 주 1회 시간 트리거(루미 업데이트 주기 2~3주) + 시트 메뉴의 수동 실행

## 3. 배포 요구사항 (필수)

- 웹 뷰어는 GAS 웹앱으로 배포
  - 접근 권한: **aqara.kr 도메인 사용자만**(`access: DOMAIN`)
  - 실행 주체: 배포자 권한(`executeAs: USER_DEPLOYING`) → 팀원에게 시트 권한이 없어도 뷰어 열람 가능
  - 메일에 "internal use only" 내용이 있으므로 **공개(익명) 접근 배포 금지**
- 배포 URL 고정
  - 코드를 업데이트해도 URL이 바뀌지 않도록 고정 deployment ID에 새 버전을 올리는 방식으로 구성
  - `npm run deploy` 같은 스크립트 하나로 빌드→push→기존 배포 갱신까지 처리
- 비밀값 관리
  - Claude API 키는 Script Properties에 저장, 코드·저장소 하드코딩 금지
  - `.clasp.json`, 키 관련 파일은 `.gitignore` 처리
- 권한 범위
  - `appsscript.json`에 필요한 OAuth scope만 명시(Gmail 읽기, Sheets, 외부 요청, 메일 발송 등)
  - 불필요한 쓰기 권한 요청 금지(Gmail은 읽기 전용)
- 초기 설정 자동화
  - 시트 탭·헤더 생성, 트리거 설치를 `setup()` 함수 하나로 처리
  - 중복 실행해도 문제없게(idempotent) 구성
- 문서화
  - `README.md`: 최초 설정 절차(clasp 로그인, Script Properties 입력, setup 실행, 웹앱 배포, 트리거 확인)
  - 팀원용 사용 안내(뷰어 링크 사용법, 시트에서 번역 수정하는 법)

## 4. 입력 메일 특성 (실제 메일 분석 결과)

### 4.1 발신·검색
- 발신: `appupdate@aqara.kr`(그룹명 "루미 정기 이슈"), 작성자 Isabel Yang(`Isabel.Yang@aqara.com`)
- 제목 형식이 매번 다름. 실제 사례:
  - `【Aqara Home Version Release Notice】v6.4.1-20260904`
  - `Aqara Home Version Release Notice v6.3.6`
  - `Aqara Home App Release Notice – v6.1.6 (2026-04-17)`
  - `APP Version Release Notification v6.1.5-20260407`
  - `【APP Version Release Notice】v6.1.4-20260319`
  - `[APP Version Release Notice] v6.1.3 – 20260305`
  - `[APP Version Release Notice] V6.0.3-20251017`(대문자 V)
- 버전 추출 정규식은 대소문자 구분 없이 처리(`v`/`V`)
- 검색 조건은 제목보다 **발신 주소 기준**으로 구성
  - Gmail 검색 쿼리는 Script Properties로 설정 가능하게 구성 → 나중에 Gmail 라벨 기반으로 바꿀 때 코드 수정 불필요
  - 기본값 예: `from:appupdate@aqara.kr OR to:appupdate@aqara.kr` + `release OR notice OR notification` 계열 키워드
- 마지막 처리 시점 이후 메일만 조회, 릴리즈 노트가 아닌 메일은 본문을 열지 않고 건너뜀

### 4.2 인용 누적 구조 (가장 중요)
- 새 메일에 이전 버전 메일들이 인용으로 계속 누적됨
  - 예: v6.4.1 메일 하나에 v6.1.3~v6.4.1, 총 9개 버전 포함
- 인용 구분자(중국어 메일 헤더) 2종 확인
  - 형식 A: `------------------------------------------------------------------` 다음 줄에 `发件人：` `日　期：` `收件人：` `抄　送：` `主　题：`
  - 형식 B: `------------------原始邮件 ------------------` 다음에 `发件人:` `发送时间:` `收件人:` `抄送:` `主题:`
- HTML 본문은 `<blockquote>` 중첩 구조 → HTML 기준 분리를 우선하고, 텍스트 구분자 분리는 보조로 사용
- 스크립트 소유 계정에는 버전별 원본 메일이 각각 존재(2025년~2026-09 기준 약 20건)
  - 같은 버전이 원본 메일 1건 + 이후 메일들의 인용본 여러 건으로 반복 등장
- 분리한 각 블록에서 버전 번호를 추출하고 **시트에 이미 있는 버전은 건너뜀**(중복 제거)
- 같은 버전이 여러 메일에 있으면 **해당 버전의 원본 메일(인용이 아닌 최상단 본문)을 기준으로 1회만 저장**
  - 원본 메일이 없는 버전만 인용본에서 추출하고, 출처를 `인용본`으로 표시
  - 메일 링크도 원본 메일 기준으로 저장
- 인용 헤더의 날짜·제목도 메타데이터로 보관

### 4.3 본문 섹션 구조
- 섹션 번호가 메일마다 다름 → **번호가 아니라 제목 키워드로 분류**
- 실제 확인된 제목 변형:
  - 버전: `1.1 Release Version`, `1.1 Released Version:`, `1.1 Release versions:`, `1. Release version:`
  - 출시 일정·채널: `Upgrade Schedule and Release Channels`, `Upgrade Time and Release Channels`, `Upgrade timeline and release channels`, `Release Timeline & Distribution Channels`, `Upgrade Timing and Release Channels`
  - 공개 릴리즈 노트: `Release Notes`, `Update Notes`, `Update notes`, `Update Description`
  - 기능 상세(내부용): `Feature details and notes (internal)`, `Feature Details & Notes (Internal)`, `Function Details and Notes (for internal awareness)`, `Feature Details and Important Notes (Internal use only)`, `Features and Notes (for internal reference)`, `Feature Details and Notes (Internal Awareness)`, `Feature details and notes (internal use)`
  - 온라인 이슈 수정: `Online Issue Fixes and Optimizations`(1.4로 오는 경우도 있음), `Online Issues Fixed and Optimized`
- 분류되지 않는 제목·문단은 **버리지 말고 "기타" 섹션으로 저장**
- 첫 문단(승인일, 버전 정책 안내 등)도 "개요" 섹션으로 저장
  - 예: v6.3.1의 "새 버전 체계로 6.3.1부터 증가" 안내
- 채널별 버전 차이 처리
  - 예: v6.3.3은 Android/iOS v6.3.3, Google Play v6.3.4, "다음 버전은 v6.3.5"
  - 버전 탭에 채널별 버전 열로 저장
- 항목 앞의 플랫폼 접두어(`iOS:`, `Android:`)는 플랫폼 열로 분리
  - 접두어 없음 → `공통`, Mac 관련 → `Mac` 등 규칙 정의
- 중첩 목록(번호 목록 안의 불릿)은 부모-자식 관계를 유지해서 저장

## 5. 데이터 모델 (Google Sheets)

| 탭 | 한 행 단위 | 주요 열 |
|---|---|---|
| 버전 | 버전 1개 | 버전, Android/iOS 버전, Google Play 버전, 승인일, 메일 수신일, Android/iOS/Google Play 제출 상태(한국어), 처리 상태(정상/검수 필요/오류), 출처(루미 메일/사내 번역본), Gmail 메일 링크 |
| 항목 | 변경 항목 1개 | 항목 ID, 버전, 섹션, 순번, 부모 항목 ID, 플랫폼, 관련 기기, 기능 분류 태그, 내부용 여부, 한국어, 영어 원문, 수정 여부 |
| 용어집 | 용어 1개 | 원어, 한국어 표기, 비고 |
| 실행 로그 | 실행 1회 | 실행 시각, 실행 방식(트리거/수동), 확인 메일 수, 신규 버전, 검수 필요 건수, 오류 내용 |

- 항목 ID는 버전+섹션+순번 기반의 안정적인 값으로 생성
- 시트에서 사람이 한국어 열을 고치면 `수정 여부`를 표시
  - 재실행 시 사람이 고친 번역은 덮어쓰지 않음
- 용어집 초기값 예: 제품명·서비스명은 영문 유지(Magic Switch S1E, Home Guard Plus, Copilot, Thermostat W200 등)

## 6. 번역·누락 검증 규칙

- 파싱 단계에서 원문을 항목 단위로 먼저 분리하고, 각 항목에 ID 부여 후 번역 요청
- Claude에는 JSON 배열(`[{id, text}]`)로 전달하고 같은 ID 집합의 JSON으로 응답받음
- 번역 지침(프롬프트에 포함)
  - 요약·생략·의역으로 인한 정보 손실 금지, 문장 단위로 전부 번역
  - 용어집 표기 준수, 메뉴 경로(예: "Me → Settings → …")는 원문 병기
  - 플랫폼·관련 기기명·기능 분류 태그를 함께 추출
- 코드 검증
  - 응답 ID 집합이 요청과 정확히 일치하는지
  - 빈 번역이 없는지
  - 원문 대비 번역 길이가 비정상적으로 짧지 않은지
  - 하나라도 실패하면 1회 재시도 → 그래도 실패하면 해당 버전 `검수 필요` 처리, 원문은 반드시 저장
- 실패해도 다른 버전 처리는 계속 진행

## 7. 실행·운영

- GAS 실행 시간 제한(6분) 대비
  - 한 번 실행에 버전 단위로 처리하고 진행 상태를 저장
  - 시간이 부족하면 다음 실행에서 이어서 처리
- 오류·`검수 필요` 발생 시 스크립트 소유자에게 메일 알림
- 시트 열면 커스텀 메뉴 표시: `지금 수집`, `선택 항목 재번역`, `설정 점검`
- 알림 확장(선택, 나중에): 새 버전 등록 시 구글 챗 웹훅 알림 → 웹훅 URL을 Script Properties로 받는 구조만 미리 준비

## 8. 웹 뷰어 요구사항

- 최신순 버전 타임라인
  - 카드에 버전, 승인일, 채널별 상태, 항목 수, 내부용 항목 유무 표시
- 버전 상세
  - 섹션별(개요/공개 릴리즈 노트/기능 상세(내부용)/온라인 이슈 수정/출시 일정·채널/기타) 그룹 표시
- 통합 검색: 한국어·영어 원문·기기명·태그 전체 대상(예: "카메라", "W200", "Matter")
- 필터: 플랫폼, 섹션, 내부용만, 기간, 관련 기기
- 항목별 영어 원문 펼쳐보기, 원본 Gmail 메일 링크
- 내부용 항목은 배지로 구분
- 데이터량이 작으므로 전체 데이터를 한 번에 받아 클라이언트에서 검색·필터 처리
- 디자인: 깔끔한 실무용, 모바일 화면에서도 깨지지 않게, 한국어 폰트 가독성 우선

## 9. 초기 데이터(백필)

- 1차: 스크립트 소유 계정에 있는 appupdate@aqara.kr 메일 전체(약 20건) 처리
  - 범위: 2025년 메일 약 11건(V6.0.3 2025-10-17 포함) + 2026년 메일 9건(v6.1.3, 6.1.4, 6.1.5, 6.1.6, 6.3.1, 6.3.2, 6.3.3, 6.3.6, 6.4.1)
  - 오래된 메일부터 순서대로 처리, 버전별 원본 메일 우선 규칙(4.2) 적용
  - 메일 수·버전 수가 많으므로 6분 실행 제한 대비 이어서 처리 구조(7번) 그대로 적용
  - 처리 후 결과 요약 출력: 메일 수, 추출 버전 목록, 인용본에서만 추출된 버전, `검수 필요` 버전
- 2차(선택): 2024년 사내 전달 메일(오보명 발신, v4.1.9~v4.2.9, 이미 한국어 번역본)
  - 루미 원본 메일이 없는 구간을 메우는 용도로만 사용, 루미 원본이 있는 버전은 가져오지 않음
  - 형식이 다르므로 별도 가져오기 함수로 처리
  - 출처를 `사내 번역본`으로 표시
- 백필은 수동 실행 함수로 분리하고, 실행 전 미리보기(시트 기록 없이 파싱 결과만 로그 출력) 모드 제공
  - 미리보기에서 메일별 추출 버전과 섹션 분류 결과를 먼저 확인한 뒤 실제 기록 진행

## 10. 테스트

- 파서는 GAS API에 의존하지 않는 순수 함수로 작성 → 로컬에서 단위 테스트(vitest 등)
- 테스트 픽스처: 실제 메일 원문
  - Gmail "원본 보기"로 내려받은 .eml 또는 HTML 본문을 내가 제공할 예정
  - 필요하면 어떤 형태로 달라고 요청해줘
  - 내부용 내용이 포함된 메일이므로 `fixtures/private/`에 두고 git 커밋 제외
  - 공유 가능한 테스트용으로는 실제 구조만 살린 가공 샘플을 `fixtures/sample/`에 별도 작성
- 필수 테스트 케이스
  - 인용 구분자 2종 분리
  - 9개 버전 추출
  - 섹션 제목 변형 전부 분류
  - 미분류 문단의 기타 저장
  - 채널별 버전(v6.3.3/v6.3.4) 추출
  - 플랫폼 접두어 분리
  - 이미 저장된 버전 건너뛰기
  - 같은 버전이 원본·인용본에 중복 등장 시 원본 기준 1회 저장
  - 대문자 `V` 제목(V6.0.3) 버전 추출
- 픽스처는 형식 차이를 보기 위해 최소 3건 사용: 2025년 메일 1건, 2026년 초 메일 1건, 최신 v6.4.1 메일

## 11. 하지 말 것

- 릴리즈 노트 외 다른 메일 본문 읽기·저장 금지
- Gmail 메일 수정·삭제·라벨 변경 금지(읽기 전용)
- 번역 단계에서 요약으로 정보 줄이기 금지
- 웹앱 익명 공개 배포 금지
- API 키 하드코딩·커밋 금지
