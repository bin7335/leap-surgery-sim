// 립모션 손 데이터의 정규화된 형태 정의.
// 어떤 소스(목/웹소켓)든 이 형태로 프레임을 방출해 렌더러가 소스에 무관하게 동작하도록 한다.

// 손가락 종류 (Leap 규약)
export const FINGER = {
  THUMB: 0,
  INDEX: 1,
  MIDDLE: 2,
  RING: 3,
  PINKY: 4,
};

// 한 손가락의 관절 순서 (손목쪽 → 끝). 렌더러가 이 순서로 뼈대를 잇는다.
// [ wrist(=carp/mcp 근처), mcp, pip, dip, tip ]
export const JOINTS_PER_FINGER = 5;

/**
 * @typedef {Object} NormFinger
 * @property {number} type   - FINGER 값
 * @property {number[][]} joints - 관절 좌표 배열 (Leap mm 기준, [x,y,z] × 5)
 */

/**
 * @typedef {Object} NormHand
 * @property {'left'|'right'} type
 * @property {number[]} palm  - 손바닥 중심 [x,y,z] (mm)
 * @property {number} grab    - 주먹 강도 0~1
 * @property {number} pinch   - 핀치 강도 0~1
 * @property {NormFinger[]} fingers
 */

/**
 * @typedef {Object} NormFrame
 * @property {number} timestamp
 * @property {NormHand[]} hands
 */

export const EMPTY_FRAME = { timestamp: 0, hands: [] };
