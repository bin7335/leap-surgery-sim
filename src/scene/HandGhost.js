import * as THREE from 'three';

const S = 0.02;      // 립모션 mm → 씬 유닛
// 손끝이 조준점 기준 이 오프셋에 "항상" 오도록 앵커링 → 양손 빔이 동일/일관.
const HOVER = 0.35;  // 조준점에서 카메라 쪽(작을수록 표면에 가까움)
const OFF_X = 0.65;  // 손끝을 조준점 오른쪽으로 → 빔이 왼쪽으로
const OFF_Y = 0.65;  // 손끝을 조준점 아래로 → 빔이 위로 (OFF_X≈OFF_Y → 45° 대각선)
const AIM_GREEN = 0x2fff77;
const PINCH_FIRE = 0.85; // 이 이상 확실히 집어야 레이저 발사(약한 핀치 무시)

/**
 * 로봇 손(메탈릭 링크 + 발광 관절) + 조준 가이드(수직 가이드선 + 표면 레티클) + 레이저.
 * 손이 곧 도구다: 오른손=절개(빨강), 왼손=봉합(파랑). 핀치하면 레이저 발사.
 *
 * 조준 보정: 손은 표적 바로 위에 뜨고, 손 중심에서 표면 표적까지 수직 가이드선과
 * 레티클(표적 링)을 그려 "어디가 잘릴지"를 명확히 보여준다.
 */
export class HandGhost {
  constructor(scene, side /* 'right'|'left' */, camera) {
    this.side = side;
    this.camera = camera;
    this.tool = side === 'right' ? 'CUT' : 'SUTURE';
    this.hue = side === 'right' ? 0xff5a7a : 0x5ad1ff;

    this.group = new THREE.Group();
    this.group.rotation.x = 0.5;
    this.group.scale.setScalar(0.6); // 장기 대비 적당한 크기
    scene.add(this.group);

    this.metal = new THREE.MeshStandardMaterial({ color: 0xc2ccd6, metalness: 0.85, roughness: 0.35 });
    this.accent = new THREE.MeshStandardMaterial({ color: this.hue, emissive: this.hue, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 });

    // 손바닥 플레이트
    this.palm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.55), this.metal);
    this.group.add(this.palm);

    // 손가락 뼈대(원통) 풀: 5손가락 × 4뼈 = 20
    this._boneGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 8);
    this.bones = [];
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(this._boneGeo, this.metal);
      m.visible = false;
      this.group.add(m);
      this.bones.push(m);
    }
    // 관절 구슬(발광 액센트): 25 + 손바닥1
    this.joints = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 10, 10), this.accent, 26);
    this.group.add(this.joints);

    // 표적 레티클(링 + 십자) — 월드 공간
    this.reticle = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.18, 32),
      new THREE.MeshBasicMaterial({ color: this.hue, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })
    );
    const crossMat = new THREE.MeshBasicMaterial({ color: this.hue, transparent: true, opacity: 0.9, depthTest: false });
    const barA = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.015), crossMat);
    const barB = new THREE.Mesh(new THREE.PlaneGeometry(0.015, 0.28), crossMat);
    this.reticle.add(ring, barA, barB);
    this.reticle.renderOrder = 999;
    this.reticle.visible = false;
    scene.add(this.reticle);

    // 수직 가이드선(점선) — 손 중심 → 표적
    this.guideGeo = new THREE.BufferGeometry();
    this.guideGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
    this.guide = new THREE.Line(this.guideGeo, new THREE.LineDashedMaterial({
      color: this.hue, transparent: true, opacity: 0.5, dashSize: 0.12, gapSize: 0.08, depthTest: false,
    }));
    this.guide.renderOrder = 998;
    this.guide.visible = false;
    scene.add(this.guide);

    // 레이저 빔(핀치 시) + 접촉 글로우
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 1, 8), // 얇은 레이저
      new THREE.MeshBasicMaterial({ color: this.hue, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthTest: false })
    );
    this.beam.visible = false;
    scene.add(this.beam);
    this.hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 16),
      new THREE.MeshBasicMaterial({ color: this.hue, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
    );
    this.hit.visible = false;
    scene.add(this.hit);
    this.hitLight = new THREE.PointLight(this.hue, 0, 3);
    scene.add(this.hitLight);

    this._m = new THREE.Matrix4();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._tip = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._upv = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._q = new THREE.Quaternion();
    this._sideSign = 1; // 양손 모두 오른쪽-아래 배치 → 빔이 왼쪽 위로, 두 손이 벌어지지 않음
  }

  /**
   * @param {object|null} hand 정규화 손(fingers 포함) 또는 null → 합성
   * @param {THREE.Vector3} target 조직 표면 목표점
   * @param {number} pinch 0~1
   * @param {boolean} present 이 손이 인식 중인지
   * @param {THREE.Vector3} normal 표면 법선(레티클 방향)
   */
  update(hand, target, pinch, present, normal) {
    this.group.visible = present;
    this.reticle.visible = present;
    this.guide.visible = present;
    if (!present) { this.beam.visible = false; this.hit.visible = false; this.hitLight.intensity = 0; return; }

    const fingers = (hand && hand.fingers && hand.fingers.length) ? this._fromHand(hand) : this._synthesize(pinch);
    // 손끝이 조준점 기준 "일정 오프셋"에 항상 오도록 앵커링 → 양손 빔이 동일/일관
    this._dir.copy(this.camera.position).sub(target).normalize();
    this._right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this._upv.setFromMatrixColumn(this.camera.matrixWorld, 1);
    const desiredTip = this._a.copy(target)
      .addScaledVector(this._dir, HOVER)
      .addScaledVector(this._right, OFF_X * this._sideSign)
      .addScaledVector(this._upv, -OFF_Y);
    const idx = fingers[1];
    // 그룹을 원점에 두고 손끝의 월드 오프셋을 구해, 손끝이 desiredTip에 오도록 역산 배치
    this.group.position.set(0, 0, 0);
    this.group.updateMatrixWorld(true);
    const fOff = this._tip.copy(idx[idx.length - 1]);
    this.group.localToWorld(fOff);
    this.group.position.copy(desiredTip).sub(fOff);
    this.group.updateMatrixWorld(true);
    const tip = desiredTip;

    // 뼈대(원통) 배치 + 관절 구슬
    let bi = 0, ji = 0;
    this.joints.setMatrixAt(ji++, this._m.makeTranslation(0, 0.06, 0)); // 손바닥
    for (const f of fingers) {
      for (let k = 0; k < f.length; k++) {
        this.joints.setMatrixAt(ji++, this._m.makeTranslation(f[k].x, f[k].y, f[k].z));
        if (k < f.length - 1) this._orientBone(this.bones[bi++], f[k], f[k + 1]);
      }
    }
    for (; bi < this.bones.length; bi++) this.bones[bi].visible = false;
    this.joints.instanceMatrix.needsUpdate = true;

    // (tip = desiredTip, 이미 위에서 앵커링됨)
    const active = pinch > PINCH_FIRE;
    const col = active ? this.hue : AIM_GREEN;

    // 레이저 빔: 항상 표시(조준=초록), 핀치 시 도구색(빨강/파랑)으로 발사
    this.beam.visible = true;
    this._orientBone(this.beam, tip, target);
    this.beam.scale.x = this.beam.scale.z = active ? 1 : 0.55; // 조준 빔은 얇게
    this.beam.material.color.setHex(col);
    this.beam.material.opacity = active ? 0.95 : 0.7;

    // 조준 레티클(표면) — 조준 초록 → 발사 도구색
    this.reticle.position.copy(target);
    if (normal) this.reticle.quaternion.setFromUnitVectors(this._up, normal);
    this.reticle.children.forEach((c) => c.material.color.setHex(col));
    this.reticle.scale.setScalar(active ? 1.25 : 1.0);

    // 접촉 글로우/조명은 실제 발사(핀치)일 때만
    this.hit.visible = active;
    if (active) {
      this.hit.position.copy(target);
      this.hit.material.color.setHex(this.hue);
      this.hitLight.position.copy(target);
      this.hitLight.intensity = this.tool === 'CUT' ? 6 : 3;
    } else {
      this.hitLight.intensity = 0;
    }

    // 점선 가이드는 숨김(초록 조준 빔이 그 역할)
    this.guide.visible = false;
  }

  /** 단위 원통(Y축)을 a→b 사이에 배치 (좌표계는 mesh의 부모 기준) */
  _orientBone(mesh, a, b) {
    mesh.visible = true;
    const dir = this._b.copy(b).sub(a);
    const len = dir.length() || 0.0001;
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(this._up, dir.clone().normalize());
    mesh.scale.set(1, len, 1);
  }

  _fromHand(hand) {
    const [px, , pz] = hand.palm;
    return hand.fingers.slice().sort((a, b) => a.type - b.type)
      .map((f) => f.joints.map((j) => new THREE.Vector3((j[0] - px) * S, 0.06, (j[2] - pz) * S)));
  }

  _synthesize(pinch) {
    const fingers = [];
    const lengths = [1.0, 1.4, 1.5, 1.35, 1.15];
    for (let type = 0; type < 5; type++) {
      const spreadX = (type - 2) * 0.4;
      const curlAmt = type <= 1 ? pinch : pinch * 0.3;
      const joints = [];
      for (const seg of [0, 0.25, 0.55, 0.8, 1.0]) {
        const curl = curlAmt * seg * seg;
        joints.push(new THREE.Vector3(
          spreadX + spreadX * 0.12 * seg - (type === 0 ? curl * 0.45 : 0),
          0.06,
          0.2 + lengths[type] * seg * (1 - curl * 0.7)
        ));
      }
      fingers.push(joints);
    }
    return fingers;
  }
}
