import { LeapSource } from './LeapSource.js';

/**
 * 하드웨어 없이 애니메이션된 "조작 명령"을 방출한다.
 * 로봇수술 콘셉트에서는 손 스켈레톤 전체가 아니라 손바닥 위치 + 핀치만 있으면
 * 로봇팔을 구동할 수 있으므로, 그에 맞춰 가벼운 가짜 손 하나를 생성한다.
 *
 * 좌표는 실제 립모션(mm, Y 위쪽) 스케일과 대략 맞춰, 나중에 WebSocketLeapSource로
 * 교체해도 입력 매핑을 재사용할 수 있게 한다.
 */
export class MockLeapSource extends LeapSource {
  constructor() {
    super();
    this._raf = 0;
    this._t0 = 0;
  }

  connect() {
    this._emit('status', 'mock');
    this._t0 = performance.now();
    const loop = (now) => {
      const t = (now - this._t0) / 1000;
      // 손바닥이 부드럽게 원을 그리며 이동, 주기적으로 핀치
      const palm = [
        Math.sin(t * 0.7) * 55,
        150 + Math.sin(t * 1.1) * 20,
        Math.cos(t * 1.05) * 30,
      ];
      const pinch = Math.sin(t * 4) > 0.5 ? 1 : 0;
      const fingers = [0, 1, 2, 3, 4].map((type) => this._buildFinger(type, palm, pinch));
      this._emit('frame', {
        timestamp: t,
        hands: [{ type: 'right', palm, grab: pinch, pinch, fingers }],
      });
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
  }

  // 손가락 하나: 손바닥에서 부챗살처럼 벌어져 +z로 뻗고, 핀치 시 안쪽으로 말림
  _buildFinger(type, palm, pinch) {
    const spread = (type - 2) * 20; // 가운데 기준 좌우
    const lengths = [55, 78, 82, 76, 62];
    const len = lengths[type];
    const baseX = palm[0] + spread;
    const baseZ = palm[2] + 12;
    const curlAmt = type === 0 || type === 1 ? pinch : pinch * 0.3; // 엄지·검지가 핀치에 크게 반응
    const joints = [];
    for (const s of [0, 0.25, 0.55, 0.8, 1.0]) {
      const curl = curlAmt * s * s;
      joints.push([
        baseX + spread * 0.15 * s - (type === 0 ? curl * 25 : 0),
        palm[1],
        baseZ + len * s * (1 - curl * 0.7),
      ]);
    }
    return { type, joints };
  }
}
