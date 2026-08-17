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
  constructor(scene, leapSource, webcamSource = null) {
    this.scene = scene;
    this.leap = leapSource;
    this.webcam = webcamSource;
    this.controlMode = 'MOUSE';
    this.mountMode = 'desktop';
    this.mouseTool = 'CUT'; // 마우스 모드에서 선택된 도구(상단 토글로 전환)

    this.hands = { right: emptyHand(), left: emptyHand() };

    this._ndc = new THREE.Vector2();
    this._mouseTarget = new THREE.Vector3(0, 0.5, 0);
    this._mouseNormal = new THREE.Vector3(0, 1, 0);
    this._mouseButtons = { cut: false, suture: false };
    this._demoAngle = 0;

    this._bindHandSource(this.leap, 'LEAP');
    if (this.webcam) this._bindHandSource(this.webcam, 'WEBCAM');
    this._bindMouse();
  }

  setControlMode(mode) { this.controlMode = mode; if (mode === 'DEMO') this._demo = null; }
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

  /** 손 트래킹 소스(립모션/웹캠) 프레임을 해당 모드일 때만 반영 */
  _bindHandSource(source, mode) {
    source.on('frame', (frame) => {
      if (this.controlMode !== mode) return;
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
    // 자연스러운 수술 루프: 부위 선정 → 선을 그리며 절개 → 멈춤 → 같은 선을 되짚어 봉합 → 다음 부위
    const now = performance.now() / 1000;
    if (!this._demo) this._demo = { phase: 'CUT', t0: now, center: null, cycles: 0 };
    const d = this._demo;

    // 부위 선정(장기 위에 맞을 때까지 재시도)
    if (!d.center) {
      const ndc = this._ndc.set((Math.random() * 2 - 1) * 0.18, (Math.random() * 2 - 1) * 0.13);
      if (this.scene.raycastOrganFromNDC?.(ndc)) { d.center = ndc.clone(); d.t0 = now; }
      this.hands.right.present = false; this.hands.left.present = false;
      return;
    }

    const CUT_DUR = 3.2, PAUSE = 0.7, SUT_DUR = 6.0;
    const elapsed = now - d.t0;
    const suturing = d.phase === 'SUTURE';

    // 같은 선분을 왕복: 절개는 일정 속도, 봉합은 살짝 넓게 되짚음
    const amp = suturing ? 0.085 : 0.07;
    const sweep = Math.sin(elapsed * 2.0) * amp;
    this._ndc.set(d.center.x + sweep, d.center.y + sweep * 0.2);
    const hit = this.scene.raycastOrganFromNDC?.(this._ndc);

    const slot = suturing ? this.hands.left : this.hands.right;
    const other = suturing ? this.hands.right : this.hands.left;
    if (hit) { slot.target.copy(hit.point); slot.normal.copy(hit.normal); }
    slot.hand = null;
    slot.present = true;
    other.present = false; other.pinch = 0;

    // 단계 진행
    if (d.phase === 'CUT') {
      slot.pinch = hit && elapsed > 0.4 ? 1 : 0; // 조준 후 발사
      if (elapsed > CUT_DUR) { d.phase = 'PAUSE1'; d.t0 = now; }
    } else if (d.phase === 'PAUSE1') {
      slot.pinch = 0;
      if (elapsed > PAUSE) { d.phase = 'SUTURE'; d.t0 = now; }
    } else if (d.phase === 'SUTURE') {
      slot.pinch = hit && elapsed > 0.4 ? 1 : 0;
      if (elapsed > SUT_DUR) { d.phase = 'PAUSE2'; d.t0 = now; }
    } else { // PAUSE2 → 다음 부위
      slot.pinch = 0;
      if (elapsed > PAUSE) {
        d.cycles++;
        d.center = null;
        d.phase = 'CUT';
        if (d.cycles % 4 === 0) this.scene.reset?.(); // 흉터가 쌓이면 주기적으로 새 수술 준비
      }
    }
  }
}
