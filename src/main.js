import './style.css';
import { OperatingScene } from './scene/OperatingScene.js';
import { InputController } from './InputController.js';
import { WebSocketLeapSource } from './leap/WebSocketLeapSource.js';
import { MockLeapSource } from './leap/MockLeapSource.js';
import { Hud } from './ui/Hud.js';
import { Mission } from './game/Mission.js';

// 립모션 소스: 기본은 실시간(WebSocket 브리지). ?mock 이면 하드웨어 없이 가짜 손.
const useMock = new URLSearchParams(location.search).has('mock');
const leap = useMock ? new MockLeapSource() : new WebSocketLeapSource();

const scene = new OperatingScene(document.getElementById('scene'));
const input = new InputController(scene, leap);

// 무인 어트랙트: 립모션 모드에서 손이 30초간 없으면 자동 시연으로 전환, 손이 오면 복귀
const ATTRACT_AFTER_MS = 30000;
let lastHandSeen = performance.now();
let autoAttract = false;

const hud = new Hud({
  onControl: (m) => { autoAttract = false; input.setControlMode(m); }, // 수동 선택은 어트랙트 해제
  onReset: () => { scene.reset(); hud.resetProgress(); },
});

leap.on('status', (s) => hud.setStatus(s));
leap.on('frame', (f) => { if (f.hands.length > 0) lastHandSeen = performance.now(); });
leap.connect();

// 게임 모드: 시작 오버레이에서 연습/기록도전 선택
const mission = new Mission(scene, hud);
let gameMode = null; // 'practice' | 'challenge'
const $modeSelect = document.getElementById('mode-select');
const $records = document.getElementById('records');

const $nameEntry = document.getElementById('name-entry');
const $nameInput = document.getElementById('name-input');

function syncGameSwitch() {
  document.getElementById('game-switch').querySelectorAll('button')
    .forEach((b) => b.classList.toggle('is-active', b.dataset.game === gameMode));
}
function startPractice() {
  gameMode = 'practice';
  $modeSelect.hidden = true;
  $nameEntry.hidden = true;
  document.getElementById('result').hidden = true;
  $records.hidden = true;
  mission.stop();
  scene.reset();
  hud.resetProgress();
  syncGameSwitch();
}
/** 도전 진입: 이름 입력 창부터 */
function askChallengerName() {
  $modeSelect.hidden = true;
  $nameEntry.hidden = false;
  $nameInput.value = '';
  setTimeout(() => $nameInput.focus(), 50);
}
/** 이름 확정 → 립모션 모드로 자동 전환 + 미션 시작 */
function startChallenge() {
  const name = $nameInput.value.trim() || '무명의 의사';
  gameMode = 'challenge';
  $nameEntry.hidden = true;
  $records.hidden = false;
  scene.reset();
  hud.resetProgress();
  mission.playerName = name;
  mission.start();
  input.setControlMode('LEAP');
  hud.setControlActive('LEAP');
  syncGameSwitch();
}
function showModeSelect() {
  gameMode = null;
  mission.stop();
  $records.hidden = true;
  $nameEntry.hidden = true;
  document.getElementById('result').hidden = true;
  $modeSelect.hidden = false;
  scene.reset();
  hud.resetProgress();
  syncGameSwitch();
}
// 도전 완료 → 결과 창(자동 재도전 없음)
const $result = document.getElementById('result');
mission.onFinished = ({ name, sec, penalty }) => {
  const pen = penalty > 0.05 ? ` (페널티 +${penalty.toFixed(1)}초)` : '';
  document.getElementById('result-text').textContent = `${name} — 기록 ${sec.toFixed(1)}초${pen}`;
  $result.hidden = false;
};
document.getElementById('btn-retry').addEventListener('click', () => {
  $result.hidden = true;
  scene.reset(); hud.resetProgress();
  askChallengerName(); // 다음 도전자 이름부터
});
document.getElementById('btn-home').addEventListener('click', () => {
  $result.hidden = true;
  showModeSelect();
});

document.getElementById('btn-practice').addEventListener('click', startPractice);
document.getElementById('btn-challenge').addEventListener('click', askChallengerName);
document.getElementById('btn-name-start').addEventListener('click', startChallenge);
document.getElementById('btn-name-cancel').addEventListener('click', showModeSelect);
$nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startChallenge(); });
document.getElementById('btn-mode-select').addEventListener('click', showModeSelect);
// 화면 내 연습↔도전 즉시 전환 토글
document.getElementById('game-switch').querySelectorAll('button').forEach((b) =>
  b.addEventListener('click', () => {
    if (gameMode === b.dataset.game) return;
    if (b.dataset.game === 'practice') startPractice();
    else askChallengerName();
  })
);

window.addEventListener('resize', () => scene.resize());

// 성능 계측(?perf) + 적응형 해상도
// A/B 진단용: ?noshadow(그림자 끔) / ?lowres(픽셀비 1.0)
const params = new URLSearchParams(location.search);
if (params.has('noshadow')) scene.renderer.shadowMap.enabled = false;
if (params.has('lowres')) { scene.renderer.setPixelRatio(1); scene.resize(); }
const perfOn = params.has('perf');
const $perf = document.getElementById('perf');
const $fps = document.getElementById('perf-fps');
const $deform = document.getElementById('perf-deform');
const $verts = document.getElementById('perf-verts');
const $calls = document.getElementById('perf-calls');
if (perfOn) $perf.hidden = false;

let frames = 0, fpsT0 = performance.now();
let lowStreak = 0, prCap = 1.5; // 적응형 해상도: FPS가 계속 낮으면 픽셀비를 한 단계씩 낮춤

function animate() {
  requestAnimationFrame(animate);
  const cmd = input.update();
  const result = scene.update(cmd.hands);
  const now = performance.now();

  // 무인 어트랙트 전환/복귀 (립모션 모드에서만): 손이 없으면 시연 + 모드 선택 화면으로
  if (!autoAttract && gameMode !== null && input.controlMode === 'LEAP' && now - lastHandSeen > ATTRACT_AFTER_MS) {
    autoAttract = true;
    showModeSelect();
    input.setControlMode('DEMO'); hud.setControlActive('DEMO');
  } else if (autoAttract && now - lastHandSeen < 1000) {
    autoAttract = false;
    input.setControlMode('LEAP'); hud.setControlActive('LEAP'); // 모드 선택은 화면에서 진행
  }

  // FPS 측정(항상) → 적응형 해상도 + (?perf) 오버레이
  frames++;
  if (now - fpsT0 >= 1000) {
    const fps = Math.round((frames * 1000) / (now - fpsT0));

    if (fps < 38 && prCap > 1.0) {
      if (++lowStreak >= 3) { // 3초 연속 저FPS → 해상도 한 단계 다운
        prCap = Math.max(1.0, prCap - 0.25);
        scene.renderer.setPixelRatio(Math.min(window.devicePixelRatio, prCap));
        scene.resize();
        lowStreak = 0;
      }
    } else {
      lowStreak = 0;
    }

    if (perfOn) {
      $fps.textContent = `${fps} FPS`;
      $fps.className = fps >= 50 ? '' : fps >= 30 ? 'warn' : 'bad';
      const dm = scene.deformer.lastMs;
      $deform.textContent = `deform ${dm.toFixed(1)}ms`;
      $deform.className = dm <= 4 ? '' : dm <= 10 ? 'warn' : 'bad';
      $verts.textContent = `${(scene.surgeryMesh.geometry.attributes.position.count / 1000).toFixed(0)}k verts`;
      const calls = scene.renderer.info.render.calls;
      $calls.textContent = `${calls} calls (px${prCap})`;
      $calls.className = calls <= 150 ? '' : calls <= 400 ? 'warn' : 'bad';
    }
    frames = 0; fpsT0 = now;
  }

  // 활성 손(핀치 중)의 세기/깊이를 텔레메트리로
  const active = cmd.hands.right.pinch > 0.5 ? cmd.hands.right
    : cmd.hands.left.pinch > 0.5 ? cmd.hands.left
    : cmd.hands.right.present ? cmd.hands.right : cmd.hands.left;
  hud.setTelemetry(active.pinch, active.target.y * 10);
  if (result) {
    if (gameMode === 'challenge') mission.onSurgery(result.tool, result.point);
    else hud.setProgress(result.tool, result.progress); // 연습 모드: 기존 진행률
  }
  if (gameMode === 'challenge') mission.update();
}
animate();
