import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages는 <user>.github.io/<repo>/ 하위에 붙는다.
 * base를 환경변수로 받아 CI가 리포 이름을 넘긴다 — 이름이 바뀌어도 코드는 그대로다.
 */
export default defineConfig({
  base: process.env.PAGES_BASE ?? "/",
  root: ".",
  build: { outDir: "dist", emptyOutDir: true },
});
