/** SVG 텍스트 유틸. 폰트 메트릭이 없으므로 문자 폭을 근사한다. */

const WIDE = /[ᄀ-ᇿ⺀-鿿가-힯！-｠]/;

export function textWidth(s: string, fontSize: number): number {
  let units = 0;
  for (const ch of s) units += WIDE.test(ch) ? 1 : 0.54;
  return units * fontSize;
}

/** 공백 우선, 안 되면 글자 단위로 끊는다(한글은 공백이 적다). */
export function wrap(s: string, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.length > 0) lines.push(cur);
    cur = "";
  };
  for (const token of s.split(/(\s+)/)) {
    if (lines.length >= maxLines) break;
    if (textWidth(cur + token, fontSize) <= maxWidth) {
      cur += token;
      continue;
    }
    if (textWidth(token, fontSize) <= maxWidth) {
      flush();
      cur = token.trimStart();
      continue;
    }
    for (const ch of token) {
      if (textWidth(cur + ch, fontSize) > maxWidth) {
        flush();
        if (lines.length >= maxLines) break;
      }
      cur += ch;
    }
  }
  flush();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${(kept[maxLines - 1] ?? "").slice(0, -1)}…`;
    return kept;
  }
  return lines.map((l) => l.trim()).filter((l) => l.length > 0);
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
