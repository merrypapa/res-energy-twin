# 기여 가이드

이 리포의 목표는 **데이터 파일만 고쳐서 제품과 구성을 추가할 수 있게** 하는 것이다.
코드를 건드려야 제품이 추가된다면 그건 설계가 잘못된 것이니 이슈로 알려달라.

## 새 제품 추가 — 코드 변경 없음

1. `device-library/<vendor>/<product>.yaml` 하나를 만든다
2. `npm run validate` 를 통과시킨다
3. PR을 연다. CI가 스키마 · 도면 · 룰 · 비교표를 전부 다시 만든다

```yaml
id: vendor-product-slug        # 소문자-하이픈. 파일당 하나
vendor: Vendor
display_name: 제품명
class: hybrid_inverter_battery # 아래 표 참고. 심볼이 여기서 정해진다
status: draft                  # 원문 대조를 마치면 verified
ratings:
  continuous_ac_kw: null       # TODO: 데이터시트 확인
ports:
  - { id: ac_out, type: ac_240v_split, direction: bidirectional }
provides_mid: null             # 미확인이면 null. false는 "제공하지 않는다"는 주장이다
grid_forming: null
sources: []                    # 숫자를 하나라도 넣으면 출처가 필수다
todos:
  - "확인해야 할 것을 남긴다"
```

### 값을 모를 때

**모르면 `null` 을 쓰고 `todos` 에 남긴다.** 추정치를 확정값처럼 넣지 않는다.
이건 스타일 문제가 아니라 이 도구의 존재 이유다 — 엔진은 `null` 을 만나면
판정을 보류하고 그 사실을 보고한다. 추정치를 넣으면 그 보고가 사라진다.

`false` 와 `null` 은 다르다. `provides_mid: false` 는 "이 제품은 계통 분리 기능이
없다"는 주장이고, `null` 은 "확인하지 않았다"는 뜻이다.

### 숫자에는 출처를 단다

```yaml
ratings:
  continuous_ac_kw: 11.5
sources:
  - ref: "제조사 설치 매뉴얼 rev C"
    url: "https://example.com/datasheet.pdf"   # 원문 링크. 화면에서 그대로 걸린다
    date: "2026-08"        # 확인한 날. 승인 현황처럼 변하는 값에 특히 중요하다
    note: "표 3.1"
```

출처 없이 숫자를 넣으면 `E010` 으로 CI가 막는다.
제조사 제품(vendor ≠ generic)이 숫자 스펙을 가지면 `url`과 `date`가 있어야 한다 —
`tests/products.test.ts`가 강제한다.

## 새 구성 추가

`configurations/<slug>.yaml` 하나를 만든다. 옵션 축을 선언하면 UI 선택지가 그대로 생긴다.
컴포저가 `(템플릿, 옵션) => Topology`로 편다.

```yaml
id: vendor-config
vendor: Vendor
display_name: 제품 조합
status: draft
options:
  - { id: backup_mode, label: 백업 구성, kind: enum, default: whole_home,
      choices: [{ value: "none", label: "Grid support (백업 없음)" },
                { value: whole_home, label: 전체 백업 }] }
  - { id: pv_modules, label: PV 모듈 수, kind: int, min: 1, max: 40, default: 20 }
nodes:
  - { ref: svc, device: generic-utility-service-200a }
  - { ref: mid, device: vendor-mid, when: { backup_mode: [whole_home] } }
  - { ref: pv, device: generic-pv-module-400w, repeat: { count: pv_modules, chunk: string_size } }
edges:
  - { from: svc.line, to: mid.grid_in, when: { backup_mode: [whole_home] },
      conductor: { ocpd_a: 200 } }
  - { from: pv.dc_out, to: pv.dc_in, fanout: chain }        # 직렬 스트링
  - { from: pv.dc_out, to: inv.pv_dc, fanout: chunk_last }  # 스트링 종단 → MPPT
presets:
  - { id: vendor-config-whole-home, display_name: "제품 조합 — 전체 백업",
      options: { backup_mode: whole_home } }
```

- 엣지는 `노드ref.포트id` 형식이다. 포트 **타입**이 맞아야 연결된다 (`src/schema/compat.ts`)
- 레이어는 `power` / `comms` / `physical`
- `when`은 `{ 축: [값] }` 매칭뿐이다(키가 여럿이면 AND). 표현식을 쓰지 않는다
- 노드를 `when`으로 가렸으면 그 노드를 쓰는 엣지에도 같은 `when`을 달아라. 아니면 `C020`
- `fanout`: `single` · `pairwise`(i↔i) · `chain`(i→i+1, 묶음 경계를 넘지 않는다) ·
  `chunk_last`(묶음 종단 → 도착지) · `each` · `first`(대표 유닛만)
- `device_from: <축 id>`를 달면 그 자리의 제품을 옵션으로 고른다. 축의 선택지 값이 device id다 —
  이것으로 "모듈/인버터/ESS 고르기"가 데이터만으로 표현된다
- **배열은 축약하지 않는다.** 모듈 20장은 `repeat`으로 20노드가 된다.
  `count: 20`으로 뭉치면 부품 수·결선 포인트·신호 계산이 전부 틀어진다
- MID를 내장한 장치라면 포트에 `mid_side: grid | load` 를 달아라.
  없으면 엔진이 아일랜드 경계를 그리지 못해 백업 결과가 실제보다 작게 나온다
- 프리셋은 데이터 검증 error가 없어야 한다. 성립하지 않는 조합은 축에 남겨 두되
  프리셋으로 만들지 않는다 — 그 판정을 보여주는 것이 이 도구의 목적이다

## 노드 노트 추가

`node-notes/<slug>.yaml` 하나를 만든다. class 단위가 기본이고, 특정 제품에만 해당하면
`applies_to.device`로 붙인다. 수식은 기호만 적는다 — 숫자는 신호 엔진이 계산해 채운다.

```yaml
id: note-my-class
applies_to: { class: combiner, device: null }
role: 여러 분기회로를 하나의 모선에 모은다.
design_points:
  - title: 합류점의 전류는 분기 전류의 합이다
    body: "..."
    formula: "I_out = Σ I_branch"
    code_ref: "NEC 705.12(B) 계열 — 원문 대조 필요"   # 조항은 기억으로 쓰지 않는다
    verified: false
sources:
  - { ref: "...", date: "2026-09", note: null }
```

## device class

심볼과 엔진 동작이 class에서 정해진다. 벤더나 제품 id로 분기하는 코드는 없다.

| class | 쓰임 |
|---|---|
| `pv_module` | PV 모듈 (DC 출력) |
| `ac_module` | 변환기 일체형 모듈. DC 포트가 없다 |
| `microinverter` / `string_inverter` | 계통 추종 인버터 |
| `hybrid_inverter_battery` | 인버터 + 축전지 **일체** |
| `ac_battery` | AC 결합 축전지 |
| `dc_battery` | DC측 축전지. 스스로 AC를 내지 못한다 |
| `mid` | 계통 분리 장치 |
| `combiner` | 전원 결합반 |
| `main_panel` / `subpanel` | 배전반 |
| `service_point` | 인입점 |

## 확인 명령

```bash
npm run validate                        # 스키마 · 참조 정합성 (error면 CI 실패)
npm run render -- --scenario all        # 시나리오별 단선도
npm run check                           # 코드 체크 룰
npm run compare                         # 벤더 비교표
npm test
npm run dev                             # 브라우저 앱
```

## 룰을 추가할 때

`rules/` 에 파일 하나를 만들고 `rules/index.ts` 에 등록한다.

- **NEC 조문 문구를 기억으로 쓰지 않는다.** `code_ref: "NEC 705.x — 원문 대조 필요"`
  형태로만 표기하고 `verified: false` 를 유지한다
- 원문 대조를 마친 룰만 `verified: true` 로 바꾼다. 그 전까지 출력은 사내 배포용
  근거가 아니며, CLI와 UI가 매번 그렇게 표시한다
- 룰은 순수 함수다. 파일을 읽지 않고, 벤더로 분기하지 않는다 (테스트로 강제된다)

## 리뷰 기준

- 렌더러 · 엔진 · 룰 소스에 벤더명이나 노드 ref가 등장하면 테스트가 실패한다
- 커밋은 스키마 변경과 데이터 변경을 분리한다
- `status: draft` 데이터는 대외 인용 금지다. 도면과 비교표에 그대로 표시된다
