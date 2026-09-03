/**
 * Artifact 런타임의 `claude.use("sample")`만 얇게 감싼다.
 *
 * 이 페이지는 두 곳에 배포된다. Artifact 뷰어 안에서는 뷰어 본인의 Claude 계정으로
 * 질문할 수 있고, GitHub Pages 같은 정적 배포에서는 그런 통로가 없다.
 * **없는 것이 정상이다** — 없으면 기능을 숨기고, 대신 브리프를 복사해 가게 한다.
 * (런타임 계약: window.claude에는 use만 약속돼 있다. 다른 멤버를 읽지 않는다.)
 */
export interface SampleOptions {
  onText?: (chunk: { text: string; delta: string }) => void;
  signal?: AbortSignal;
  modelTier?: "quick" | "default" | "complex";
  cache?: boolean;
}

export type SampleFn = (
  input: string,
  options?: SampleOptions,
) => Promise<{ text: string; truncated: boolean }>;

interface ClaudeGlobal {
  use?: (name: string) => Promise<unknown>;
}

/** 이 화면에서 Claude에게 물을 수 있으면 함수를, 아니면 null을 준다. */
export async function loadSample(): Promise<SampleFn | null> {
  const claude = (globalThis as { claude?: ClaudeGlobal }).claude;
  if (!claude || typeof claude.use !== "function") return null;
  try {
    const ns = await claude.use("sample");
    return typeof ns === "function" ? (ns as SampleFn) : null;
  } catch {
    return null;
  }
}

/** 실패 코드 → 화면에 쓸 말. 코드로만 분기한다(메시지 문구로 분기하지 않는다). */
export function sampleErrorText(code: string): string {
  switch (code) {
    case "not_granted":
      return "이 아티팩트가 Claude를 쓰도록 허용되지 않았다. 질문 기능을 숨긴다.";
    case "sampling_disabled":
    case "not_declared":
    case "capability_disabled":
    case "capability_removed":
      return "이 화면에서는 Claude에게 물을 수 없다.";
    case "rate_limited":
      return "요청이 몰렸거나 사용량 한도에 걸렸다. 잠시 뒤 다시 눌러라.";
    case "session_expired":
      return "Claude 세션이 만료됐다. 다시 로그인한 뒤 시도해라.";
    case "prompt_too_large":
      return "브리프가 너무 길다. 노드를 하나만 고르거나 비교 구성을 줄여라.";
    case "refused":
      return "이 입력에는 답하지 않았다. 질문을 바꿔서 다시 물어라.";
    case "empty_completion":
      return "답이 비어 돌아왔다. 질문을 더 좁혀라.";
    case "cancelled":
      return "";
    default:
      return "답을 받지 못했다. 잠시 뒤 다시 시도해라.";
  }
}

/** 하이드 대상 — 이 코드가 나오면 기능 자체를 접는다. */
export const HIDE_CODES = new Set([
  "not_granted",
  "sampling_disabled",
  "not_declared",
  "capability_disabled",
  "capability_removed",
]);
