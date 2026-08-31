# Residential Energy System Twin — 프로젝트 브리프

> 이 파일은 리포 루트에 두고 Claude Code가 매 세션 참조하는 컨텍스트다.
> 코드보다 이 문서가 먼저다. 스키마가 흔들리면 전부 다시 짜야 한다.

## 1. 목적

미국 주택용 태양광 + ESS 시스템의 **전기적 구성(configuration)** 을 브라우저에서
조립하고, 비교하고, 검증하는 사내 표준 레퍼런스 도구.

세 가지 질문에 답한다.

1. 이 시스템은 물리적으로 어떻게 연결되는가 (PV → 인버터 → 결합점 → 메인 패널 → 부하)
2. 정전이 나면 무엇이 어떻게 바뀌는가 (MID 개방, 아일랜딩, 백업 부하 경계)
3. 이 구성이 이 집에 성립하는가 (패널 정격, OCPD, 백업 부하 밸런스)

### 비목적 (범위 폭발 방지)

- 퍼밋 도면 생성 아님. PE 날인 설계 아님. Aurora / OpenSolar 대체 아님
- 3D 지붕 레이아웃, 음영 분석, 제안서 생성 없음
- 발전량 시뮬레이션 없음 (필요해지면 pvlib 결과를 CSV로 주입)
- 모든 출력물 하단에 고정 disclaimer: 교육 및 비교 목적, 시공 설계 근거로 사용 불가

## 2. 아키텍처 원칙

**데이터가 제품이고, UI는 뷰어다.** 렌더링 코드에 제품 지식을 하드코딩하지 않는다.
Tesla 전용 분기문이 렌더러에 등장하면 설계가 잘못된 것이다.

```
device-library/     제품 스펙 (YAML, 1제품 1파일)
topologies/         결선 그래프 (JSON, 1구성 1파일)
rules/              코드 체크 룰 (TypeScript, 순수 함수)
scenarios/          운전 상태 정의
src/schema/         zod 스키마 — 단일 진실 원천
src/render/         그래프 → SVG
src/ui/             React 앱
```

## 3. 데이터 모델

### 3.1 device-library

포트(interface)를 가진 블랙박스로 기술한다. 포트가 맞아야 연결된다.

```yaml
id: tesla-powerwall-3
vendor: Tesla
class: hybrid_inverter_battery   # pv_module | microinverter | string_inverter |
                                 # hybrid_inverter_battery | ac_battery |
                                 # mid | combiner | main_panel | meter | subpanel
display_name: Powerwall 3
ratings:
  usable_energy_kwh: 13.5
  continuous_ac_kw: 11.5
  lra: 185                        # 모터 기동 정격 — 백업 시 에어컨 성립 여부를 가름
  pv_mppt_count: 6
ports:
  - { id: pv_dc, type: dc_string, max_count: 6 }
  - { id: ac_out, type: ac_240v_split, ocpd_a: 60 }
  - { id: comms, type: ethernet }
provides_mid: false               # 자체 MID 없음 → 별도 장치 필요
requires_one_of: [tesla-backup-switch, tesla-gateway-3]
install:
  needs_backup_subpanel: conditional
certifications: [UL9540, UL1741-SB]
utility_approval: null            # 미터 컬러류만 해당
sources:
  - "제조사 설치 매뉴얼 rev/날짜 — 반드시 출처와 날짜 기록"
```

**규칙:** 스펙 값에는 반드시 `sources`를 단다. 출처 없는 숫자는 커밋하지 않는다.
모르면 `null`을 쓰고 `TODO` 주석을 남긴다. 추정치를 확정값처럼 넣지 않는다.

### 3.2 topologies

노드-엣지 그래프. 노드는 device 인스턴스, 엣지는 도체.

```json
{
  "id": "tesla-pw3-backup-switch-whole-home",
  "vendor": "Tesla",
  "backup_scope": "whole_home",
  "nodes": [
    { "ref": "utility-service", "device": "utility-service-200a" },
    { "ref": "bs", "device": "tesla-backup-switch" },
    { "ref": "msp", "device": "generic-msp-200a" },
    { "ref": "pw3", "device": "tesla-powerwall-3" }
  ],
  "edges": [
    { "from": "utility-service.line", "to": "bs.grid_in", "conductor": { "awg": "2/0", "ocpd_a": 200 } },
    { "from": "bs.load_out", "to": "msp.main_lugs" },
    { "from": "pw3.ac_out", "to": "msp.branch", "conductor": { "ocpd_a": 60 } }
  ],
  "layers": { "power": [...], "comms": [...] }
}
```

레이어는 최소 3개: `power`(전력회로) / `comms`(통신·CT·PLC) / `physical`(물리 배치).
UI에서 토글된다.

### 3.3 최초 구현 대상 4종

| ID | 핵심 특징 |
|---|---|
| Tesla PW3 + Backup Switch | 미터 뒤 전환, 단일 유닛 11.5kW / 185 LRA |
| Enphase 4th-gen (IQ Battery + Combiner 6C + IQ Meter Collar) | 미터 컬러가 MID — 백업 서브패널 및 부하 재배선 불필요 |
| SolarEdge (Nexis 계열) | DC 결합, 스트링 구조 |
| Qcells G4 ESS (MSC/MID 구성) | 내부 사양 기준. 미확정 항목은 `null` + TODO |

동일 스키마로 표현되는 순간, 부품 수 / 서브패널 필요 여부 / 결선 포인트 수가
자동으로 비교된다. 이것이 이 프로젝트의 핵심 산출물이다.

## 4. 시나리오 (상태 머신)

| 상태 | 동작 |
|---|---|
| `grid_normal` | 계통 연계, PV → 부하 → 잉여 수출 |
| `outage_islanded` | MID 개방, 백업 경계 안쪽만 급전, 경로 재계산 |
| `black_start` | 계통 없이 PV로 배터리 기동 |
| `load_shed` | 부하 차단 우선순위 적용 |
| `fault` | 지정 브레이커 트립, 하위 경로 사선화 |

각 상태에서 **엣지별 에너지 흐름 방향과 활선/사선 여부**가 계산되어야 한다.
이것이 애니메이션의 데이터 소스다. 애니메이션은 계산 결과의 표현일 뿐,
별도 로직을 갖지 않는다.

## 5. 룰 엔진

순수 함수 `(topology, siteContext) => Finding[]`. Finding은
`{ severity: 'error'|'warning'|'info', code, message, refs }`.

초기 체크 항목:

- 버스바 정격 대비 전원 합산 (NEC 705.12(B) 계열 — **인터커넥션 120% 룰**)
- 서플라이 사이드 탭 구성 여부 및 조건 (NEC 705.11 계열)
- 백업 부하 합계 vs 인버터 연속 출력
- 모터 기동: 최대 LRA 부하 vs 장비 LRA 정격
- 포트 타입 불일치, 필수 동반 장비 누락 (`requires_one_of`)
- 미터 컬러 사용 시 해당 유틸리티 승인 여부

**중요:** NEC 조항 번호와 문구를 모델 기억으로 작성하지 말 것.
룰 파일에는 `code_ref: "NEC 705.12(B) — 원문 대조 필요"` 형태로 표기하고,
실제 조문 확인 전까지 `verified: false` 플래그를 유지한다.
사내 배포 전 전기 엔지니어 리뷰를 거친다.

## 6. UI

### 레이아웃

```
┌──────────────┬────────────────────────────┬──────────────┐
│ 구성 선택     │      SLD 캔버스 (SVG)        │  검증 결과     │
│ 벤더/제품/부하 │  레이어 토글 · 시나리오 재생    │  Finding 목록  │
└──────────────┴────────────────────────────┴──────────────┘
```

비교 모드에서는 캔버스가 2~4분할되어 동일 조건의 벤더별 구성을 나란히 놓고,
하단에 차이 요약(부품 수, 서브패널, 결선 포인트, 예상 노무시간)을 띄운다.

### 시각 방향

전기 제도 도면의 어휘를 그대로 쓴다. SaaS 대시보드처럼 보이면 실패다.

- 캔버스는 도면 배경(밝은 중성색, 옅은 그리드). 카드에 담지 않는다
- 심볼은 IEEE/ANSI 단선도 표기 관례를 따른다. 아이콘 세트로 대체하지 않는다
- **색은 하나의 정보만 나른다: 활선 / 사선.** 장식용 색상 없음.
  그 외 구분은 선 두께, 실선/파선, 라벨로 한다
- 모션은 사용자 액션(시나리오 전환, 브레이커 조작)에 대한 응답으로만.
  로드 시 페이드인 없음
- 타이포는 1~2 패밀리. 라벨 전체 대문자 처리 금지. 도체 라벨에 모노스페이스를
  기본값으로 쓰지 말 것
- 모바일에서 최소한 읽히기는 해야 한다 (현장 참조 용도)

## 7. 기술 스택

- TypeScript / Vite / React
- 스키마 검증: zod. YAML·JSON은 빌드 타임에 전부 검증하고, 실패 시 빌드 중단
- SVG 직접 생성 (그래프 레이아웃은 단순 계층 배치로 시작. 범용 그래프 라이브러리
  도입은 필요성이 증명된 뒤에)
- 테스트: vitest. 룰 엔진과 시나리오 계산은 100% 단위 테스트 대상
- 백엔드 없음. GitHub Pages 정적 배포
- 데이터 파일만 고쳐서 새 제품을 추가할 수 있어야 한다. 이걸 CI로 검증한다

## 8. 스프린트

| # | 산출물 | 완료 기준 |
|---|---|---|
| 0 | 스키마 + Tesla/Enphase 2종 토폴로지 + CLI 검증기 | UI 없음. `npm run validate` 통과 |
| 1 | 정적 SLD 렌더러 | 2종이 사람이 읽을 수 있는 단선도로 그려짐 |
| 2 | 시나리오 상태 머신 + 흐름 표시 | 정전 전환 시 경로 변화가 보임 |
| 3 | 룰 엔진 + Finding 패널 | 200A 패널 과부하 구성에서 경고 발생 |
| 4 | 4종 확장 + 비교 모드 | 벤더별 차이가 표로 자동 생성 |
| 5 | GitHub Pages 배포 + 기여 가이드 | 데이터 PR만으로 제품 추가 가능 |

스프린트 0을 건너뛰고 UI부터 만들지 말 것.

## 9. 첫 세션 프롬프트

```
CLAUDE.md를 읽고 스프린트 0만 수행해줘.

1. src/schema/ 에 device / topology / scenario zod 스키마 정의
2. device-library/ 에 Tesla PW3 + Backup Switch, Enphase IQ Battery 10C +
   IQ Combiner 6C + IQ Meter Collar 관련 device 파일 작성
   - 스펙 값은 확실한 것만. 불확실하면 null + TODO 주석 + sources 명시
3. topologies/ 에 위 두 구성의 그래프 JSON
4. scripts/validate.ts — 전 데이터 파일 스키마 검증 + 포트 정합성 검사 CLI
5. vitest로 검증기 테스트

UI는 만들지 마. 끝나면 스키마 설계에서 판단이 갈렸던 지점을 정리해서 보고해줘.
```

## 10. 작업 규칙

- 제품 스펙을 기억으로 채우지 않는다. 매뉴얼/데이터시트 확인 후 `sources` 기재
- 코드 조항을 기억으로 인용하지 않는다
- 렌더러에 벤더 분기문을 넣지 않는다
- 데이터 파일 추가로 해결되는 문제를 코드로 해결하지 않는다
- 커밋 단위는 스키마 변경과 데이터 변경을 분리한다
