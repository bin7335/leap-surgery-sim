import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * 임의의 메시(절차적/로드된 모델 모두) 표면을 월드 좌표 기준으로 변형한다.
 * 절개: 경로 주변을 안쪽으로 파내 골(갈라짐)을 만들고 검붉게.
 * 봉합: 파인 골을 다시 올려 아물게 하고 밝은 색으로.
 *
 * "찌지직" 방지: 깊이 누적 + 부드러운 감쇠, 법선 재계산은 스로틀링.
 */
export class Deformer {
  constructor() {
    this._normalDirty = 0;
    this.lastMs = 0; // 직전 변형 1회 소요 시간(ms) — 성능 계측용
  }

  prepare(mesh) {
    const geo = mesh.geometry;
    if (geo.userData._defReady) return;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position;
    geo.userData._orig = new Float32Array(pos.array);              // 원본 위치
    geo.userData._nrm = new Float32Array(geo.attributes.normal.array); // 원본 법선(파는 방향)
    geo.userData._depth = new Float32Array(pos.count);             // 누적 깊이
    if (!geo.attributes.color) {
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3));
    }
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
      if (m) { m.vertexColors = true; m.needsUpdate = true; }
    });
    geo.userData._defReady = true;
  }

  cut(mesh, worldPoint, worldRadius = 0.15) { this._apply(mesh, worldPoint, worldRadius, 'CUT'); }     // 얇은 절개
  suture(mesh, worldPoint, worldRadius = 0.3) { this._apply(mesh, worldPoint, worldRadius, 'SUTURE'); }

  _apply(mesh, worldPoint, worldRadius, mode) {
    const t0 = performance.now();
    this.prepare(mesh);
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const orig = geo.userData._orig, nrm = geo.userData._nrm, depth = geo.userData._depth;

    // 월드 좌표/반경 → 메시 로컬 (모델 스케일 보정)
    const lp = mesh.worldToLocal(worldPoint.clone());
    const scale = _v.setFromMatrixColumn(mesh.matrixWorld, 0).length() || 1;
    const r = worldRadius / scale;
    const r2 = r * r;
    const maxDepth = r * 1.1;
    let changed = false;

    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      const dx = orig[ix] - lp.x, dy = orig[ix + 1] - lp.y, dz = orig[ix + 2] - lp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const t = 1 - Math.sqrt(d2) / r;
      const fall = t * t * (3 - 2 * t);

      if (mode === 'CUT') depth[i] = Math.min(maxDepth, depth[i] + fall * maxDepth * 0.06); // 약하게 진행
      // 봉합: 아물면서 0을 지나 살짝 볼록(-0.03)까지 — 켈로이드처럼 미세하게 도드라진 흉터
      else depth[i] = Math.max(-0.03, depth[i] - fall * maxDepth * 0.20);

      const dep = depth[i];
      pos.setXYZ(i, orig[ix] - nrm[ix] * dep, orig[ix + 1] - nrm[ix + 1] * dep, orig[ix + 2] - nrm[ix + 2] * dep);
      if (mode === 'CUT') {
        const c = 1 - Math.min(1, dep / maxDepth) * 0.62;
        col.setXYZ(i, c, c * 0.45, c * 0.42); // 파일수록 검붉게
      } else {
        col.setXYZ(i, 0.96, 0.84, 0.85); // 켈로이드 흉터: 옅게만 남는 색(조잡한 자국 대신)
      }
      changed = true;
    }

    if (changed) {
      pos.needsUpdate = true;
      col.needsUpdate = true;
      if (++this._normalDirty >= 5) { geo.computeVertexNormals(); this._normalDirty = 0; } // 스로틀링
    }
    this.lastMs = performance.now() - t0;
  }

  reset(mesh) {
    const geo = mesh?.geometry;
    if (!geo || !geo.userData._defReady) return;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const orig = geo.userData._orig;
    geo.userData._depth.fill(0);
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      pos.setXYZ(i, orig[ix], orig[ix + 1], orig[ix + 2]);
      col.setXYZ(i, 1, 1, 1);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.computeVertexNormals();
  }
}
