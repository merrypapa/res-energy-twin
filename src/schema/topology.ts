import { z } from "zod";
import { Layer, Source, Status, Todo } from "./common.js";

/** "노드ref.포트id" 형식. */
export const PortRef = z.string().regex(/^[a-z0-9_-]+\.[a-z0-9_-]+$/, "형식: node.port");

export const TopologyNode = z
  .object({
    ref: z.string().regex(/^[a-z0-9_-]+$/),
    device: z.string().min(1),
    label: z.string().nullable().default(null),
    count: z.number().int().positive().default(1),
  })
  .strict();

export const Conductor = z
  .object({
    awg: z.string().nullable().default(null),
    ocpd_a: z.number().positive().nullable().default(null),
    note: z.string().nullable().default(null),
  })
  .strict();

export const TopologyEdge = z
  .object({
    from: PortRef,
    to: PortRef,
    layer: Layer.default("power"),
    conductor: Conductor.nullable().default(null),
  })
  .strict();

export const Topology = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    vendor: z.string().min(1),
    display_name: z.string().min(1),
    status: Status,
    backup_scope: z.enum(["none", "partial", "whole_home"]),
    nodes: z.array(TopologyNode).min(1),
    edges: z.array(TopologyEdge).min(1),
    sources: z.array(Source).default([]),
    todos: z.array(Todo).default([]),
  })
  .strict();

export type Topology = z.infer<typeof Topology>;
