import * as THREE from 'three';

const CUT_OPEN_HITS = 30; // 1단계: 절개(개복)량
const REMOVE_HITS = 30;   // 2단계: 종양 태우기량
const SUTURE_HITS = 24;   // 3단계: 봉합량
const NEAR = 1.15;        // 수술 부위 판정 반경
const RECORDS_KEY = 'leap-surgery-records';

/**
 * 체험 미션(3단계): ① 표시 부위 절개 → ② 드러난 종양 제거 → ③ 봉합.
 * 종양은 위장 "안"에 있다는 설정 — 절개를 마치면 드러난다.
 * 타이머는 1단계 첫 절개가 부위에 닿는 순간 시작, 봉합 완료 시 기록(TOP5).
 */
export class Mission {
  constructor(scene, hud) {
    this.scene = scene;
    this.hud = hud;
    this.$mission = document.getElementById('mission');
    this.$timer = document.getElementById('mission-timer');
    this.$list = document.getElementById('records-list');
    this.state = 'IDLE'; // IDLE | CUT_OPEN | REMOVE | SUTURE | DONE
    this.tumor = null;
    this.marker = null;
    this.site = new THREE.Vector3();
    this.siteNormal = new THREE.Vector3(0, 1, 0);
    this._ndc = new THREE.Vector2();
    this._guideHTML = this.$mission.innerHTML; // 연습 모드용 양손 안내(원본)
    this._renderRecords();
  }

  /** 새 라운드: 위장 표면(장기 메시에만) 랜덤 부위 선택 + 수술 부위 마커 표시 */
  start() {
    this._cleanup();
    let hit = null;
    for (let i = 0; i < 60; i++) {
      this._ndc.set((Math.random() * 2 - 1) * 0.35, (Math.random() * 2 - 1) * 0.35);
      hit = this.scene.raycastOrganFromNDC(this._ndc); // 장기 밖(수술포/배경)은 null
      if (hit) break;
    }
    if (!hit) { setTimeout(() => this.start(), 1500); return; } // 모델 로드 전이면 재시도

    this.site.copy(hit.point);
    this.siteNormal.copy(hit.normal);

    // 수술 부위 마커(호박색 링) — 어디를 절개할지 안내
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.0, 40),
      new THREE.MeshBasicMaterial({ color: 0xffc24d, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthTest: false })
    );
    this.marker.renderOrder = 996;
    this.marker.position.copy(this.site).addScaledVector(this.siteNormal, 0.06);
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.siteNormal);
    this.scene.scene.add(this.marker);

    this.cutN = 0;
    this.removeN = 0;
    this.sutureN = 0;
    this.t0 = null;
    this.state = 'CUT_OPEN';
    this.hud.resetProgress();
    this._say('1️⃣ 표시된 부위를 오른손 레이저로 절개하세요!', 'cut');
  }

  /** 레이저가 조직에 작용할 때마다 호출 */
  onSurgery(tool, point) {
    if (this.state === 'CUT_OPEN' && tool === 'CUT' && point.distanceTo(this.site) < NEAR) {
      if (!this.t0) this.t0 = performance.now(); // 첫 절개 → 타이머 시작
      this.cutN++;
      this.hud.setProgress('CUT', Math.min(100, Math.round((this.cutN / CUT_OPEN_HITS) * 100)));
      if (this.cutN >= CUT_OPEN_HITS) this._revealTumor();
    } else if (this.state === 'REMOVE' && tool === 'CUT' && this.tumor && point.distanceTo(this.tumor.position) < 0.95) {
      this.removeN++;
      const s = Math.max(0.15, 1 - (this.removeN / REMOVE_HITS) * 0.85); // 태울수록 줄어듦
      this.tumor.scale.set(s, 0.7 * s, s);
      if (this.removeN >= REMOVE_HITS) {
        for (let i = 0; i < 8; i++) this.scene.vfx.emit(this.site, 'CUT');
        this._removeTumor();
        this.state = 'SUTURE';
        this._say('3️⃣ 종양 제거 완료! 왼손 레이저로 상처를 봉합하세요!', 'suture');
      }
    } else if (this.state === 'SUTURE' && tool === 'SUTURE' && point.distanceTo(this.site) < NEAR + 0.4) {
      this.sutureN++;
      this.hud.setProgress('SUTURE', Math.min(100, Math.round((this.sutureN / SUTURE_HITS) * 100)));
      if (this.sutureN >= SUTURE_HITS) this._finish();
    }
  }

  /** 1단계 완료: 절개 부위에서 종양이 드러남 */
  _revealTumor() {
    this.tumor = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x7a2050, roughness: 0.45, emissive: 0x30001a, emissiveIntensity: 0.8 })
    );
    this.tumor.position.copy(this.site).addScaledVector(this.siteNormal, 0.16);
    this.tumor.scale.set(0.01, 0.01, 0.01); // 작게 시작 → update()에서 커지며 드러남
    this.tumor.castShadow = true;
    this.scene.scene.add(this.tumor);
    this._revealT = performance.now();
    for (let i = 0; i < 6; i++) this.scene.vfx.emit(this.site, 'CUT');
    this.state = 'REMOVE';
    this._say('2️⃣ 종양이 드러났습니다! 레이저로 태워 제거하세요!', 'cut');
  }

  _finish() {
    this.state = 'DONE';
    const sec = (performance.now() - this.t0) / 1000;
    this._say(`✅ 수술 성공! 기록 ${sec.toFixed(1)}초 — 잠시 후 다음 도전이 시작됩니다`, 'done');
    this._cleanup(false); // 마커 제거(기록/타이머는 유지)
    this._saveRecord(sec);
    setTimeout(() => {
      if (this.state !== 'DONE') return; // 그 사이 모드가 바뀌었으면 재시작하지 않음
      this.scene.reset(); this.hud.resetProgress(); this.start();
    }, 5000);
  }

  /** 연습 모드 진입 등 미션 중단 */
  stop() {
    this._cleanup();
    this.state = 'IDLE';
    this.t0 = null;
    this.$mission.className = 'panel mission mission--dual';
    this.$mission.innerHTML = this._guideHTML;
  }

  /** 어트랙트 전환 등 외부 리셋 시 */
  restart() {
    this._cleanup();
    this.state = 'IDLE';
    this.t0 = null;
    setTimeout(() => this.start(), 500);
  }

  /** 매 프레임: 타이머 + 마커 펄스 + 종양 등장 연출 */
  update() {
    const now = performance.now();
    if (this.t0 && this.state !== 'DONE' && this.state !== 'IDLE') {
      this.$timer.textContent = `${((now - this.t0) / 1000).toFixed(1)}s`;
    } else if (!this.t0) {
      this.$timer.textContent = '0.0s';
    }
    if (this.marker) { // 수술 부위 마커 펄스
      const p = 1 + Math.sin(now * 0.005) * 0.08;
      this.marker.scale.setScalar(p);
    }
    if (this.tumor && this._revealT) { // 종양이 스르륵 커지며 드러남(0.6초)
      const t = Math.min(1, (now - this._revealT) / 600);
      const shrink = Math.max(0.15, 1 - (this.removeN / REMOVE_HITS) * 0.85);
      const s = t * shrink;
      this.tumor.scale.set(s, 0.7 * s, s);
      if (t >= 1) this._revealT = null;
    }
  }

  _say(text, cls) {
    this.$mission.className = `panel mission mission--game mission--${cls}`;
    this.$mission.textContent = text;
  }

  _removeTumor() {
    if (this.tumor) {
      this.scene.scene.remove(this.tumor);
      this.tumor.geometry.dispose();
      this.tumor = null;
    }
  }

  _cleanup(removeTumor = true) {
    if (removeTumor) this._removeTumor();
    if (this.marker) {
      this.scene.scene.remove(this.marker);
      this.marker.geometry.dispose();
      this.marker = null;
    }
    this._revealT = null;
  }

  _saveRecord(sec) {
    const arr = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
    arr.push(Math.round(sec * 10) / 10);
    arr.sort((a, b) => a - b);
    localStorage.setItem(RECORDS_KEY, JSON.stringify(arr.slice(0, 5)));
    this._renderRecords(Math.round(sec * 10) / 10);
  }

  _renderRecords(latest) {
    const arr = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    this.$list.innerHTML = arr
      .map((s, i) => `<li${s === latest ? ' class="is-new"' : ''}>${medals[i]} ${s.toFixed(1)}초</li>`)
      .join('');
  }
}
