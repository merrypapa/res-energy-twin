import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDevices, loadPresetTopologies } from "../src/validate/index.js";
import { runRules } from "../src/rules/engine.js";
import type { Rule } from "../src/rules/types.js";
import { RULES } from "../rules/index.js";
import { EMPTY_SITE, SiteContext } from "../src/schema/rule.js";
import { Device } from "../src/schema/device.js";
import { Topology } from "../src/schema/topology.js";

const devices = loadDevices("device-library").items;
const topologies = loadPresetTopologies("configurations").items;
const tesla = topologies.find((t) => t.id.startsWith("tesla"))!;
const enphase = topologies.find((t) => t.id.startsWith("enphase"))!;
const qcells = topologies.find((t) => t.id.startsWith("qcells"))!;

const site = (o: Partial<SiteContext>) => SiteContext.parse(o);
const run = (t = tesla, s = EMPTY_SITE, d = devices) => runRules(t, d, s);
const codes = (r: ReturnType<typeof runRules>) => r.findings.map((f) => f.code);
const find = (r: ReturnType<typeof runRules>, code: string) => r.findings.find((f) => f.code === code);

/** device-library의 특정 device를 부분 교체한 사본. 데이터만 바꿔 룰 반응을 본다. */
const patch = (id: string, over: Record<string, unknown>) =>
  devices.map((d) => (d.id === id ? Device.parse({ ...d, ...over }) : d));

describe("룰 레지스트리", () => {
  it("CLAUDE.md §5가 지정한 항목이 등록되어 있다", () => {
    // 목록을 통째로 고정하지 않는다 — 룰이 늘 때마다 깨지는 테스트는 아무것도 지키지 않는다.
    // 지켜야 할 것은 "§5 항목이 빠지지 않는다"이다.
    const ids = RULES.map((r) => r.id);
    for (const required of ["R010", "R020", "R030", "R040", "R050"]) {
      expect(ids).toContain(required);
    }
  });

  it("룰 id가 중복되지 않는다 — 같은 id 두 개면 결과에서 구분되지 않는다", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("조문을 인용하는 룰은 전부 verified=false다 — 원문 대조 전까지 근거가 아니다", () => {
    for (const r of RULES) {
      if (r.code_ref !== null) expect(`${r.id}:${r.verified}`).toBe(`${r.id}:false`);
    }
  });

  it("조문 인용 룰의 code_ref에 '원문 대조 필요'가 남아 있다", () => {
    for (const r of RULES.filter((x) => x.code_ref !== null)) {
      expect(`${r.id}: ${r.code_ref}`).toContain("원문 대조 필요");
    }
  });

  it("미대조 룰이 결과에 보고된다", () => {
    expect(run().unverified).toEqual(["R010", "R020", "R030", "R040", "R050"]);
  });
});

describe("R010 — 인터커넥션 120% 룰", () => {
  it("200A 패널 과부하 구성에서 경고가 뜬다 — 스프린트 3 완료 기준", () => {
    const f = find(run(), "R010");
    expect(f?.severity).toBe("warning");
    expect(f?.message).toContain("260A");
    expect(f?.message).toContain("240A");
  });

  it("경고가 관련 노드와 도체를 refs로 지목한다", () => {
    expect(find(run(), "R010")?.refs).toEqual(["msp", "pw3.ac_out->msp.branch"]);
  });

  it("버스바를 키우면 데이터만으로 경고가 사라진다", () => {
    const r = run(tesla, EMPTY_SITE, patch("generic-msp-200a", { ratings: { busbar_a: 400, main_ocpd_a: 200 } }));
    expect(codes(r)).not.toContain("R010");
    expect(codes(r)).toContain("R010.ok");
  });

  it("버스바 정격이 없으면 판정하지 않고 그 사실을 남긴다", () => {
    const r = run(tesla, EMPTY_SITE, patch("generic-msp-200a", { ratings: { busbar_a: null, main_ocpd_a: 200 } }));
    expect(codes(r)).toContain("R010.1");
    expect(codes(r)).not.toContain("R010");
  });

  it("백피드 도체 OCPD가 없으면 판정하지 않는다", () => {
    const r = run(enphase);
    expect(codes(r)).toContain("R010.2");
    expect(codes(r)).not.toContain("R010");
  });

  it("서비스 도체에 붙은 전원은 백피드로 세지 않는다 — 라인측은 R020 소관이다", () => {
    // 전원이면서 ac_service_line 포트로 패널에 붙는 장치를 만든다.
    // 포트 type으로 거르지 않으면 이 100A가 백피드 합에 섞여 들어간다.
    const lineSide = Device.parse({
      id: "vendor-x-line-side-ess",
      vendor: "VendorX",
      display_name: "라인측 접속 ESS",
      class: "hybrid_inverter_battery",
      status: "draft",
      ratings: { continuous_ac_kw: 10 },
      ports: [{ id: "tap", type: "ac_service_line", direction: "bidirectional" }],
      provides_mid: false,
    });
    const branchSource = Device.parse({
      id: "vendor-x-branch-ess",
      vendor: "VendorX",
      display_name: "분기 접속 ESS",
      class: "ac_battery",
      status: "draft",
      ratings: { continuous_ac_kw: 5 },
      ports: [{ id: "ac_out", type: "ac_240v_split", direction: "bidirectional" }],
      provides_mid: false,
    });
    const topo = Topology.parse({
      id: "mixed-tap-fixture",
      vendor: "VendorX",
      display_name: "라인측 + 부하측 혼재 픽스처",
      status: "draft",
      backup_scope: "none",
      nodes: [
        { ref: "panel", device: "generic-msp-200a" },
        { ref: "line", device: "vendor-x-line-side-ess" },
        { ref: "branch", device: "vendor-x-branch-ess" },
      ],
      edges: [
        { from: "line.tap", to: "panel.main_lugs", layer: "power", conductor: { ocpd_a: 100 } },
        { from: "branch.ac_out", to: "panel.branch", layer: "power", conductor: { ocpd_a: 60 } },
      ],
    });
    const f = find(runRules(topo, [...devices, lineSide, branchSource]), "R010");
    expect(f?.message).toContain("백피드 60A");
    expect(f?.refs).toEqual(["panel", "branch.ac_out->panel.branch"]);
  });
});

describe("R020 — 서플라이 사이드 탭", () => {
  it("두 구성 모두 부하측 인터커넥션으로 판정된다", () => {
    for (const t of topologies) expect(codes(run(t))).toContain("R020.none");
  });

  it("전원이 서비스 도체에 붙으면 경고한다", () => {
    const tapDevice = Device.parse({
      id: "vendor-x-line-side-ess",
      vendor: "VendorX",
      display_name: "라인측 접속 ESS",
      class: "hybrid_inverter_battery",
      status: "draft",
      ratings: { continuous_ac_kw: 10 },
      ports: [{ id: "tap", type: "ac_service_line", direction: "bidirectional" }],
      provides_mid: false,
    });
    const topo = Topology.parse({
      id: "line-side-tap-fixture",
      vendor: "VendorX",
      display_name: "라인측 탭 픽스처",
      status: "draft",
      backup_scope: "none",
      nodes: [
        { ref: "svc", device: "generic-utility-service-200a" },
        { ref: "ess", device: "vendor-x-line-side-ess" },
      ],
      edges: [{ from: "svc.line", to: "ess.tap", layer: "power" }],
    });
    const r = runRules(topo, [...devices, tapDevice]);
    const f = find(r, "R020");
    expect(f?.severity).toBe("warning");
    expect(f?.refs).toEqual(["svc.line->ess.tap"]);
  });
});

describe("R030 — 백업 부하 대비 연속 출력", () => {
  it("site가 없으면 판정을 보류하고 전원 합계만 보고한다", () => {
    expect(find(run(), "R030.2")?.message).toContain("11.5 kW");
    expect(codes(run())).not.toContain("R030");
  });

  it("부하가 연속 출력을 넘으면 경고한다", () => {
    const f = find(run(tesla, site({ backup_load_kw: 14.5 })), "R030");
    expect(f?.severity).toBe("warning");
  });

  it("부하가 연속 출력 이하면 통과한다", () => {
    expect(codes(run(tesla, site({ backup_load_kw: 8 })))).toContain("R030.ok");
  });

  it("kVA 정격을 kW 부하와 섞어 계산하지 않는다", () => {
    const r = run(enphase, site({ backup_load_kw: 14.5 }));
    expect(codes(r)).toContain("R030.3");
    expect(codes(r)).not.toContain("R030");
    expect(codes(r)).not.toContain("R030.ok");
  });

  it("정격 없는 전원이 합산에서 빠진 사실을 숨기지 않는다", () => {
    // 특정 제품이 미확인이라는 사실에 걸지 않는다 — 데이터가 채워지면 깨질 뿐 아무것도 지키지 않는다.
    // 지켜야 할 것은 "정격이 비면 조용히 0으로 합산하지 않고 그 사실을 보고한다"이다.
    const stripped = patch("qcells-qtron-ac-microinverter", {
      ratings: { continuous_ac_kw: null, continuous_ac_kva: null },
    });
    expect(find(run(qcells, EMPTY_SITE, stripped), "R030.1")?.message).toContain(
      "qcells-qtron-ac-microinverter",
    );
    // 채워져 있으면 그 제품은 미확인 목록에 오르지 않는다.
    expect(find(run(qcells), "R030.1")?.message ?? "").not.toContain(
      "qcells-qtron-ac-microinverter",
    );
  });

  it("count가 반영된다 — 유닛을 늘리면 합계가 커진다", () => {
    const doubled = Topology.parse({
      ...tesla,
      id: "tesla-two-units-fixture",
      nodes: tesla.nodes.map((n) => (n.ref === "pw3" ? { ...n, count: 2 } : n)),
    });
    expect(codes(runRules(doubled, devices, site({ backup_load_kw: 14.5 })))).toContain("R030.ok");
  });
});

describe("R040 — 모터 기동 LRA", () => {
  it("site가 없으면 판정을 보류하되 장비 정격은 보여준다", () => {
    expect(find(run(), "R040.1")?.message).toContain("185");
  });

  it("기동 전류가 장비 정격을 넘으면 경고한다", () => {
    const f = find(run(tesla, site({ largest_motor_lra: 200 })), "R040");
    expect(f?.severity).toBe("warning");
    expect(f?.refs).toEqual(["pw3"]);
  });

  it("정격 이하면 통과한다", () => {
    expect(codes(run(tesla, site({ largest_motor_lra: 150 })))).toContain("R040.ok");
  });

  it("실효값끼리 비교한다 — 첨두값으로 판정하면 기동 능력을 과대평가한다", () => {
    // Q.HOME CORE G3는 데이터시트가 실효 44.3A / 첨두 62.7A로 둘을 나눠 적는다.
    // 그 사이 값(50A)은 실효 기준으로 초과다. 첨두로 비교했다면 통과했을 것이다.
    const dev = devices.find((d) => d.id === "qcells-qhome-core-g3")!;
    const rms = dev.ratings.lra!;
    const peak = dev.ratings.lra_peak_a!;
    expect(peak).toBeGreaterThan(rms);

    const between = (rms + peak) / 2;
    const r = run(qcells, site({ largest_motor_lra: between }));
    expect(find(r, "R040")?.severity).toBe("warning");
    expect(codes(r)).not.toContain("R040.ok");
    // 첨두값도 화면에 보이되 판정 근거는 실효값이라는 사실이 문장에 남는다.
    expect(find(r, "R040")?.message).toContain("실효값");
    expect(find(r, "R040")?.message).toContain(`${peak}A`);
  });

  it("장비 LRA가 미기재면 성립을 주장하지 않고 경고한다", () => {
    const r = run(enphase, site({ largest_motor_lra: 150 }));
    expect(find(r, "R040.2")?.severity).toBe("warning");
    expect(codes(r)).not.toContain("R040.ok");
  });
});

describe("R050 — 유틸리티 승인", () => {
  it("일부 승인 장치는 개별 확인 경고를 낸다", () => {
    const f = find(run(enphase), "R050.1");
    expect(f?.severity).toBe("warning");
    expect(f?.refs).toEqual(["collar"]);
  });

  it("승인 상태 미확인 장치는 제안 불가로 경고한다", () => {
    expect(find(run(), "R050.2")?.severity).toBe("warning");
  });

  it("site.utility를 주면 메시지가 그 사업자 기준으로 바뀐다", () => {
    expect(find(run(enphase, site({ utility: "PG&E" })), "R050.1")?.message).toContain("PG&E");
  });

  it("승인됨이어도 확인일이 없으면 경고한다 — 승인 현황은 변한다", () => {
    const d = patch("tesla-backup-switch", {
      utility_approval: { required: true, status: "approved", note: null },
      sources: [{ ref: "제조사 페이지", date: null, note: null }],
    });
    expect(find(run(tesla, EMPTY_SITE, d), "R050.3")?.severity).toBe("warning");
  });

  it("확인일이 있는 승인만 통과한다", () => {
    const d = patch("tesla-backup-switch", {
      utility_approval: { required: true, status: "approved", note: null },
      sources: [{ ref: "유틸리티 승인 목록", date: "2026-08", note: null }],
    });
    expect(codes(run(tesla, EMPTY_SITE, d))).toContain("R050.ok");
  });

  it("승인이 필요 없는 장치는 아무 말도 하지 않는다", () => {
    const r = run();
    const approvalRefs = r.findings.filter((f) => f.code.startsWith("R050")).flatMap((f) => f.refs);
    expect(approvalRefs).not.toContain("msp");
    expect(approvalRefs).not.toContain("pv");
  });
});

describe("R070 — 분기회로당 유닛 수", () => {
  const of = (r: ReturnType<typeof runRules>, code: string) =>
    r.findings.filter((f) => f.code === code);

  it("분기마다 유닛 수를 세어 제조사 상한과 비교한다", () => {
    const ok = of(run(qcells), "R070.ok");
    expect(ok.length).toBe(2); // 마이크로인버터 분기 2개
    for (const f of ok) expect(f.message).toContain("10대 ≤ 상한 11대");
    expect(codes(run(qcells))).not.toContain("R070");
  });

  it("상한을 낮추면 같은 구성이 경고로 바뀐다 — 판정이 데이터에서 나온다", () => {
    const tight = patch("qcells-qtron-ac-microinverter", {
      ratings: { max_units_per_branch: 4 },
    });
    const warned = of(run(qcells, EMPTY_SITE, tight), "R070");
    expect(warned.length).toBe(2);
    expect(warned[0]!.severity).toBe("warning");
    expect(warned[0]!.message).toContain("10대");
    expect(warned[0]!.message).toContain("상한은 4대");
    // 경고가 위반한 유닛들을 지목한다 — 어느 분기인지 알 수 없으면 고칠 수 없다.
    expect(warned[0]!.refs.length).toBe(10);
    expect(codes(run(qcells, EMPTY_SITE, tight))).not.toContain("R070.ok");
  });

  it("상한이 미확인인 제품은 통과를 주장하지 않고 보류로 남긴다", () => {
    const r = run(enphase);
    expect(find(r, "R070.1")?.message).toContain("enphase-iq8m");
    expect(codes(r)).not.toContain("R070.ok");
    expect(codes(r)).not.toContain("R070");
  });

  it("AC 분기에 출력하지 않는 장치는 세지 않는다 — 모듈 직렬 수는 다른 문제다", () => {
    // 모듈도 분기 그룹을 갖는다. 그룹이 있는데도 R070이 건드리지 않아야 의미가 있다.
    const grouped = qcells.nodes.filter(
      (n) => n.device === "qcells-qtron-blk-m-g2" && n.group !== null,
    );
    expect(grouped.length).toBeGreaterThan(0);

    const r070 = run(qcells).findings.filter((f) => f.code.startsWith("R070"));
    const said = r070.map((f) => f.message).join("\n");
    expect(said).not.toContain("qcells-qtron-blk-m-g2");
    const refs = r070.flatMap((f) => f.refs);
    for (const n of grouped) expect(refs).not.toContain(n.ref);
  });
});

describe("엔진", () => {
  it("룰 하나가 던져도 나머지 판정은 나온다", () => {
    const boom: Rule = {
      id: "R999",
      title: "터지는 룰",
      code_ref: null,
      verified: false,
      check() {
        throw new Error("의도적 실패");
      },
    };
    const r = runRules(tesla, devices, EMPTY_SITE, [boom, ...RULES]);
    expect(find(r, "R999.threw")?.severity).toBe("error");
    expect(codes(r)).toContain("R010");
  });

  it("error → warning → info 순으로 정렬된다", () => {
    const order = { error: 0, warning: 1, info: 2 } as const;
    for (const t of topologies) {
      const sev = run(t, site({ backup_load_kw: 99, largest_motor_lra: 999 })).findings.map(
        (f) => order[f.severity],
      );
      expect([...sev].sort((a, b) => a - b)).toEqual(sev);
    }
  });

  it("모든 finding이 refs를 갖는다 — 도면에서 지목할 대상이 있어야 한다", () => {
    for (const t of topologies) {
      for (const f of run(t, site({ backup_load_kw: 99, largest_motor_lra: 999 })).findings) {
        expect(`${t.id}/${f.code}: ${f.refs.length}`).not.toBe(`${t.id}/${f.code}: 0`);
      }
    }
  });

  it("refs는 실재하는 노드 ref · 엣지 id · 토폴로지 id만 가리킨다", () => {
    for (const t of topologies) {
      const valid = new Set([
        t.id,
        ...t.nodes.map((n) => n.ref),
        ...t.edges.map((e) => `${e.from}->${e.to}`),
      ]);
      for (const f of run(t, site({ backup_load_kw: 99, largest_motor_lra: 999 })).findings) {
        for (const ref of f.refs) expect(`${f.code}:${ref}`).toBe(`${f.code}:${valid.has(ref) ? ref : "INVALID"}`);
      }
    }
  });

  it("같은 입력이면 같은 결과다", () => {
    for (const t of topologies) expect(runRules(t, devices)).toEqual(runRules(t, devices));
  });

  it("site 스키마를 벗어난 값은 거부된다", () => {
    expect(() => SiteContext.parse({ backup_load_kw: -1 })).toThrow();
    expect(() => SiteContext.parse({ unknown_field: 1 })).toThrow();
  });
});

describe("데이터가 제품이다 — 룰에 제품 지식이 없다", () => {
  const sources = ["rules", "src/rules"].flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ({ f: join(dir, f), text: readFileSync(join(dir, f), "utf8") })),
  );

  it("룰 소스에 벤더/제품명이 등장하지 않는다", () => {
    const banned = /tesla|enphase|qcells|solaredge|powerwall|iq\s?battery|backup switch|meter collar/i;
    for (const { f, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(`${f}: ${banned.test(code) ? code.match(banned)?.[0] : "clean"}`).toBe(`${f}: clean`);
    }
  });

  it("룰 소스에 노드 ref가 하드코딩되어 있지 않다", () => {
    const banned = /["'](?:pw3|msp|collar|comb|batt|micro|svc|bs)["']/;
    for (const { f, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(`${f}: ${banned.test(code) ? code.match(banned)?.[0] : "clean"}`).toBe(`${f}: clean`);
    }
  });
});
