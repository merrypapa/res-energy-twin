import type { Device } from "../schema/device.js";
import { specRows, type SpecSheet } from "../analysis/spec.js";

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
