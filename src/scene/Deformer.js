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
    geo.userData._scar = new Float32Array(pos.count);              // 절개 이력(최대 깊이) — 켈로이드 근거
    if (!geo.attributes.color) {
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3));
    }
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
      if (m) { m.vertexColors = true; m.needsUpdate = true; }
    });
    geo.userData._defReady = true;
  }

  cut(mesh, worldPoint, worldRadius = 0.18) { this._apply(mesh, worldPoint, worldRadius, 'CUT'); }     // 얇은 절개
  suture(mesh, worldPoint, worldRadius = 0.22) { this._apply(mesh, worldPoint, worldRadius, 'SUTURE'); } // 좁고 정밀한 봉합

  _apply(mesh, worldPoint, worldRadius, mode) {
    const t0 = performance.now();
    this.prepare(mesh);
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const orig = geo.userData._orig, nrm = geo.userData._nrm, depth = geo.userData._depth;
    const scar = geo.userData._scar;

    // 월드 좌표/반경 → 메시 로컬 (모델 스케일 보정)
    const lp = mesh.worldToLocal(worldPoint.clone());
    const scale = _v.setFromMatrixColumn(mesh.matrixWorld, 0).length() || 1;
    const r = worldRadius / scale;
    const r2 = r * r;
    // 외벽 두께(내부층 오프셋 0.08)보다 깊게 파여야 내부 조직이 드러난다
    const maxDepth = Math.max(r * 1.3, 0.14 / scale);
    let changed = false;

    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      const dx = orig[ix] - lp.x, dy = orig[ix + 1] - lp.y, dz = orig[ix + 2] - lp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const t = 1 - Math.sqrt(d2) / r;
      const fall = t * t * (3 - 2 * t);

      if (mode === 'CUT') {
        depth[i] = Math.min(maxDepth, depth[i] + fall * maxDepth * 0.06); // 약하게 진행
        scar[i] = Math.max(scar[i], depth[i]); // 절개 이력 기록(깊이 최대치)
        const c = 1 - Math.min(1, depth[i] / maxDepth) * 0.62;
        col.setXYZ(i, c, c * 0.45, c * 0.42); // 파일수록 검붉게
      } else {
        // 봉합: 절개됐던 자리는 원형으로 돌아가지 않고 "융기된 켈로이드"로 남는다.
        // 흉터 높이는 절개가 깊었을수록 도드라짐(음수 depth = 바깥 볼록).
        const wasCut = scar[i] > maxDepth * 0.1;
        const target = wasCut ? -Math.min(scar[i] * 0.9, maxDepth * 0.6) : 0; // 뚜렷하게 융기
        // 봉합은 브러시 가장자리도 어느 정도 아물게(감쇠 바닥 0.35) — 마지막 몇 정점이 안 채워져 완료가 막히는 것 방지
        const fallS = 0.35 + 0.65 * fall;
        depth[i] = Math.max(target, depth[i] - fallS * maxDepth * 0.06); // 아뭄 속도(체감 튜닝값)
        if (wasCut) col.setXYZ(i, 0.95, 0.5, 0.55); // 켈로이드: 진한 장밋빛 흉터 라인
        else col.setXYZ(i, 1, 1, 1);                // 절개 안 됐던 주변은 원래 색 복구
      }
      const dep = depth[i];
      pos.setXYZ(i, orig[ix] - nrm[ix] * dep, orig[ix + 1] - nrm[ix + 1] * dep, orig[ix + 2] - nrm[ix + 2] * dep);
      changed = true;
    }

    if (changed) {
      pos.needsUpdate = true;
      col.needsUpdate = true;
      if (++this._normalDirty >= 3) { // 스로틀링(조명 매끈 ↔ 비용 균형)
        geo.computeVertexNormals();
        geo.boundsTree?.refit?.(); // 변형 반영해 레이캐스트 정확도 유지
        this._normalDirty = 0;
      }
    }
    this.lastMs = performance.now() - t0;
  }

  /**
   * 부위의 치유율(0~1): 절개됐던 정점 중 표면까지 아문(depth<=0) 비율.
   * "다 봉합해야 완료" 판정에 사용.
   */
  healRatio(mesh, worldPoint, worldRadius) {
    const geo = mesh?.geometry;
    if (!geo?.userData._defReady) return { ratio: 1, holeOpen: false }; // 상처 없음
    const pos = geo.attributes.position;
    const orig = geo.userData._orig, depth = geo.userData._depth, scar = geo.userData._scar;
    const lp = mesh.worldToLocal(worldPoint.clone());
    const scale = _v.setFromMatrixColumn(mesh.matrixWorld, 0).length() || 1;
    const r2 = (worldRadius / scale) ** 2;
    const maxDepthRef = 0.14 / scale;
    const scarMin = maxDepthRef * 0.15; // 유의미한 절개였는지 기준
    // 연속 비율(부피) + 잔여 구멍 검사(깊게 열린 정점이 여러 개 모여있을 때만 "구멍")
    let totalScar = 0, totalOpen = 0, deepCount = 0;
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      const dx = orig[ix] - lp.x, dy = orig[ix + 1] - lp.y, dz = orig[ix + 2] - lp.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (scar[i] <= scarMin) continue;
      totalScar += scar[i];
      const open = Math.max(0, depth[i]);
      totalOpen += open;
      if (open > maxDepthRef * 0.5) deepCount++;
    }
    return {
      ratio: totalScar === 0 ? 1 : 1 - totalOpen / totalScar,
      holeOpen: deepCount >= 3, // 정점 1~2개짜리 미세 잔여물은 무시(후한 판정)
    };
  }

  reset(mesh) {
    const geo = mesh?.geometry;
    if (!geo || !geo.userData._defReady) return;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const orig = geo.userData._orig;
    geo.userData._depth.fill(0);
    geo.userData._scar.fill(0);
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
