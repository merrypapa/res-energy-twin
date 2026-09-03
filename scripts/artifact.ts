import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 빌드 결과를 파일 하나로 접는다 — Artifact로 배포하기 위해서다.
 *
 * Artifact는 <head>/<body> 골격을 배포 시점에 씌우므로 본문만 낸다.
 * 외부 자산을 부를 수 없는 자리이므로 JS와 CSS를 그대로 인라인한다
 * (데이터 번들은 이미 JS 안에 들어 있다).
 *
 * 사용: npm run artifact   →   dist-artifact/index.html
 */
const DIST = "dist";
const OUT_DIR = "dist-artifact";
const OUT = join(OUT_DIR, "index.html");

const assets = readdirSync(join(DIST, "assets"));
const js = assets.find((f) => f.endsWith(".js"));
const css = assets.find((f) => f.endsWith(".css"));
if (!js) {
  console.error("dist/assets에 JS 번들이 없다. 먼저 npm run build를 돌려라.");
  process.exit(1);
}

const script = readFileSync(join(DIST, "assets", js), "utf8");
const style = css ? readFileSync(join(DIST, "assets", css), "utf8") : "";

/**
 * 인라인 스크립트로 넣기 전에 두 가지를 막는다.
 *
 * 1) `</script`가 문자열 안에 있으면 스크립트가 거기서 끊긴다.
 * 2) 비ASCII 문자는 문자셋 선언이 없는 곳에 실리면 깨진다 — 한글 정규식이
 *    "Range out of order"로 터지는 것을 로컬 검증에서 확인했다.
 *    \uXXXX로 이스케이프하면 어떤 문자셋에서도 같은 코드가 된다.
 */
const safe = script
  .replace(/<\/script/gi, "<\\/script")
  .replace(/[^\x00-\x7F]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);

const html = `<title>Residential Energy System Twin</title>
<style>
html, body { height: 100%; margin: 0; }
${style}
</style>
<div id="root"></div>
<script type="module">
${safe}
</script>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, "utf8");
console.log(`${OUT}  ·  ${(html.length / 1024).toFixed(0)} KB (JS ${(script.length / 1024).toFixed(0)} KB · CSS ${(style.length / 1024).toFixed(0)} KB)`);
