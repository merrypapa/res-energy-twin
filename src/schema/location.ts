import { z } from "zod";
import { Source, Todo } from "./common.js";

/**
 * 사이트 위치 — 일사 계산의 기하 입력.
 *
 * 여기 들어가는 것은 위도·경도·표준시 오프셋뿐이다. 기상 데이터(TMY)나 실측 일사량은
 * 담지 않는다 — 그것을 담기 시작하면 발전량 시뮬레이터가 된다 (CLAUDE.md §1).
 * 위도만으로 태양의 고도를 구하고, 맑은 하늘을 가정해 일사를 근사한다.
 */
export const Location = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    display_name: z.string().min(1),
    region: z.string().min(1),
    latitude_deg: z.number().min(-90).max(90),
    longitude_deg: z.number().min(-180).max(180),
    /** 표준시 오프셋(시). 서머타임은 모델링하지 않는다 */
    utc_offset_hours: z.number().min(-12).max(14),
    sources: z.array(Source).default([]),
    todos: z.array(Todo).default([]),
  })
  .strict();

export type Location = z.infer<typeof Location>;
