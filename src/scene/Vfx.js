import * as THREE from 'three';

/**
 * 절개(주황 불꽃+연기) / 봉합(파랑 불꽃) 파티클 풀.
 * 미리 mesh를 만들어 두고 재사용(GC/할당 회피).
 */
export class Vfx {
  constructor(scene, count = 60) {
    this.particles = [];
    const smokeGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0 });
    const sparkGeo = new THREE.BoxGeometry(0.015, 0.015, 0.05);
    const sparkOrange = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const sparkBlue = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });

    for (let i = 0; i < count; i++) {
      const type = i % 3; // 0=연기, 1=주황불꽃, 2=파랑불꽃
      let mesh;
      if (type === 0) mesh = new THREE.Mesh(smokeGeo, smokeMat.clone());
      else if (type === 1) mesh = new THREE.Mesh(sparkGeo, sparkOrange.clone());
      else mesh = new THREE.Mesh(sparkGeo, sparkBlue.clone());
      mesh.visible = false;
      scene.add(mesh);
      this.particles.push({ mesh, type, life: 0, vel: new THREE.Vector3() });
    }
  }

  emit(pos, actionType) {
    for (const p of this.particles) {
      if (p.mesh.visible || Math.random() < 0.4) continue;
      if (actionType === 'CUT' && p.type === 2) continue;    // 절개엔 파랑 제외
      if (actionType === 'SUTURE' && p.type === 1) continue;  // 봉합엔 주황 제외

      p.mesh.visible = true;
      p.mesh.position.copy(pos);
      p.mesh.position.y += 0.05;
      if (p.type === 0) {
        p.vel.set((Math.random() - 0.5) * 0.03, Math.random() * 0.05 + 0.03, (Math.random() - 0.5) * 0.03);
        p.life = 1.2;
        p.mesh.material.opacity = 0.5;
      } else {
        p.vel.set((Math.random() - 0.5) * 0.15, Math.random() * 0.1 + 0.08, (Math.random() - 0.5) * 0.15);
        p.life = 1.0;
      }
    }
  }

  update() {
    for (const p of this.particles) {
      if (!p.mesh.visible) continue;
      p.mesh.position.add(p.vel);
      if (p.type === 0) {
        p.life -= 0.02;
        p.mesh.scale.setScalar(2.0 - p.life);
        p.mesh.material.opacity = p.life * 0.4;
      } else {
        p.vel.y -= 0.015;
        p.life -= 0.08;
        p.mesh.lookAt(p.mesh.position.clone().add(p.vel));
        p.mesh.scale.setScalar(Math.max(0, p.life));
      }
      if (p.life <= 0) p.mesh.visible = false;
    }
  }
}
