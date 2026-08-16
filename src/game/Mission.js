import * as THREE from 'three';

const CUT_HITS = 45;    // 종양 제거에 필요한 절개량
const SUTURE_HITS = 28; // 봉합 완료에 필요한 봉합량
const NEAR = 1.15;      // 종양 주변 판정 반경
const RECORDS_KEY = 'leap-surgery-records';

/**
 * 체험 미션: 종양 제거 타임어택.
 * 절개(오른손)로 종양 제거 → 봉합(왼손)으로 마무리 → 소요 시간 기록(TOP5, localStorage).
 * 타이머는 종양에 첫 절개가 닿는 순간 시작된다.
 */
export class Mission {
  constructor(scene, hud) {
    this.scene = scene;
    this.hud = hud;
    this.$mission = document.getElementById('mission');
    this.$timer = document.getElementById('mission-timer');
    this.$list = document.getElementById('records-list');
    this.state = 'IDLE'; // IDLE | CUT | SUTURE | DONE
    this.tumor = null;
    this.site = new THREE.Vector3();
    this._ndc = new THREE.Vector2();
    this._guideHTML = this.$mission.innerHTML; // 연습 모드용 양손 안내(원본) 보관
    this._renderRecords();
  }

  /** 연습 모드 진입 등 미션 중단: 종양 제거 + 안내를 양손 가이드로 복원 */
  stop() {
    this._removeTumor();
    this.state = 'IDLE';
    this.t0 = null;
    this.$mission.className = 'panel mission mission--dual';
    this.$mission.innerHTML = this._guideHTML;
  }

  /** 새 라운드: 장기 표면 랜덤 위치에 종양 생성 */
  start() {
    this._removeTumor();
    let hit = null;
    for (let i = 0; i < 40; i++) {
      this._ndc.set((Math.random() * 2 - 1) * 0.35, (Math.random() * 2 - 1) * 0.35);
      const h = this.scene.resolveFromNDC(this._ndc);
      if (h && h.point.y > -0.35) { hit = h; break; } // 드레이프 아래(바닥 폴백)는 제외
    }
    if (!hit) { setTimeout(() => this.start(), 1500); return; } // 모델 로드 전이면 재시도

    this.site.copy(hit.point);
    this.tumor = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x7a2050, roughness: 0.45, emissive: 0x30001a, emissiveIntensity: 0.8 })
    );
    this.tumor.position.copy(hit.point).addScaledVector(hit.normal, 0.1);
    this.tumor.scale.y = 0.65;
    this.tumor.castShadow = true;
    this.scene.scene.add(this.tumor);

    this.cutN = 0;
    this.sutureN = 0;
    this.t0 = null;
    this.state = 'CUT';
    this.hud.resetProgress();
    this._say('🎯 미션: 보라색 종양을 오른손 레이저로 절개해 제거하세요!', 'cut');
  }

  /** 레이저가 조직에 작용할 때마다 호출 */
  onSurgery(tool, point) {
    if (this.state === 'CUT' && tool === 'CUT' && point.distanceTo(this.site) < NEAR) {
      if (!this.t0) this.t0 = performance.now(); // 첫 절개 → 타이머 시작
      this.cutN++;
      this.hud.setProgress('CUT', Math.min(100, Math.round((this.cutN / CUT_HITS) * 100)));
      if (this.tumor) { // 절개할수록 종양이 줄어듦
        const s = 1 - (this.cutN / CUT_HITS) * 0.8;
        this.tumor.scale.set(s, 0.65 * s, s);
      }
      if (this.cutN >= CUT_HITS) {
        for (let i = 0; i < 8; i++) this.scene.vfx.emit(this.site, 'CUT');
        this._removeTumor();
        this.state = 'SUTURE';
        this._say('🧵 종양 제거 완료! 왼손 레이저로 상처를 봉합하세요!', 'suture');
      }
    } else if (this.state === 'SUTURE' && tool === 'SUTURE' && point.distanceTo(this.site) < NEAR + 0.4) {
      this.sutureN++;
      this.hud.setProgress('SUTURE', Math.min(100, Math.round((this.sutureN / SUTURE_HITS) * 100)));
      if (this.sutureN >= SUTURE_HITS) this._finish();
    }
  }

  _finish() {
    this.state = 'DONE';
    const sec = (performance.now() - this.t0) / 1000;
    this._say(`✅ 수술 성공! 기록 ${sec.toFixed(1)}초 — 잠시 후 다음 도전이 시작됩니다`, 'done');
    this._saveRecord(sec);
    setTimeout(() => {
      if (this.state !== 'DONE') return; // 그 사이 모드가 바뀌었으면 재시작하지 않음
      this.scene.reset(); this.hud.resetProgress(); this.start();
    }, 5000);
  }

  /** 어트랙트 전환 등 외부 리셋 시 */
  restart() {
    this._removeTumor();
    this.state = 'IDLE';
    this.t0 = null;
    setTimeout(() => this.start(), 500);
  }

  /** 매 프레임: 진행 중이면 타이머 갱신 */
  update() {
    if (this.t0 && (this.state === 'CUT' || this.state === 'SUTURE')) {
      this.$timer.textContent = `${((performance.now() - this.t0) / 1000).toFixed(1)}s`;
    } else if (!this.t0) {
      this.$timer.textContent = '0.0s';
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
