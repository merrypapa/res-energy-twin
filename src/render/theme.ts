/**
 * 도면 스타일 상수.
 *
 * 규칙 (CLAUDE.md §6): 색은 하나의 정보만 나른다 — 활선(live) / 사선(dead).
 * 레이어·회로 종류의 구분은 선 두께와 실선/파선, 라벨로만 한다.
 * 여기에 벤더나 제품별 값은 들어오지 않는다.
 */
export const THEME = {
  /** 도면 배경 — 밝은 중성색. 카드가 아니라 종이다. */
  bg: "#F6F5F2",
  gridMinor: "#E7E4DD",
  gridMajor: "#DAD5CB",
  /** 활선 및 본문 잉크 */
  ink: "#1C1B19",
  /** 보조 텍스트(정격, 도체 라벨). 도체가 아니므로 사선과 혼동되지 않는다. */
  inkSoft: "#5C574F",
  /** 사선(비급전) 도체 — 유일한 두 번째 "색" */
  dead: "#C3BEB3",
  rule: "#B9B3A7",
  /** 타이포는 1패밀리. 도체 라벨에도 모노스페이스를 쓰지 않는다. */
  font: "'Inter', 'Helvetica Neue', Arial, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
} as const;

export const GEO = {
  nodeW: 176,
  /** 배열 노드(모듈·마이크로인버터) 폭. 20장이 한 랭크에 들어가려면 좁아야 한다. */
  arrayNodeW: 88,
  /** 배열 노드끼리의 간격 */
  arrayColGap: 14,
  /** 배열 블록을 접는 최대 열 수. 넘으면 아래 행으로 넘어간다 */
  arrayMaxCols: 10,
  /** 블록 안 행 간격 */
  arrayRowGap: 34,
  /** 세로로 짝지어진 두 노드(모듈 위 / 인버터 아래) 사이 간격 */
  stackGap: 26,
  /** 블록에서 빠져나가는 도체가 타고 내려가는 우측 레인 */
  laneGap: 26,
  nodeH: 88,
  colGap: 40,
  rankGap: 60,
  margin: 32,
  /** 통신 배선이 노드 우측으로 빠져나가는 거리 */
  commsStub: 16,
  glyphH: 38,
  /** 노드 상자 상단에서 심볼 중심까지 */
  glyphCy: 22,
  fontLabel: 13,
  fontMeta: 11,
  fontEdge: 11,
} as const;

export const STROKE = {
  power: 2.4,
  comms: 1.2,
  physical: 1.2,
  symbol: 1.5,
} as const;
