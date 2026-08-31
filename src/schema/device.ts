import { z } from "zod";
import { Source, Status, Todo } from "./common.js";

export const DeviceClass = z.enum([
  "pv_module",
  "microinverter",
  "string_inverter",
  "hybrid_inverter_battery",
  "ac_battery",
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

export const Port = z.object({
  id: z.string().min(1),
  type: PortType,
  direction: z.enum(["in", "out", "bidirectional"]),
  max_connections: z.number().int().positive().default(1),
  /** 이 포트에 요구되는 과전류 보호 정격. 모르면 null. */
  ocpd_a: z.number().positive().nullable().default(null),
});

/** 모든 값은 nullable. 확인되지 않은 숫자를 추정해 채우지 않는다. */
export const Ratings = z
  .object({
    usable_energy_kwh: z.number().positive().nullable().default(null),
    continuous_ac_kw: z.number().positive().nullable().default(null),
    continuous_ac_kva: z.number().positive().nullable().default(null),
    peak_ac_kw: z.number().positive().nullable().default(null),
    lra: z.number().positive().nullable().default(null),
    pv_mppt_count: z.number().int().positive().nullable().default(null),
    max_pv_dc_kw: z.number().positive().nullable().default(null),
    busbar_a: z.number().positive().nullable().default(null),
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
    /** 자체적으로 마이크로그리드 인터커넥트(계통 분리) 기능을 제공하는가. */
    provides_mid: z.boolean(),
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
    sources: z.array(Source).default([]),
    todos: z.array(Todo).default([]),
  })
  .strict();

export type Device = z.infer<typeof Device>;
export type Port = z.infer<typeof Port>;
