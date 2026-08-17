import * as THREE from 'three';

/**
 * 장기(위장) + 주변 해부 구조(장/간).
 *
 * 절개/봉합은 메시를 변형하지 않는다(정점 밀기 + 법선 재계산 = 조명 떨림 "찌지직"의 원인).
 * 대신:
 *   - 절개: 경로를 따라 매끄러운 튜브 라인 하나를 그린다(떨림 없음, 깔끔).
 *   - 봉합: 절개선을 가로지르는 X자 바늘땀을 간격을 두고 얹는다.
 */
export class Tissue {
  constructor(scene) {
    this.group = new THREE.Group();
    this.originalPos = [];
    this.normals = [];
    this.cutPts = [];       // 표면에서 살짝 띄운 절개 경로점
    this.cutPathLen = 0;
    this.suturePathLen = 0;
    this._lastCut = null;
    this._lastStitch = null;

    const tissueProps = { roughness: 0.6, metalness: 0.0, clearcoat: 0.1, clearcoatRoughness: 0.7 };

    const stomachCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.2, 0, -0.5),
      new THREE.Vector3(-0.2, 0, 0),
      new THREE.Vector3(1.0, 0, 0.3),
      new THREE.Vector3(1.8, 0, 1.0),
    ]);
    const geo = new THREE.TubeGeometry(stomachCurve, 120, 1.6, 96, false);
    const posAttr = geo.attributes.position;
    const normAttr = geo.attributes.normal;
    for (let i = 0; i < posAttr.count; i++) {
      let x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
      const nx = normAttr.getX(i), ny = normAttr.getY(i), nz = normAttr.getZ(i);
      const wrinkle = Math.sin(x * 12) * 0.04 + Math.cos(z * 15) * 0.04 + Math.sin(y * 8) * 0.03;
      x += nx * wrinkle; y += ny * wrinkle; z += nz * wrinkle;
      posAttr.setXYZ(i, x, y, z);
      this.originalPos.push(new THREE.Vector3(x, y, z));
      this.normals.push(new THREE.Vector3(nx, ny, nz));
    }
    geo.computeVertexNormals();

    // 절차적 장기 비주얼(위장+장+간)을 한 그룹에 모아, 모델 로드 시 통째로 숨길 수 있게
    this.organVisuals = new THREE.Group();
    this.group.add(this.organVisuals);

    const mat = new THREE.MeshPhysicalMaterial({ ...tissueProps, map: this._makeTexture() });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.organVisuals.add(this.mesh);

    // 절개선 / 바늘땀이 쌓이는 그룹(모델을 써도 유지)
    this.overlay = new THREE.Group();
    this.group.add(this.overlay);
    this._incisionMat = new THREE.MeshStandardMaterial({ color: 0xc0304c, roughness: 0.5, emissive: 0x3a0010, emissiveIntensity: 0.4 });
    this._incision = null;

    this._buildOrgans();
    scene.add(this.group);
  }

  _buildOrgans() {
    const intestineMat = new THREE.MeshPhysicalMaterial({ color: 0xffb59e, roughness: 0.6, clearcoat: 0.1 });
    for (let i = 0; i < 8; i++) {
      const g = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(Math.random() * 4 - 2, -1, Math.random() * 2 - 1),
          new THREE.Vector3(Math.random() * 4 - 2, -1.5, Math.random() * 2),
          new THREE.Vector3(Math.random() * 4 - 2, -1, Math.random() * 4),
        ]), 48, 0.5, 24, false
      );
      const m = new THREE.Mesh(g, intestineMat);
      m.castShadow = true; m.receiveShadow = true;
      this.organVisuals.add(m);
    }
    const liverGeo = new THREE.SphereGeometry(2.2, 48, 48);
    liverGeo.scale(1.4, 0.6, 1.0);
    const liver = new THREE.Mesh(liverGeo, new THREE.MeshPhysicalMaterial({ color: 0xf7a58c, roughness: 0.55, clearcoat: 0.1 }));
    liver.position.set(2, 0.5, -2.2);
    liver.rotation.set(0.3, 0.2, -0.1);
    liver.castShadow = true;
    this.organVisuals.add(liver);
  }

  /** 모델 로드 시 절차적 장기 전체를 숨긴다(절개선/바늘땀 overlay는 유지) */
  setProceduralVisible(v) { this.organVisuals.visible = v; }

  _makeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffc0cb';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.strokeStyle = 'rgba(255, 150, 175, 0.5)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      const sx = Math.random() * 1024, sy = Math.random() * 1024;
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx + 50, sy + 100, sx - 100, sy + 150, sx + (Math.random() - 0.5) * 300, sy + 300);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 16;
    return tex;
  }

  /**
   * 레이저가 조직에 닿았을 때 호출.
   * @returns {number} 0~100 진행률
   */
  surgery(targetPos, toolMode, normal) {
    if (toolMode === 'CUT') return this._cut(targetPos, normal);
    return this._suture(targetPos, normal);
  }

  _cut(pos) {
    // 실제 변형은 Deformer가 담당. 여기서는 진행률만 집계(절개선 그림 제거).
    if (!this._lastCut || pos.distanceTo(this._lastCut) > 0.07) {
      this._lastCut = pos.clone();
      this.cutPathLen++;
    }
    return Math.min(100, Math.round((this.cutPathLen / 60) * 100));
  }

  _rebuildIncision() {
    if (this.cutPts.length < 2) return;
    if (this._incision) { this._incision.geometry.dispose(); this.overlay.remove(this._incision); }
    const curve = new THREE.CatmullRomCurve3(this.cutPts);
    const geo = new THREE.TubeGeometry(curve, Math.max(8, this.cutPts.length * 4), 0.045, 8, false);
    this._incision = new THREE.Mesh(geo, this._incisionMat);
    this.overlay.add(this._incision);
  }

  _suture(pos) {
    // 시각 효과는 Deformer의 켈로이드 흉터(옅은 색 + 살짝 볼록)가 담당. 여기선 진행률만.
    if (!this._lastStitch || pos.distanceTo(this._lastStitch) > 0.15) {
      this._lastStitch = pos.clone();
      this.suturePathLen++;
    }
    return Math.min(100, Math.round((this.suturePathLen / 20) * 100));
  }

  /** 표면 최근접 정점 법선(성긴 샘플로 비용 절감) */
  _surfaceNormal(pos) {
    let nearest = 0, min = Infinity;
    for (let i = 0; i < this.originalPos.length; i += 7) {
      const d = this.originalPos[i].distanceToSquared(pos);
      if (d < min) { min = d; nearest = i; }
    }
    return this.normals[nearest];
  }

  reset() {
    this.cutPts = [];
    this.cutPathLen = 0;
    this.suturePathLen = 0;
    this._lastCut = null;
    this._lastStitch = null;
    this._incision = null;
    for (const c of this.overlay.children) c.traverse((o) => o.geometry?.dispose?.());
    this.overlay.clear();
  }
}
