# Aqara Home 릴리즈 노트 관리 — 프로젝트 규칙

전체 요구사항은 [docs/SPEC.md](docs/SPEC.md). 작업 전 해당 섹션을 먼저 확인할 것.

## 작업 방식
- 단계별로 진행하고, 단계가 끝나면 결과·테스트 방법을 보고한 뒤 다음 단계 진행 여부를 사용자에게 확인
- 패키지 설치, Google Drive에 파일 생성(`clasp create`), 배포 등 외부에 영향이 있는 작업은 실행 전 확인
- 브라우저 인증·Script Properties 입력·권한 승인 등 사용자가 직접 할 일은 단계별로 정리해 안내하고 완료 확인 후 진행
- 개발 OS는 Windows(PowerShell 5.1) — 안내 명령어는 PowerShell 기준

## 구조·기술
- Google Apps Script(V8) + 스프레드시트 바인딩 스크립트, 로컬 TypeScript → 번들 → `clasp push`
- clasp 3.x는 TypeScript를 직접 변환하지 않으므로 로컬 번들러로 `dist/`에 빌드 후 push (`.clasp.json`의 `rootDir`는 `dist`)
- 파서(`src/parser/`)는 GAS API에 의존하지 않는 순수 함수로 작성하고 vitest로 단위 테스트
- 웹 뷰어(`src/web/`)는 GAS 웹앱, 전체 데이터를 한 번에 받아 클라이언트에서 검색·필터

## 반드시 지킬 것
- Gmail은 읽기 전용: 메일 수정·삭제·라벨 변경 금지, 릴리즈 노트가 아닌 메일 본문 읽기·저장 금지
- 번역은 요약·생략 금지(누락 방지가 우선). 실패 시 원문은 반드시 저장하고 `검수 필요` 처리
- 웹앱은 `access: DOMAIN`(aqara.kr), `executeAs: USER_DEPLOYING` — 익명 공개 배포 금지
- API 키·웹훅 URL 등 비밀값은 Script Properties에만. 코드·저장소에 하드코딩·커밋 금지
- `appsscript.json` OAuth scope는 필요한 것만(Gmail은 readonly)
  - 매니페스트 원본은 `src/appsscript.json`(빌드 시 `dist/`로 복사). `dist/appsscript.json`을 직접 고치지 말 것
  - Gmail은 `GmailApp` 사용 금지(전체 메일 권한 `https://mail.google.com/` 필요) → 고급 서비스 `Gmail`(Gmail API v1) + `gmail.readonly`만 사용
  - 메일 알림은 `MailApp`(`script.send_mail`)
- 실제 메일 원문은 `fixtures/private/`(git 제외), 공유용 가공 샘플만 `fixtures/sample/`
- 배포는 고정 deployment ID에 새 버전을 올리는 방식(URL 불변)
- `setup()`은 idempotent하게 유지
