import * as THREE from 'three';

/**
 * 수술 장면 연출: 수술대 + 수술포(드레이프).
 * 장기가 드레이프의 타원 개창(fenestration)을 통해 드러나는 실제 수술 구도를 만든다.
 * "장기만 허공에 떠 있는" 어색함을 없애고 맥락을 부여한다.
 */
export function addDressing(scene) {
  const group = new THREE.Group();

  // 수술대(스테인리스 톤)
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.5, 11),
    new THREE.MeshStandardMaterial({ color: 0x46555e, metalness: 0.6, roughness: 0.4 })
  );
  table.position.y = -1.7;
  table.receiveShadow = true;
  group.add(table);

  // 수술포: 큰 천에 타원 구멍(개창) — 장기가 이 구멍으로 드러남
  const shape = new THREE.Shape();
  shape.moveTo(-10, -7);
  shape.lineTo(10, -7);
  shape.lineTo(10, 7);
  shape.lineTo(-10, 7);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absellipse(0, 0, 3.4, 2.7, 0, Math.PI * 2);
  shape.holes.push(hole);

  const drape = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 48),
    new THREE.MeshStandardMaterial({ color: 0x4d8f99, roughness: 0.92, side: THREE.DoubleSide }) // 수술포 그린
  );
  drape.rotation.x = -Math.PI / 2;
  drape.position.y = -0.55;
  drape.receiveShadow = true;
  group.add(drape);

  // 개창 테두리(살짝 밝은 림 — 시선 유도)
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.65, 48),
    new THREE.MeshStandardMaterial({ color: 0x6fb3bd, roughness: 0.85, side: THREE.DoubleSide })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -0.54;
  rim.scale.set(1, 2.7 / 3.4, 1); // 타원 비율 맞춤
  group.add(rim);

  scene.add(group);
  return group;
}
