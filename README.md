# Residential Energy System Twin

미국 주택용 태양광 + ESS 시스템의 전기적 구성을 데이터로 기술하고, 검증하고,
벤더 간 비교하기 위한 사내 레퍼런스. 설계 원칙과 범위는 [CLAUDE.md](./CLAUDE.md) 참조.

**현재 스프린트 5 완료 — 전 스프린트 종료.**
스키마 · 검증기 · SLD 렌더러 · 시나리오 엔진 · 룰 엔진 · 비교 · 브라우저 앱 · Pages 배포.

앱은 `npm run dev`. 렌더러 · 시나리오 · 룰 · 비교 엔진이 브라우저에서 그대로 돌고,
UI 전용 로직은 없다. 상태는 URL 해시에 담기므로 링크를 그대로 공유할 수 있다.

```bash
npm install
npm run validate    # 전 데이터 파일 검증 (error 있으면 exit 1)
npm run render      # topologies/ → out/*.svg 단선도
npm run render -- --scenario all   # 시나리오별 급전 상태를 반영한 도면
npm run check       # 룰 엔진 — 코드 체크 Finding
npm run compare     # 벤더별 구성 비교표 (최대 4종)
npm run dev         # 브라우저 앱 (Vite)
npm run build       # 데이터 번들 + 정적 빌드 → dist/
npm test            # 검증기 + 렌더러 + 시나리오 · 룰 엔진 단위 테스트
npm run typecheck
```

`npm run render`는 `--layers power,comms`(기본), `--out <dir>`, `--date <YYYY-MM-DD>`,
`--scenario <id>|all`, `--open <ref,ref>`(fault 트립 대상)를 받는다.
스키마 error가 하나라도 있으면 도면을 그리지 않고 종료한다.

## 구조

| 경로 | 역할 |
|---|---|
| `src/schema/` | zod 스키마 — 데이터 형식의 단일 진실 원천 |
| `src/schema/compat.ts` | 포트 타입 호환 표. 연결 가능 여부는 여기서만 판정 |
| `src/validate/` | 로더 + 검증 규칙 (순수 함수) |
| `device-library/` | 제품 스펙 (YAML, 1제품 1파일) |
| `topologies/` | 결선 그래프 (JSON, 1구성 1파일) |
| `scenarios/` | 운전 상태 정의 (JSON) |
| `rules/` | 코드 체크 룰 (1룰 1파일, 순수 함수) |
| `src/render/` | 그래프 → 계층 배치 → SVG (벤더 분기문 없음) |
| `src/graph/` | topology + device → 해석된 그래프 (렌더러·시나리오·룰 공용) |
| `src/scenario/` | (topology, scenario) → 급전 상태 + 흐름 방향 (순수 함수) |
| `src/rules/` | 룰 실행 엔진 |
| `src/compare/` | 벤더별 구성 비교 (순수 함수) |
| `src/ui/` | React 앱 (3분할 · 비교 모드 · URL 상태) |
| `scripts/validate.ts` | 검증 CLI |
| `scripts/render.ts` | 렌더 CLI |
| `scripts/check.ts` | 룰 CLI |
| `scripts/compare.ts` | 비교 CLI |
| `scripts/bundle.ts` | 데이터 → UI 번들 (검증 실패 시 빌드 중단) |

## 데이터 작성 규칙

- **확인되지 않은 숫자는 `null` + `todos` 항목.** 추정치를 채우지 않는다
- 숫자 스펙이 하나라도 있으면 `sources` 필수 (검증기가 강제, E010)
- `status: draft`는 미검증. 원문 대조 후에만 `verified`로 승격한다.
  현재 모든 제조사 제품은 draft다
- 새 제품 추가는 YAML 파일 하나면 된다. 코드 수정이 필요하면 스키마가 잘못된 것

## 검증 코드

| 코드 | 내용 |
|---|---|
| E010 | 숫자 스펙에 출처 없음 |
| E011/E012 | id 중복 |
| E020 | 알 수 없는 device 참조 |
| E021/E022 | 엣지가 없는 노드/포트 참조 |
| E023 | 포트 타입 또는 방향 비호환 |
| E024 | 포트 연결 수 초과 |
| E025 | `requires_one_of` 미충족 (예: 배터리는 있는데 MID 없음) |
| W030 | 백업 구성인데 MID 제공 장치 없음 |
| W031 | 백업 구성인데 MID 제공 여부가 미확인 |
| I010/I020/I021/I040 | 출처 날짜 누락, draft 사용, 미사용 device |

`npm run check`(룰 엔진)는 별도 코드 체계를 쓴다. 데이터 정합성이 아니라
"이 구성이 이 집에 성립하는가"를 답한다.

| 코드 | 항목 | 근거 |
|---|---|---|
| R010 | 버스바 정격 대비 전원 합산 (120% 룰) | NEC 705.12(B) 계열 — 원문 대조 필요 |
| R020 | 서플라이 사이드(라인측) 탭 구성 | NEC 705.11 계열 — 원문 대조 필요 |
| R030 | 백업 부하 합계 vs 인버터 연속 출력 | — |
| R040 | 모터 기동 전류 vs 장비 LRA 정격 | — |
| R050 | 유틸리티 승인 필요 장치의 승인 상태 | — |

`R0x0`은 위반, `R0x0.n`은 판정 불가(정보 부족), `R0x0.ok`는 통과다.
사이트 조건은 `--site <file.json>`으로 넘긴다. 값이 없으면 판정하지 않고 그 사실을 남긴다.

```json
{ "utility": "PG&E", "backup_load_kw": 14.5, "largest_motor_lra": 200, "service_a": 200 }
```

## 도면 규칙

- 심볼은 **device class 하나로만** 고른다 (`src/render/symbols.ts`). 벤더/제품 id로 분기하지 않는다.
  이 금지는 테스트로 강제된다 (렌더러 소스에 벤더명이 있으면 실패)
- 색은 활선/사선만 나른다. 레이어 구분은 선 두께와 실선/파선
- 급전 상태는 렌더러가 계산하지 않는다. `energization` 인자로 주입받는다 —
  시나리오 엔진(`src/scenario/`)의 출력이 그대로 들어온다

## 기여

`CONTRIBUTING.md` 참고. **데이터 파일만 고쳐서 제품과 구성을 추가할 수 있다** —
코드를 건드려야 제품이 추가된다면 설계가 잘못된 것이니 이슈로 알려달라.
CI가 데이터 PR에서도 전 파이프라인(검증 · 도면 · 룰 · 비교 · 빌드 · 테스트)을 다시 돌린다.

## 배포

`main` 푸시마다 GitHub Pages로 나간다 (`.github/workflows/pages.yml`).

**최초 1회 저장소 설정이 필요하다.** 워크플로가 스스로 Pages를 켜려 하지만
(`configure-pages` 의 `enablement: true`), 기본 상태에서는 토큰 권한이 모자라
`Create Pages site failed — Resource not accessible by integration` 으로 멈춘다.

둘 중 하나를 하면 된다.

1. Settings → Pages → Source 를 **GitHub Actions** 로 지정 (권장, 한 번이면 끝)
2. Settings → Actions → General → Workflow permissions 를
   **Read and write permissions** 로 변경 — 그러면 워크플로가 직접 켠다

빌드 자체는 이 설정과 무관하게 통과한다 (`npm ci` → `validate` → `test` → `build`).
막히는 것은 배포 단계뿐이다. private 리포라면 Pages에 유료 플랜이 필요하다.

## 남은 것

**이 도구의 출력은 아직 사내 배포용 근거가 아니다.**

- 전 룰이 `verified: false` — NEC 조문 원문 대조 전이다. CLI와 UI가 매번 이를 알린다
- SolarEdge · Qcells 는 골격이다. 수치 스펙이 전부 `null`
- `black_start_capable` 전부 미확인, 일부 `grid_forming` · `provides_mid` 미확인
- 부하(분기회로) 노드가 없어 `load_shed` 가 실제 차단을 계산하지 못한다

사내 배포 전 전기 엔지니어 리뷰가 필요하다 (CLAUDE.md §5).
