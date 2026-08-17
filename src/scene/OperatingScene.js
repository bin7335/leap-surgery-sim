import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// BVH 가속 레이캐스트(세분화된 고밀도 메시에서도 조준이 빠르게)
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
import { Tissue } from './Tissue.js';
import { Vfx } from './Vfx.js';
import { HandGhost } from './HandGhost.js';
import { ModelField } from './ModelField.js';
import { Deformer } from './Deformer.js';
import { addDressing } from './Dressing.js';

/**
 * 수술 장면: 렌더러/카메라/조명/해부구조/양손(도구)/VFX.
 * 손이 곧 도구다 — 오른손 핀치=절개, 왼손 핀치=봉합.
 */
export class OperatingScene {
  constructor(canvas) {
    this._raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._audioCtx = null;
    this._lastAction = { CUT: 0, SUTURE: 0 };
    this._lastPt = { CUT: null, SUTURE: null }; // 스트로크 보간용 직전 적용 지점

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x9db9c8, 0.02);
    scene.background = new THREE.Color(0x9db9c8);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 6.5, 6.5);
    this.camera.lookAt(0, -0.5, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 고DPI 렌더 부하 절감
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    scene.add(new THREE.HemisphereLight(0xffffff, 0xbfd8e8, 0.35));
    const spot = new THREE.SpotLight(0xffffff, 2.8);
    spot.position.set(0, 12, 1);
    spot.angle = Math.PI / 3;
    spot.penumbra = 0.6;
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024); // 그림자 해상도 절반(부하 절감, 체감 차이 미미)
    spot.shadow.bias = -0.0005;
    scene.add(spot);
    const s1 = new THREE.PointLight(0x9ad7ff, 0.4, 18); s1.position.set(5, 3, 3); scene.add(s1);
    const s2 = new THREE.PointLight(0xffd9c2, 0.4, 18); s2.position.set(-5, 3, -3); scene.add(s2);

    this.tissue = new Tissue(scene);
    this.surgeryMesh = this.tissue.mesh; // 레이캐스트 대상(모델 로드 시 교체)
    this.vfx = new Vfx(scene);
    this.deformer = new Deformer(); // 실제 메시 변형(갈라짐/아뭄)
    this.handRight = new HandGhost(scene, 'right', this.camera); // 절개
    this.handLeft = new HandGhost(scene, 'left', this.camera);   // 봉합

    addDressing(scene); // 수술대 + 수술포(개창) — 수술 장면 연출

    this._fieldBounds = null; // 수술 영역(장기)의 XZ 바운딩 캐시
    this._tryLoadModel();
    this.resize();
  }

  /** 수술 영역(현재 레이캐스트 대상 메시)의 XZ 바운딩 — 2.5D 손 매핑에 사용 */
  getFieldBounds() {
    if (!this._fieldBounds) {
      const box = new THREE.Box3().setFromObject(this.surgeryMesh);
      // 가장자리까지 손이 편하게 닿도록 살짝 여유(margin)
      const mx = (box.max.x - box.min.x) * 0.08;
      const mz = (box.max.z - box.min.z) * 0.08;
      this._fieldBounds = { minX: box.min.x + mx, maxX: box.max.x - mx, minZ: box.min.z + mz, maxZ: box.max.z - mz };
    }
    return this._fieldBounds;
  }

  /** public/models/organ.glb 가 있으면 사실적 모델로 교체(없으면 절차적 유지) */
  _tryLoadModel() {
    ModelField.load().then(({ root, surgeryMesh }) => {
      this.scene.add(root);
      if (surgeryMesh) {
        // (세분화는 이 모델의 UV와 충돌해 격자 아티팩트 발생 → 미적용.
        //  절개면 품질은 스트로크 보간 + 법선 갱신 주기로 확보)
        surgeryMesh.geometry.computeBoundsTree(); // BVH로 레이캐스트 가속
        this.surgeryMesh = surgeryMesh;
        this._addInnerLayer(surgeryMesh); // 절개 시 드러날 내부 조직층
      }
      this.tissue.setProceduralVisible(false); // 절차적 장기 전체 숨김
      this._fieldBounds = null; // 모델 기준으로 영역 재계산
      console.info('[scene] 사실적 모델 로드됨');
    }).catch(() => { /* 파일 없음 → 절차적 Tissue 유지 */ });
  }

  /**
   * 내부 조직층: 외벽 메시를 법선 방향 안쪽으로 수축 복제한 붉은 층.
   * 절개 깊이가 외벽 두께(월드 ~0.08)를 넘으면 이 층이 노출되어 "속이 열린" 것처럼 보인다.
   */
  _addInnerLayer(mesh) {
    const geo = mesh.geometry.clone();
    geo.deleteAttribute('color'); // 외벽의 흉터 색과 무관하게
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    // 로드 직후엔 matrixWorld가 아직 계산 전이라 스케일이 틀어진다 → 먼저 갱신
    this.scene.updateMatrixWorld(true);
    const worldScale = new THREE.Vector3().setFromMatrixColumn(mesh.matrixWorld, 0).length() || 1;
    let dLocal = 0.08 / worldScale; // 월드 기준 0.08 안쪽
    geo.computeBoundingBox();
    const diag = geo.boundingBox.getSize(new THREE.Vector3()).length();
    dLocal = Math.min(dLocal, diag * 0.015); // 과도한 수축(뒤집힘) 방지 상한
    const orig = new Float32Array(pos.array); // 방향 검증 실패 시 재적용용

    const applyOffset = (sign) => {
      for (let i = 0; i < pos.count; i++) {
        const ix = i * 3;
        const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
        const nl = Math.hypot(nx, ny, nz) || 1; // 법선 정규화(비정규 익스포트 대비)
        const k = (dLocal * sign) / nl;
        pos.setXYZ(i, orig[ix] - nx * k, orig[ix + 1] - ny * k, orig[ix + 2] - nz * k);
      }
    };

    // 법선 방향이 반대인 모델이면 "안쪽 수축"이 "바깥 팽창"이 된다 → 크기 비교로 감지해 뒤집기
    applyOffset(1);
    geo.computeBoundingBox();
    const newSize = geo.boundingBox.getSize(new THREE.Vector3()).length();
    if (newSize > diag) applyOffset(-1); // 커졌다 = 바깥으로 나갔다 → 반대로
    const inner = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x9c3030, roughness: 0.65, // 붉은 근육/점막 조직 느낌
      side: THREE.DoubleSide, // 절개로 외벽이 파이면 가까운 내부면(붉은 바닥)이 오목하게 보임
    }));
    inner.position.copy(mesh.position);
    inner.quaternion.copy(mesh.quaternion);
    inner.scale.copy(mesh.scale);
    inner.receiveShadow = true;
    mesh.parent.add(inner);
  }

  resolveFromNDC(ndc) {
    this._raycaster.setFromCamera(ndc, this.camera);
    return this._raycastSurface();
  }

  /** 장기 메시에만 맞는 레이캐스트(바닥 폴백 없음) — 종양 배치 등 정확한 표면 지정용 */
  raycastOrganFromNDC(ndc) {
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObject(this.surgeryMesh);
    if (!hits.length) return null;
    const n = (hits[0].face?.normal ?? new THREE.Vector3(0, 1, 0)).clone()
      .transformDirection(this.surgeryMesh.matrixWorld); // 로컬 법선 → 월드
    return { point: hits[0].point, normal: n };
  }

  resolveFromGround(x, z) {
    this._raycaster.set(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
    return this._raycastSurface() || { point: new THREE.Vector3(x, 0.5, z), normal: new THREE.Vector3(0, 1, 0) };
  }

  _raycastSurface() {
    const hits = this._raycaster.intersectObject(this.surgeryMesh);
    if (hits.length > 0) return { point: hits[0].point, normal: hits[0].face?.normal ?? new THREE.Vector3(0, 1, 0) };
    const p = new THREE.Vector3();
    if (this._raycaster.ray.intersectPlane(this._groundPlane, p)) return { point: p, normal: new THREE.Vector3(0, 1, 0) };
    return null;
  }

  /** @param {{right:object,left:object}} hands InputController 명령 */
  update(hands) {
    const now = performance.now();
    let result = null;
    result = this._handTool(this.handRight, hands.right, 'CUT', now) || result;
    result = this._handTool(this.handLeft, hands.left, 'SUTURE', now) || result;
    this.vfx.update();
    this.renderer.render(this.scene, this.camera);
    return result; // { tool, progress } | null
  }

  _handTool(ghost, h, tool, now) {
    ghost.update(h.hand, h.target, h.pinch, h.present, h.normal);
    if (h.present && h.pinch > 0.85 && now - this._lastAction[tool] > 16) {
      this._lastAction[tool] = now;
      this.vfx.emit(h.target, tool);
      this._playSound(tool === 'CUT' ? 'laser_cut' : 'laser_suture');
      const apply = (p) => (tool === 'CUT' ? this.deformer.cut(this.surgeryMesh, p) : this.deformer.suture(this.surgeryMesh, p));
      // 스트로크 보간: 빠르게 움직여도 절개선이 점점이 아니라 연속으로 이어지게
      const last = this._lastPt[tool];
      if (last) {
        const d = last.distanceTo(h.target);
        if (d > 0.1 && d < 2.0) {
          const n = Math.min(6, Math.floor(d / 0.1));
          for (let k = 1; k <= n; k++) apply(last.clone().lerp(h.target, k / (n + 1)));
        }
      }
      apply(h.target);
      this._lastPt[tool] = h.target.clone();
      // 진행률 + 봉합 바늘땀(overlay)은 Tissue가 담당(절개선 그림은 제거됨)
      return { tool, progress: this.tissue.surgery(h.target, tool, h.normal), point: h.target.clone() };
    }
    if (!h.present || h.pinch <= 0.85) this._lastPt[tool] = null; // 스트로크 끊김
    return null;
  }

  _playSound(type) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this._audioCtx) this._audioCtx = new AC();
    const ctx = this._audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === 'laser_cut') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(150, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
    }
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
  }

  reset() { this.tissue.reset(); this.deformer.reset(this.surgeryMesh); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
