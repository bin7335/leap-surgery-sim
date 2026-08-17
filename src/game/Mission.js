import * as THREE from 'three';

const SITES_PER_RUN = 2;    // 한 도전에서 수술할 부위 수(연속)
const CUT_OPEN_HITS = 110;  // 1단계: 절개(개복)량
const REMOVE_HITS = 90;     // 2단계: 종양 태우기량
const NEAR = 0.8;           // 수술 부위 판정 반경(좁게 — 정조준 필요)
const TUMOR_NEAR = 0.65;    // 종양 판정 반경
const PENALTY_PER_STRAY = 0.03; // 빗나간 절개 1회당 시간 페널티(초) — 건강한 조직 손상
const RECORDS_KEY = 'leap-surgery-records';

/**
 * 기록 도전(고난이도): 부위 2곳을 연속 수술한다.
 * 각 부위: ① 표시 부위 절개 → ② 드러난 종양 제거 → ③ 봉합.
 * 목표 밖을 절개하면(조직 손상) 시간 페널티가 누적된다. 최종 기록 = 경과시간 + 페널티.
 */
export class Mission {
  constructor(scene, hud) {
    this.scene = scene;
    this.hud = hud;
    this.$mission = document.getElementById('mission');
    this.$timer = document.getElementById('mission-timer');
    this.$list = document.getElementById('records-list');
    this.state = 'IDLE'; // IDLE | CUT_OPEN | REMOVE | SUTURE | DONE
    this.playerName = '무명의 의사';
    this.tumor = null;
    this.marker = null;
    this.site = new THREE.Vector3();
    this.siteNormal = new THREE.Vector3(0, 1, 0);
    this._ndc = new THREE.Vector2();
    this._guideHTML = this.$mission.innerHTML; // 연습 모드용 양손 안내(원본)
    this._renderRecords();
  }

  /** 새 도전(런) 시작 */
  start() {
    this._cleanup();
    this.siteIdx = 1;
    this.penalty = 0;
    this.t0 = null;
    this._newSite();
  }

  /** 현재 부위 세팅(마커 + 카운터) */
  _newSite() {
    this._cleanup();
    let hit = null;
    for (let i = 0; i < 80; i++) {
      this._ndc.set((Math.random() * 2 - 1) * 0.3, (Math.random() * 2 - 1) * 0.3);
      const h = this.scene.raycastOrganFromNDC(this._ndc); // 장기 밖(수술포/배경)은 null
      // 수술포(y=-0.55) 아래 가려진 부위는 제외 — 보이는 영역에만 종양 배치
      if (h && h.point.y > -0.2) { hit = h; break; }
    }
    if (!hit) { setTimeout(() => { if (this.state !== 'IDLE') this._newSite(); else this.start(); }, 1500); return; }

    this.site.copy(hit.point);
    this.siteNormal.copy(hit.normal);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.72, 40),
      new THREE.MeshBasicMaterial({ color: 0xffc24d, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthTest: false })
    );
    this.marker.renderOrder = 996;
    this.marker.position.copy(this.site).addScaledVector(this.siteNormal, 0.06);
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.siteNormal);
    this.scene.scene.add(this.marker);

    this.cutN = 0;
    this.removeN = 0;
    this.sutureN = 0;
    this.state = 'CUT_OPEN';
    this.hud.resetProgress();
    this._say(`${this._siteTag()} 1️⃣ 표시된 부위를 정확히 절개하세요! (빗나가면 페널티)`, 'cut');
  }

  _siteTag() { return `[부위 ${this.siteIdx}/${SITES_PER_RUN}]`; }

  /** 레이저가 조직에 작용할 때마다 호출 */
  onSurgery(tool, point) {
    if (this.state === 'CUT_OPEN' && tool === 'CUT') {
      if (point.distanceTo(this.site) < NEAR) {
        if (!this.t0) this.t0 = performance.now(); // 첫 정조준 절개 → 타이머 시작
        this.cutN++;
        this.hud.setProgress('CUT', Math.min(100, Math.round((this.cutN / CUT_OPEN_HITS) * 100)));
        if (this.cutN >= CUT_OPEN_HITS) this._revealTumor();
      } else if (this.t0) {
        this.penalty += PENALTY_PER_STRAY; // 조직 손상 페널티
      }
    } else if (this.state === 'REMOVE' && tool === 'CUT') {
      if (this.tumor && point.distanceTo(this.tumor.position) < TUMOR_NEAR) {
        this.removeN++;
        const s = Math.max(0.15, 1 - (this.removeN / REMOVE_HITS) * 0.85);
        this.tumor.scale.set(s, 0.7 * s, s);
        if (this.removeN >= REMOVE_HITS) {
          for (let i = 0; i < 8; i++) this.scene.vfx.emit(this.site, 'CUT');
          this._removeTumor();
          this.state = 'SUTURE';
          this._say(`${this._siteTag()} 3️⃣ 종양 제거! 왼손 레이저로 봉합하세요!`, 'suture');
        }
      } else if (this.t0) {
        this.penalty += PENALTY_PER_STRAY; // 종양이 아닌 곳을 태움
      }
    } else if (this.state === 'SUTURE' && tool === 'SUTURE' && point.distanceTo(this.site) < NEAR + 0.3) {
      // 횟수가 아니라 "상처가 실제로 다 아물었는지"(치유율)로 완료 판정
      // 부피 80% + "깊은 구멍 없음" 둘 다 만족해야 완료(구멍 남았는데 완료되는 것 방지)
      const { ratio, holeOpen } = this.scene.deformer.healRatio(this.scene.surgeryMesh, this.site, NEAR + 0.2);
      const done = ratio >= 0.8 && !holeOpen;
      const pct = Math.min(done ? 100 : 99, Math.round((ratio / 0.8) * 100)); // 구멍 남으면 99%에서 멈춤
      this.hud.setProgress('SUTURE', pct);
      if (done) this._siteComplete();
    }
  }

  _siteComplete() {
    if (this.siteIdx < SITES_PER_RUN) {
      this.siteIdx++;
      this.state = 'TRANSITION'; // 중복 발동 방지(계속 문질러도 다시 판정 안 됨)
      this._say(`✨ 부위 ${this.siteIdx - 1} 완료! 다음 부위로 이동하세요!`, 'done');
      setTimeout(() => { if (this.state === 'TRANSITION') this._newSite(); }, 1200);
    } else {
      this._finish();
    }
  }

  /** 1단계 완료: 절개 부위에서 종양이 드러남 */
  _revealTumor() {
    this.tumor = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x7a2050, roughness: 0.45, emissive: 0x30001a, emissiveIntensity: 0.8 })
    );
    this.tumor.position.copy(this.site).addScaledVector(this.siteNormal, 0.16);
    this.tumor.scale.set(0.01, 0.01, 0.01);
    this.tumor.castShadow = true;
    this.scene.scene.add(this.tumor);
    this._revealT = performance.now();
    for (let i = 0; i < 6; i++) this.scene.vfx.emit(this.site, 'CUT');
    this.state = 'REMOVE';
    this._say(`${this._siteTag()} 2️⃣ 종양만 정확히 태워 제거하세요! (조직을 태우면 페널티)`, 'cut');
  }

  _finish() {
    this.state = 'DONE';
    const raw = (performance.now() - this.t0) / 1000;
    const sec = raw + this.penalty;
    const penaltyMsg = this.penalty > 0.05 ? ` (페널티 +${this.penalty.toFixed(1)}초 포함)` : '';
    this._say(`✅ 수술 성공! 기록 ${sec.toFixed(1)}초${penaltyMsg}`, 'done');
    this._cleanup(false);
    this._saveRecord(sec);
    // 자동 재도전 대신 결과 창을 띄운다(main에서 배선)
    this.onFinished?.({ name: this.playerName, sec, penalty: this.penalty });
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

  /** 매 프레임: 타이머(페널티 포함) + 마커 펄스 + 종양 등장 연출 */
  update() {
    const now = performance.now();
    if (this.t0 && this.state !== 'DONE' && this.state !== 'IDLE') {
      this.$timer.textContent = `${(((now - this.t0) / 1000) + this.penalty).toFixed(1)}s`;
    } else if (!this.t0) {
      this.$timer.textContent = '0.0s';
    }
    if (this.marker) {
      const p = 1 + Math.sin(now * 0.005) * 0.08;
      this.marker.scale.setScalar(p);
    }
    if (this.tumor && this._revealT) {
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
    const rec = { n: this.playerName, s: Math.round(sec * 10) / 10 };
    const arr = this._loadRecords();
    arr.push(rec);
    arr.sort((a, b) => a.s - b.s);
    localStorage.setItem(RECORDS_KEY, JSON.stringify(arr.slice(0, 5)));
    this._renderRecords(rec);
  }

  _loadRecords() {
    const raw = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
    return raw.map((r) => (typeof r === 'number' ? { n: '---', s: r } : r));
  }

  _renderRecords(latest) {
    const arr = this._loadRecords();
    if (arr.length === 0) {
      this.$list.innerHTML = '<li class="rank-empty">아직 기록이 없습니다</li>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉', '4', '5'];
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    this.$list.innerHTML = arr
      .map((r, i) => {
        const isNew = latest && r.n === latest.n && r.s === latest.s;
        return `<li class="rank-row rank-${i + 1}${isNew ? ' is-new' : ''}">` +
          `<span class="r-medal">${medals[i]}</span>` +
          `<span class="r-name">${esc(r.n)}</span>` +
          `<span class="r-time">${r.s.toFixed(1)}초</span></li>`;
      })
      .join('');
  }
}
