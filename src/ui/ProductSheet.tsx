import { useState } from "react";
import type { Device } from "../schema/device.js";
import { specRows, type SpecSheet } from "../analysis/spec.js";
import { renderInternals } from "../render/internals.js";

/**
 * 구성에 들어간 제품 요약 — 스펙과 데이터시트 링크.
 *
 * 값은 device-library에서 그대로 나온다. 여기서 단위를 바꾸거나 빈 값을 채우지 않는다.
 * 링크는 sources의 url이다 — 출처 없는 숫자는 애초에 커밋되지 않으므로,
 * 링크가 없다는 것은 출처에 url이 안 적혔다는 뜻이다.
 */
export function ProductSheets({ sheets }: { sheets: SpecSheet[] }) {
  return (
    <section className="products">
      <h2>구성 제품</h2>
      {sheets.map((s) => (
        <ProductCard key={s.device.id} device={s.device} units={s.units} />
      ))}
    </section>
  );
}

export function ProductCard({ device, units }: { device: Device; units?: number }) {
  const rows = specRows(device);
  return (
    <article className="product">
      <h3>
        {device.display_name}
        {units !== undefined && units > 1 && <span className="sub"> × {units}</span>}
      </h3>
      <p className="sub">
        {device.vendor} · {device.class}
        {device.status === "draft" && " · draft — 대외 인용 금지"}
      </p>

      {rows.length > 0 ? (
        <table className="readout">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th>{r.label}</th>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty">확인된 정격이 없다.</p>
      )}

      <Internals device={device} />

      {device.sources.length > 0 && (
        <ul className="plain sources">
          {device.sources.map((src) => (
            <li key={src.ref}>
              {src.url ? (
                <a href={src.url} target="_blank" rel="noreferrer noopener">
                  {src.ref}
                </a>
              ) : (
                src.ref
              )}
              {src.date && <span className="sub"> · 확인 {src.date}</span>}
              {src.note && <span className="note-text"> {src.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {device.todos.length > 0 && (
        <ul className="plain watch">
          {device.todos.map((t) => (
            <li key={t}>확인 필요 — {t}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

/**
 * 함체 내부 구성. 단선도에는 한 상자로 그려지는 것의 안쪽이다.
 *
 * 접어 둔다 — 단선도를 읽으러 온 화면에서 내부 블록이 먼저 눈에 들어오면 안 된다.
 * 내부 구조가 기재되지 않은 제품에는 아무것도 그리지 않는다(빈 상자를 만들지 않는다).
 */
function Internals({ device }: { device: Device }) {
  const [open, setOpen] = useState(false);
  const internals = device.internals;
  if (internals === null) return null;
  const svg = renderInternals(device);
  if (svg === null) return null;

  return (
    <div className="internals">
      <button type="button" className="toggle" data-on={open} onClick={() => setOpen((p) => !p)}>
        {open ? "함체 내부 접기" : `함체 내부 (${internals.blocks.length}블록)`}
      </button>
      {open && (
        <>
          <div className="internals-sheet" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="sub">
            읽기 위한 기술이다 — 전력 조류와 코드 판정은 이 구조를 보지 않는다.
          </p>
          {internals.sources.length > 0 && (
            <ul className="plain sources">
              {internals.sources.map((src) => (
                <li key={src.ref}>
                  {src.url ? (
                    <a href={src.url} target="_blank" rel="noreferrer noopener">
                      {src.ref}
                    </a>
                  ) : (
                    src.ref
                  )}
                  {src.date && <span className="sub"> · 확인 {src.date}</span>}
                  {src.note && <span className="note-text"> {src.note}</span>}
                </li>
              ))}
            </ul>
          )}
          {internals.todos.length > 0 && (
            <ul className="plain watch">
              {internals.todos.map((t) => (
                <li key={t}>확인 필요 — {t}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
