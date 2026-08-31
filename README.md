# Residential Energy System Twin

미국 주택용 태양광 + ESS 시스템의 전기적 구성을 데이터로 기술하고, 검증하고,
벤더 간 비교하기 위한 사내 레퍼런스. 설계 원칙과 범위는 [CLAUDE.md](./CLAUDE.md) 참조.

**현재 스프린트 0 완료 상태 — UI 없음.** 스키마와 데이터 검증기까지만 있다.

```bash
npm install
npm run validate    # 전 데이터 파일 검증 (error 있으면 exit 1)
npm test            # 룰 단위 테스트
npm run typecheck
```

## 구조

| 경로 | 역할 |
|---|---|
| `src/schema/` | zod 스키마 — 데이터 형식의 단일 진실 원천 |
| `src/schema/compat.ts` | 포트 타입 호환 표. 연결 가능 여부는 여기서만 판정 |
| `src/validate/` | 로더 + 검증 규칙 (순수 함수) |
| `device-library/` | 제품 스펙 (YAML, 1제품 1파일) |
| `topologies/` | 결선 그래프 (JSON, 1구성 1파일) |
| `scripts/validate.ts` | CLI |

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
| I010/I020/I021/I040 | 출처 날짜 누락, draft 사용, 미사용 device |

## 다음

스프린트 1: 그래프 → SVG 단선도 렌더러. 벤더 분기문 없이 스키마만 보고 그린다.
