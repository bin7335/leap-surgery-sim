import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * 사실적 3D 해부 모델(GLB/GLTF)을 불러와 수술 영역에 맞게 배치한다.
 *
 * 사용법: `public/models/organ.glb` 에 모델 파일을 넣으면 자동으로 로드된다.
 * (없으면 조용히 실패 → OperatingScene이 절차적 Tissue로 폴백)
 *
 * 크기/위치가 제각각인 모델을 다루기 위해 바운딩박스 기준으로 자동 정규화한다.
 */
export class ModelField {
  // 어떤 형태로 넣어도 인식되도록 후보 경로를 순서대로 시도
  static CANDIDATES = [
    '/models/organ.glb',
    '/models/stomach.glb',
    '/models/organ/scene.gltf',
    '/models/scene.gltf',
  ];

  /**
   * @param {number} targetSize 수술 영역에 맞출 최대 치수(씬 유닛)
   * @returns {Promise<{root: THREE.Group, surgeryMesh: THREE.Mesh}>}
   */
  static async load(targetSize = 7.0) {
    const loader = new GLTFLoader();
    for (const url of ModelField.CANDIDATES) {
      try {
        const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
        return ModelField._fit(gltf.scene, targetSize);
      } catch { /* 다음 후보 시도 */ }
    }
    throw new Error('모델 파일 없음 (public/models/ 참고)');
  }

  // 모델 배치 방향(튜닝값). ry로 옆면이 카메라를 향하게 회전.
  static ORIENT = { rx: 0, ry: Math.PI / 2, rz: 0 };

  static _fit(root, targetSize) {
    // 그림자 활성화 + 가장 큰 메시를 수술(레이캐스트) 대상으로 선택
    let surgeryMesh = null, maxVerts = -1;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const v = o.geometry?.attributes?.position?.count ?? 0;
        if (v > maxVerts) { maxVerts = v; surgeryMesh = o; }
        if (o.material) o.material.side = THREE.FrontSide;
      }
    });

    // 바운딩박스 → 중심 원점, 최대 치수를 targetSize로 스케일
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = targetSize / Math.max(size.x, size.y, size.z || 1);

    const holder = new THREE.Group();
    root.position.sub(center);          // 원점 정렬
    holder.add(root);
    holder.scale.setScalar(scale);
    // 눕혀서 기울이기(수술대에 놓인 느낌 + 위에서 아래로 레이캐스트가 넓은 윗면에 닿게)
    holder.rotation.set(ModelField.ORIENT.rx, ModelField.ORIENT.ry, ModelField.ORIENT.rz);
    holder.position.y = 0;              // 수술대 높이

    return { root: holder, surgeryMesh };
  }
}
