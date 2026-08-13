/**
 * DOM HUD 배선: 상태 배지, 미션 문구, 도구/제어/마운트 토글, 텔레메트리, 리셋.
 * 콜백으로 앱 로직과 연결한다.
 */
export class Hud {
  constructor({ onControl, onMount, onReset }) {
    this.onControl = onControl;
    this.onMount = onMount;
    this.onReset = onReset;

    this.$status = document.getElementById('status');
    this.$statusText = document.getElementById('status-text');
    this.$power = document.getElementById('pinch-val');
    this.$depth = document.getElementById('pos-depth');
    this.$progCut = document.getElementById('progress-cut');
    this.$progSuture = document.getElementById('progress-suture');

    this._wireGroup('control-switch', 'control', (v) => this.onControl(v));
    this._wireGroup('mount-switch', 'mount', (v) => this.onMount(v));
    document.getElementById('reset').addEventListener('click', () => this.onReset());
  }

  _wireGroup(id, attr, cb) {
    const group = document.getElementById(id);
    group.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        cb(btn.dataset[attr]);
      });
    });
  }

  setStatus(state) {
    const label = { mock: '목(mock) 데이터', connecting: '연결 중…', live: '립모션 연결됨', error: '연결 끊김' }[state] || state;
    this.$status.className = `panel status status--${state}`;
    this.$statusText.textContent = label;
  }

  setTelemetry(pinch, depthMm) {
    const power = Math.round(pinch * 80);
    this.$power.textContent = `${power} W`;
    this.$power.className = `cell__val ${pinch > 0.5 ? 'val--red' : 'val--green'}`;
    this.$depth.textContent = `${depthMm.toFixed(1)} mm`;
  }

  setProgress(tool, pct) {
    (tool === 'CUT' ? this.$progCut : this.$progSuture).textContent = `${pct}%`;
  }

  resetProgress() {
    this.$progCut.textContent = '0%';
    this.$progSuture.textContent = '0%';
  }
}
