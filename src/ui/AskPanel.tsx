import { useEffect, useRef, useState } from "react";
import { ASK_INSTRUCTION } from "../analysis/brief.js";
import { HIDE_CODES, loadSample, sampleErrorText, type SampleFn } from "./claude-runtime.js";

/**
 * 지금 화면에 대해 묻는 자리.
 *
 * 질문과 함께 넘어가는 것은 **이 화면의 브리프**다 — 검증을 통과한 데이터와 엔진이
 * 계산한 값, 그리고 아직 확인되지 않은 것들. 답은 그 근거 위에서만 나오게 하고,
 * 화면에는 "AI가 쓴 글이며 검증된 판단이 아니다"라고 함께 적는다.
 *
 * Artifact 뷰어 밖(GitHub Pages 등)에서는 물을 통로가 없다. 그때는 브리프를 복사해
 * 사용자가 직접 붙여넣게 한다 — 기능을 숨기는 대신 다음 행동을 준다.
 */
const PRESETS = [
  "이 구성이 이 집에 성립하는지, 걸리는 판정부터 짚어줘",
  "지금 고른 지점의 신호가 왜 이렇게 나오는지 설명해줘",
  "이 구성에서 가장 먼저 확인해야 할 미확인 값은 무엇인가",
  "정전이 나면 이 구성에서 무엇이 살아 있고 무엇이 죽는가",
];

export function AskPanel({ brief, onClose }: { brief: string; onClose: () => void }) {
  const [sample, setSample] = useState<SampleFn | null>(null);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const control = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void loadSample().then((fn) => {
      if (!alive) return;
      setSample(() => fn);
      setReady(true);
    });
    return () => {
      alive = false;
      control.current?.abort();
    };
  }, []);

  const ask = async (text: string) => {
    if (!sample || text.trim() === "") return;
    control.current?.abort();
    const ctl = new AbortController();
    control.current = ctl;
    setBusy(true);
    setAnswer("");
    setStatus("생각하는 중…");
    try {
      await sample(`${ASK_INSTRUCTION}\n\n---\n\n${brief}\n\n---\n\n질문: ${text}`, {
        signal: ctl.signal,
        onText: ({ text: whole }) => {
          setStatus(null);
          setAnswer(whole);
        },
      });
      setStatus(null);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "upstream_error";
      const partial = (e as { text?: string }).text;
      setAnswer(partial ?? "");
      setStatus(sampleErrorText(code) || null);
      if (HIDE_CODES.has(code)) setHidden(true);
    } finally {
      setBusy(false);
    }
  };

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(`${ASK_INSTRUCTION}\n\n---\n\n${brief}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus("복사에 실패했다. 아래 글을 직접 선택해 복사해라.");
    }
  };

  const available = ready && sample !== null && !hidden;

  return (
    <section className="ask">
      <header className="inspector-head">
        <div>
          <h2>AI에게 묻기</h2>
          <p className="sub">지금 화면의 구성 · 계산 · 판정을 근거로 답한다</p>
        </div>
        <button type="button" className="toggle" onClick={onClose}>
          닫기
        </button>
      </header>

      {!ready && <p className="empty">준비 중…</p>}

      {ready && !available && (
        <div className="group">
          <p>
            이 배포에서는 화면 안에서 직접 물을 수 없다. 아래 버튼으로 브리프를 복사해
            Claude에 붙여넣으면 같은 근거로 답을 받을 수 있다.
          </p>
          <p className="hint">
            Artifact로 배포된 화면에서는 이 자리에서 바로 묻는다 — 그때는 보는 사람의 Claude
            계정으로 처리되며 별도 API 키가 필요 없다.
          </p>
          <button type="button" className="preset" onClick={copyBrief}>
            {copied ? "복사했다" : "브리프 복사"}
          </button>
        </div>
      )}

      {available && (
        <div className="group">
          <div className="toggle-row">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className="toggle"
                disabled={busy}
                onClick={() => {
                  setQuestion(p);
                  void ask(p);
                }}
              >
                {p.length > 22 ? `${p.slice(0, 22)}…` : p}
              </button>
            ))}
          </div>

          <label className="field">
            <span>질문</span>
            <textarea
              rows={3}
              value={question}
              placeholder="예: 이 구성에서 백업 부하를 12kW로 잡으면 무엇이 걸리나?"
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>

          <div className="toggle-row">
            <button type="button" className="toggle" data-on={!busy} disabled={busy} onClick={() => void ask(question)}>
              묻기
            </button>
            <button type="button" className="toggle" disabled={!busy} onClick={() => control.current?.abort()}>
              중지
            </button>
            <button type="button" className="toggle" onClick={copyBrief}>
              {copied ? "복사했다" : "브리프 복사"}
            </button>
          </div>
          <p className="hint">
            보는 사람의 Claude 계정으로 처리된다. 첫 질문에서 허용을 한 번 묻는다.
          </p>
        </div>
      )}

      {(status || answer) && (
        <div className="group">
          {status && <p className="hint">{status}</p>}
          {answer && <div className="answer">{answer}</div>}
          {answer && (
            <p className="disclaimer">
              AI가 이 화면의 브리프를 근거로 쓴 글이다. 검증된 공학 판단이 아니며, 제품 정격과
              코드 조항은 원문 대조 전이다.
            </p>
          )}
        </div>
      )}

      <details className="group brief">
        <summary className="hint">넘어가는 브리프 보기</summary>
        <pre>{brief}</pre>
      </details>
    </section>
  );
}
