import * as THREE from 'three';

/**
 * 2본(상완/전완) 역기구학으로 엔드이펙터가 목표점을 추적하는 로봇팔.
 * 참고 프로토타입(docs/수술 시현 프로그램 10.html)의 팔 구성/IK를 모듈화·정리한 것.
 *
 * armType: 'CUT'(빨강 레이저) | 'SUTURE'(파랑 레이저)
 */
export class RobotArm {
  constructor(armType, basePos) {
    this.armType = armType;
    this.L1 = 4.5;
    this.L2 = 4.5;
    this.currentPos = basePos.clone(); // IK가 추적하는 현재 목표

    const laserColor = armType === 'CUT' ? 0xef4444 : 0x38bdf8;
    const armMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.6, roughness: 0.3 });
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.4 });
    const highlightMat = new THREE.MeshStandardMaterial({
      color: armType === 'CUT' ? 0xef4444 : 0x3b82f6, metalness: 0.9, roughness: 0.2,
    });

    const root = new THREE.Group();
    root.position.copy(basePos);
    this.root = root;

    const shoulderPivot = new THREE.Group();
    root.add(shoulderPivot);
    this.shoulderPivot = shoulderPivot;

    // 상완
    const upperGeo = new THREE.BoxGeometry(0.35, 0.35, this.L1);
    upperGeo.translate(0, 0, this.L1 / 2);
    const upperMesh = new THREE.Mesh(upperGeo, armMat);
    upperMesh.castShadow = true;
    shoulderPivot.add(upperMesh);

    // 팔꿈치 관절
    const elbowJointGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.45, 32);
    elbowJointGeo.rotateX(Math.PI / 2);
    const elbowJoint = new THREE.Mesh(elbowJointGeo, jointMat);
    elbowJoint.position.set(0, 0, this.L1);
    elbowJoint.castShadow = true;
    shoulderPivot.add(elbowJoint);

    const elbowPivot = new THREE.Group();
    elbowPivot.position.set(0, 0, this.L1);
    shoulderPivot.add(elbowPivot);
    this.elbowPivot = elbowPivot;

    // 전완
    const lowerGeo = new THREE.BoxGeometry(0.28, 0.28, this.L2);
    lowerGeo.translate(0, 0, this.L2 / 2);
    const lowerMesh = new THREE.Mesh(lowerGeo, armMat);
    lowerMesh.castShadow = true;
    elbowPivot.add(lowerMesh);

    const wristJoint = new THREE.Mesh(elbowJointGeo, jointMat);
    wristJoint.scale.setScalar(0.7);
    wristJoint.position.set(0, 0, this.L2);
    elbowPivot.add(wristJoint);

    const wristPivot = new THREE.Group();
    wristPivot.position.set(0, 0, this.L2);
    elbowPivot.add(wristPivot);
    this.wristPivot = wristPivot;

    // 도구 헤드
    const toolBase = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.4), highlightMat);
    toolBase.position.set(0, 0, 0.2);
    wristPivot.add(toolBase);

    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.4), new THREE.MeshStandardMaterial({ color: 0x94a3b8 }));
    housing.position.set(0, 0, 0.6);
    wristPivot.add(housing);

    const laserEmitter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.1, 16),
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    laserEmitter.rotateX(Math.PI / 2);
    laserEmitter.position.set(0, -0.05, 0.85);
    wristPivot.add(laserEmitter);

    // 레이저 빔
    const beamR = armType === 'CUT' ? 0.005 : 0.015;
    const beamGeo = new THREE.CylinderGeometry(beamR, beamR, 1, 16);
    beamGeo.rotateX(Math.PI / 2);
    const laserBeam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({ color: laserColor, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
    );
    laserBeam.visible = false;
    wristPivot.add(laserBeam);
    this.laserBeam = laserBeam;

    const laserLight = new THREE.PointLight(laserColor, 0, 3);
    laserLight.position.set(0, -0.05, 0.85);
    wristPivot.add(laserLight);
    this.laserLight = laserLight;
  }

  /**
   * IK 갱신. active=true면 레이저를 쏜다.
   * @returns {boolean} 이번 프레임에 조직에 레이저가 닿았는지(변형 트리거)
   */
  update(targetPos, active) {
    this.currentPos.lerp(targetPos, 0.25); // 손 추적 반응 개선(덜 끌림)

    const hoverOffset = active ? 0.3 : 1.0;
    const hoverPos = this.currentPos.clone();
    hoverPos.y += hoverOffset;
    hoverPos.z += 0.1;

    const baseToTarget = new THREE.Vector3().subVectors(hoverPos, this.root.position);
    const dist = baseToTarget.length();
    const d = Math.max(0.1, Math.min(dist, this.L1 + this.L2 - 0.01));

    const cosAlpha = (this.L1 * this.L1 + d * d - this.L2 * this.L2) / (2 * this.L1 * d);
    const alpha = Math.acos(THREE.MathUtils.clamp(cosAlpha, -1, 1));
    const cosGamma = (this.L1 * this.L1 + this.L2 * this.L2 - d * d) / (2 * this.L1 * this.L2);
    const gamma = Math.acos(THREE.MathUtils.clamp(cosGamma, -1, 1));
    const beta = Math.PI - gamma;

    this.root.lookAt(hoverPos);
    this.shoulderPivot.rotation.x = -alpha;
    this.elbowPivot.rotation.x = beta;
    this.wristPivot.lookAt(this.currentPos);

    if (active) {
      this.laserBeam.visible = true;
      this.laserLight.intensity = this.armType === 'CUT' ? 10.0 : 5.0;
      const distToSurface = this.wristPivot
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(this.currentPos);
      this.laserBeam.scale.z = distToSurface;
      this.laserBeam.position.z = distToSurface / 2 + 0.85;
      return true;
    }
    this.laserBeam.visible = false;
    this.laserLight.intensity = 0;
    return false;
  }
}
