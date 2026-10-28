# Aqara Home 릴리즈 노트 관리 — 프로젝트 규칙

전체 요구사항은 [docs/SPEC.md](docs/SPEC.md). 작업 전 해당 섹션을 먼저 확인할 것.

## 작업 방식
- 단계별로 진행하고, 단계가 끝나면 결과·테스트 방법을 보고한 뒤 다음 단계 진행 여부를 사용자에게 확인
- 패키지 설치, Google Drive에 파일 생성(`clasp create`), 배포 등 외부에 영향이 있는 작업은 실행 전 확인
- 브라우저 인증·Script Properties 입력·권한 승인 등 사용자가 직접 할 일은 단계별로 정리해 안내하고 완료 확인 후 진행
- 개발 OS는 Windows(PowerShell 5.1) — 안내 명령어는 PowerShell 기준

## 커밋 규칙 (사용자 지시, 항상 적용)
- **Claude는 `git commit`·`git push`를 직접 실행하지 않는다.** 커밋은 사용자가 한다
- 커밋할 시점이 되면 Claude는:
  1. 커밋 메시지 초안을 프로젝트 루트에 txt 파일로 작성 (`commit-msg-1.txt`, `commit-msg-2.txt` … 커밋 1개당 1파일, UTF-8)
     - `commit-msg*.txt`는 `.gitignore` 대상이라 실수로 커밋되지 않음
  2. 사용자가 그대로 실행할 **PowerShell 명령어**를 제시. 커밋마다 아래 형식:
     ```powershell
     git add <이 커밋에 넣을 파일들>; git commit -F commit-msg-1.txt; if ($LASTEXITCODE -eq 0) { Remove-Item commit-msg-1.txt }
     ```
     - 커밋이 성공했을 때만 해당 초안 파일을 삭제
     - 여러 커밋이면 앞 커밋이 실패하면 뒤 커밋이 실행되지 않도록 `if ($LASTEXITCODE -eq 0) { … }`로 연결
     - push가 필요하면 마지막에 `git push origin main` 포함 (기본 브랜치는 `main`, `master` 아님)
- 메시지 형식: 기존 이력과 같은 `type: 한국어 요약` (`feat`/`fix`/`docs`/`chore`/`test`/`refactor`), 본문은 `- ` 목록, 마지막 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 변경을 의미 단위로 작게 나눠 커밋 초안을 만든다

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
- 배포는 고정 deployment ID에 새 버전을 올리는 방식(URL 불변). ID는 `deploy.config.json`(커밋 대상, 비밀값 아님)
- `setup()`은 탭·헤더만 담당하고 idempotent하게 유지. 트리거 설치는 `installTriggers()`로 분리
- 이어서 처리용 일회성 트리거는 실행 시작 시 반드시 삭제(누적 금지)
- 이미 저장된 버전은 자동 수집에서 다시 쓰지 않음. 재파싱은 별도 메뉴 전용, 사람이 수정한 항목이 있으면 경고 후 중단
- 세부 설계·단계 진행 현황은 [docs/PLAN.md](docs/PLAN.md)

## 빌드·검사 명령
- `npm run build` → `dist/` (Code.js + 최상위 함수 래퍼, index.html, appsscript.json)
- `npm run typecheck` → 서버(`tsconfig.json`), 테스트(`test/tsconfig.json`, GAS 타입 없음 → 파서 순수성 강제), 웹(`src/web/tsconfig.json`, DOM)
- `npm test` → vitest
- `npm run push` → build + `clasp push`
- GAS에서 호출되는 함수(메뉴·트리거·`google.script.run`)는 반드시 `src/server/main.ts`에서 export (빌드가 같은 이름의 최상위 함수로 감쌈). `google.script.run`용은 `src/web/gas-client.d.ts`에도 추가
