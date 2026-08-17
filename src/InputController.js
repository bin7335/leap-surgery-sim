import * as THREE from 'three';

/**
 * 입력을 통합해 매 프레임 "양손 명령"을 만든다.
 *   command.hands.right = { target, normal, pinch, hand, present }  // 절개
 *   command.hands.left  = { ... }                                   // 봉합
 *
 * 제어 모드: LEAP(양손 립모션) | MOUSE(폴백) | DEMO(자동 시연)
 * 마운트 모드: desktop | hmd
 *
 * 손이 곧 도구다: 오른손 핀치=절개, 왼손 핀치=봉합.
 */
// 립모션 손 → 화면 좌표(NDC)로 매핑해 마우스처럼 카메라에서 장기 표면을 조준(2.5D).
// 손의 편한 이동 범위(mm)를 화면에 대응하되, GAIN으로 "화면 중앙(장기 영역)"에만 매핑해
// 손을 벌려도 화면 끝까지 가지 않고 양손이 가운데로 모이게 한다.
// 세로축은 앞뒤(palmZ)를 쓴다: 손 높이는 거의 안 변하지만 앞뒤는 잘 움직이기 때문.
const NDC_X = [-140, 140]; // 좌우(mm)
const NDC_Z = [55, 155];   // 앞뒤(mm): 멀리=화면 위, 가까이=화면 아래
const GAIN_X = 0.42;       // 좌우 매핑 폭(클수록 이동 범위 넓음)
const GAIN_Y = 0.75;       // 상하 매핑 폭(클수록 이동 범위 넓음)
const MIRROR_X = false;    // 센서가 뒤집혔을 때만 true

function emptyHand() {
  return { target: new THREE.Vector3(0, 0.5, 0), normal: new THREE.Vector3(0, 1, 0), pinch: 0, hand: null, present: false };
}

export class InputController {
  constructor(scene, leapSource) {
    this.scene = scene;
    this.leap = leapSource;
    this.controlMode = 'MOUSE';
    this.mountMode = 'desktop';
    this.mouseTool = 'CUT'; // 마우스 모드에서 선택된 도구(상단 토글로 전환)

    this.hands = { right: emptyHand(), left: emptyHand() };

    this._ndc = new THREE.Vector2();
    this._mouseTarget = new THREE.Vector3(0, 0.5, 0);
    this._mouseNormal = new THREE.Vector3(0, 1, 0);
    this._mouseButtons = { cut: false, suture: false };
    this._demoAngle = 0;

    this._bindLeap();
    this._bindMouse();
  }

  setControlMode(mode) { this.controlMode = mode; if (mode === 'DEMO') this._demoAngle = 0; }
  setMountMode(mode) { this.mountMode = mode; this.leap.setMode(mode); }
  setMouseTool(tool) { this.mouseTool = tool; }

  /** 립모션 손바닥(px 좌우, pz 앞뒤 mm) → 화면 NDC(-1..1) */
  _leapToNDC(px, pz) {
    const zRaw = this.mountMode === 'hmd' ? -pz : pz;
    let tx = THREE.MathUtils.clamp((px - NDC_X[0]) / (NDC_X[1] - NDC_X[0]), 0, 1);
    const tz = THREE.MathUtils.clamp((zRaw - NDC_Z[0]) / (NDC_Z[1] - NDC_Z[0]), 0, 1);
    if (MIRROR_X) tx = 1 - tx;
    // 좌우는 좁게(양손 모임), 상하는 넓게(앞뒤로 잘 반응). 멀리=위(+y)
    this._ndc.set((tx * 2 - 1) * GAIN_X, (1 - tz * 2) * GAIN_Y);
    return this._ndc;
  }

  _bindLeap() {
    this.leap.on('frame', (frame) => {
      if (this.controlMode !== 'LEAP') return;
      this.hands.right.present = false;
      this.hands.left.present = false;
      for (const h of frame.hands) {
        const slot = h.type === 'left' ? this.hands.left : this.hands.right;
        const ndc = this._leapToNDC(h.palm[0], h.palm[2]);
        const hit = this.scene.resolveFromNDC(ndc);
        if (hit) { slot.target.copy(hit.point); slot.normal.copy(hit.normal); }
        slot.pinch = h.pinch;
        slot.hand = h;
        slot.present = true;
      }
    });
  }

  _bindMouse() {
    window.addEventListener('contextmenu', (e) => { if (this.controlMode === 'MOUSE') e.preventDefault(); });
    window.addEventListener('mousemove', (e) => {
      if (this.controlMode !== 'MOUSE') return;
      this._ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this._ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
      const hit = this.scene.resolveFromNDC(this._ndc);
      if (hit) { this._mouseTarget.lerp(hit.point, 0.5); this._mouseNormal.copy(hit.normal); }
    });
    window.addEventListener('mousedown', (e) => {
      if (this.controlMode !== 'MOUSE') return;
      if (e.button === 0) this._mouseButtons.cut = true;    // 좌클릭 = 절개
      if (e.button === 2) this._mouseButtons.suture = true; // 우클릭 = 봉합
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._mouseButtons.cut = false;
      if (e.button === 2) this._mouseButtons.suture = false;
    });
  }

  update() {
    if (this.controlMode === 'MOUSE') this._buildMouse();
    else if (this.controlMode === 'DEMO') this._buildDemo();
    // LEAP은 프레임 콜백에서 이미 갱신됨
    return { hands: this.hands };
  }

  _buildMouse() {
    // 상단 토글로 선택된 도구를 클릭(아무 버튼)으로 실행
    const firing = this._mouseButtons.cut || this._mouseButtons.suture;
    const isSuture = this.mouseTool === 'SUTURE';
    const slot = isSuture ? this.hands.left : this.hands.right;
    const other = isSuture ? this.hands.right : this.hands.left;
    slot.target.copy(this._mouseTarget);
    slot.normal.copy(this._mouseNormal);
    slot.hand = null;
    slot.present = true;
    slot.pinch = firing ? 1 : 0;
    other.present = false;
    other.pinch = 0;
  }

  _buildDemo() {
    this._demoAngle += 0.008;
    const a = this._demoAngle;
    // 화면 중앙(장기 영역)을 도는 완만한 궤도. 장기에 맞았을 때만 이동 → 장기 밖 배회 방지
    this._ndc.set(Math.sin(a) * 0.2, Math.cos(a * 1.3) * 0.15);
    const hit = this.scene.raycastOrganFromNDC?.(this._ndc);
    // 절개 8초 ↔ 봉합 8초 교대, 핀치는 느긋하게
    const suturePhase = Math.floor(a / 4) % 2 === 1;
    const slot = suturePhase ? this.hands.left : this.hands.right;
    const other = suturePhase ? this.hands.right : this.hands.left;
    if (hit) { slot.target.copy(hit.point); slot.normal.copy(hit.normal); }
    slot.hand = null;
    slot.present = true;
    slot.pinch = hit && Math.sin(a * 2.5) > -0.2 ? 1 : 0;
    other.present = false; other.pinch = 0;
  }
}
