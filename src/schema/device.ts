import { z } from "zod";
import { Source, Status, Todo } from "./common.js";
import { Internals } from "./internals.js";

export const DeviceClass = z.enum([
  "pv_module",
  /**
   * AC 모듈(모듈 + 공장 결합 마이크로인버터)은 별도 클래스가 아니다.
   * 모듈 노드와 마이크로인버터 노드로 나눠 표현한다 — 그래야 모듈의 DC 출력을 볼 수 있다.
   * 실물이 한 함체라는 사실은 device의 sources/todos에 적는다.
   */
  "microinverter",
  "string_inverter",
  "hybrid_inverter_battery",
  "ac_battery",
  /**
   * DC측에 붙는 축전지. 변환기를 갖지 않으므로 스스로 AC를 내지 못한다 —
   * 연결된 인버터가 있어야 방전이 성립한다.
   */
  "dc_battery",
  "mid",
  "combiner",
  "main_panel",
  "subpanel",
  "service_point",
]);

/**
 * 포트 타입. 연결 가능 여부는 이 타입으로만 판정한다.
 * 렌더러나 룰 엔진이 벤더 이름으로 분기하면 안 된다.
 */
export const PortType = z.enum([
  "dc_pv_module",
  "dc_string",
  "ac_service_line",
  "ac_240v_split",
  "ac_120v_branch",
  "comms_ethernet",
  "comms_wireless",
  "comms_proprietary",
  "ct_sense",
]);

export type PortType = z.infer<typeof PortType>;

export const Port = z.object({
  id: z.string().min(1),
  type: PortType,
  direction: z.enum(["in", "out", "bidirectional"]),
  /**
   * 이 포트에 붙일 수 있는 최대 도체 수. null = 미확인.
   * 기본값을 1로 두면 "확인하지 않았다"가 "1개만 된다"는 주장으로 굳는다 —
   * 검증기는 null을 한도 위반으로 판정하지 않고 미확인으로 보고한다.
   */
  max_connections: z.number().int().positive().nullable().default(null),
  /** 이 포트에 요구되는 과전류 보호 정격. 모르면 null. */
  ocpd_a: z.number().positive().nullable().default(null),
  /**
   * MID 접점의 어느 쪽에 있는 포트인가. provides_mid 장치에서만 의미가 있다.
   * MID를 내장한 올인원 장치는 접점 양쪽에 포트를 갖는다 — 이 값이 없으면
   * 엔진이 아일랜드 경계를 장치 내부에 그릴 수 없어 보수적으로 전체를 차단한다.
   * null = 해당 없음 또는 미확인.
   */
  mid_side: z.enum(["grid", "load"]).nullable().default(null),
});

/** 모든 값은 nullable. 확인되지 않은 숫자를 추정해 채우지 않는다. */
export const Ratings = z
  .object({
    /**
     * 실제로 꺼내 쓸 수 있는 에너지(kWh). 백업 지속 시간의 근거다.
     * 총 에너지와 섞지 않는다 — DoD가 100%가 아니면 둘은 다른 수이며,
     * 총량을 여기 넣으면 백업 시간이 그만큼 부풀려진다.
     */
    usable_energy_kwh: z.number().positive().nullable().default(null),
    /** 셀 총 에너지(kWh). 사용 가능 에너지와의 차가 DoD를 드러낸다. */
    total_energy_kwh: z.number().positive().nullable().default(null),
    continuous_ac_kw: z.number().positive().nullable().default(null),
    continuous_ac_kva: z.number().positive().nullable().default(null),
    peak_ac_kw: z.number().positive().nullable().default(null),
    /** 피상전력 기준 피크 출력(kVA). kW와 섞지 않는다 — 역률 없이 환산하면 없는 정보를 만든다. */
    peak_ac_kva: z.number().positive().nullable().default(null),
    /**
     * 기동 부하 허용치(A, 실효값). 모터 명판 LRA가 실효값으로 주어지므로
     * 판정은 이 값으로 한다.
     */
    lra: z.number().positive().nullable().default(null),
    /**
     * 같은 항목의 피크(첨두)값(A). 실효값보다 크다 — 둘을 섞어 비교하면
     * 기동 능력을 과대평가한다. 룰은 이 값으로 판정하지 않는다.
     */
    lra_peak_a: z.number().positive().nullable().default(null),
    pv_mppt_count: z.number().int().positive().nullable().default(null),
    max_pv_dc_kw: z.number().positive().nullable().default(null),
    busbar_a: z.number().positive().nullable().default(null),
    /**
     * PV 모듈 전기 정격 (STC). 신호 계산(전압·전류)의 유일한 입력이다.
     * 모르면 null — 엔진은 계산을 포기하고 finding을 남긴다. 추정치로 채우지 않는다.
     */
    pv_stc_w: z.number().positive().nullable().default(null),
    pv_vmp_v: z.number().positive().nullable().default(null),
    pv_imp_a: z.number().positive().nullable().default(null),
    pv_voc_v: z.number().positive().nullable().default(null),
    pv_isc_a: z.number().positive().nullable().default(null),
    /** 모듈 효율(%)과 온도계수(%/°C). 온도계수는 음수다. */
    module_efficiency_pct: z.number().positive().nullable().default(null),
    pv_temp_coeff_pmax_pct_per_c: z.number().negative().nullable().default(null),
    pv_temp_coeff_voc_pct_per_c: z.number().negative().nullable().default(null),
    /** 인버터 CEC 가중 효율(%). 동작점의 효율 가정값과 대조된다. */
    cec_efficiency_pct: z.number().positive().nullable().default(null),
    /** 축전지 왕복 효율(%). 충전에 넣은 에너지 중 다시 꺼내지는 비율이다. */
    round_trip_efficiency_pct: z.number().positive().nullable().default(null),
    /** MPPT 입력 전압 창(V). 스트링 길이가 이 안에 들어와야 한다. */
    mppt_v_min: z.number().positive().nullable().default(null),
    mppt_v_max: z.number().positive().nullable().default(null),
    /**
     * 최대 연속 전류(A). 전원 장치에서는 출력, 결합반처럼 모으는 장치에서는 입력 기준이다.
     * 어느 쪽인지는 device의 sources에 적는다. 도체·OCPD 산정의 근거다.
     */
    max_continuous_ac_a: z.number().positive().nullable().default(null),
    /**
     * 분기 차단기 정격의 합에 걸리는 상한(A). 모선 정격과 다르다 —
     * 모선이 견디는 값이 아니라, 이 함체에 물릴 수 있는 분산전원 총량의 한도다.
     */
    max_total_branch_ocpd_a: z.number().positive().nullable().default(null),
    /**
     * 한 분기회로에 물릴 수 있는 최대 유닛 수. 마이크로인버터처럼 트렁크에 여러 대가
     * 물리는 제품에서 제조사가 정하는 값이다. 분기 차단기 정격이 상한을 만든다.
     */
    max_units_per_branch: z.number().int().positive().nullable().default(null),
    main_ocpd_a: z.number().positive().nullable().default(null),
    service_a: z.number().positive().nullable().default(null),
  })
  .strict();

export const UtilityApproval = z.object({
  required: z.boolean(),
  status: z.enum(["approved", "partial", "pending", "unknown", "not_applicable"]),
  note: z.string().nullable().default(null),
});

export const Device = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, "id는 소문자-하이픈 슬러그"),
    vendor: z.string().min(1),
    display_name: z.string().min(1),
    class: DeviceClass,
    status: Status,
    ratings: Ratings.prefault({}),
    ports: z.array(Port).default([]),
    /**
     * 자체적으로 마이크로그리드 인터커넥트(계통 분리) 기능을 제공하는가.
     * null = 미확인. false("제공하지 않는다")와 다르다 — 엔진은 null을 개방 주체로
     * 쓰지 않고 finding을 남긴다. 확인되지 않은 제품을 false로 단정하지 않는다.
     */
    provides_mid: z.boolean().nullable().default(null),
    /**
     * 계통 기준 없이 전압·주파수를 스스로 세울 수 있는가(그리드 포밍).
     * 아일랜드를 형성하는 주체를 가른다. null = 미확인 — 엔진은 "불가"로 취급하고
     * finding을 남긴다. 추정으로 true를 넣지 않는다.
     */
    grid_forming: z.boolean().nullable().default(null),
    /**
     * 계통도 축전지 잔량도 없는 상태에서 PV만으로 기동할 수 있는가.
     * grid_forming과 별개다 — 포밍은 되지만 블랙스타트는 안 되는 장비가 있다.
     * null = 미확인.
     */
    black_start_capable: z.boolean().nullable().default(null),
    /** 동작에 반드시 동반되어야 하는 장비 후보군. 토폴로지에서 최소 1개 충족 필요. */
    requires_one_of: z.array(z.string()).default([]),
    needs_backup_subpanel: z.enum(["yes", "no", "conditional", "unknown"]).default("unknown"),
    certifications: z.array(z.string()).default([]),
    utility_approval: UtilityApproval.nullable().default(null),
    /**
     * 함체 내부 구성. 단선도에는 한 상자로 그리고, 장치를 고르면 그 안을 보여준다.
     * 계산은 이 값을 보지 않는다 — 확인되지 않은 내부 구조가 조류·룰에 새면 안 된다.
     */
    internals: Internals.nullable().default(null),
    sources: z.array(Source).default([]),
    todos: z.array(Todo).default([]),
  })
  .strict();

export type Device = z.infer<typeof Device>;
export type Port = z.infer<typeof Port>;
