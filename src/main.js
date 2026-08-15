import './style.css';
import { OperatingScene } from './scene/OperatingScene.js';
import { InputController } from './InputController.js';
import { WebSocketLeapSource } from './leap/WebSocketLeapSource.js';
import { MockLeapSource } from './leap/MockLeapSource.js';
import { Hud } from './ui/Hud.js';

// 립모션 소스: 기본은 실시간(WebSocket 브리지). ?mock 이면 하드웨어 없이 가짜 손.
const useMock = new URLSearchParams(location.search).has('mock');
const leap = useMock ? new MockLeapSource() : new WebSocketLeapSource();

const scene = new OperatingScene(document.getElementById('scene'));
const input = new InputController(scene, leap);

const hud = new Hud({
  onControl: (m) => input.setControlMode(m),
  onMount: (m) => input.setMountMode(m),
  onReset: () => { scene.reset(); hud.resetProgress(); },
});

leap.on('status', (s) => hud.setStatus(s));
leap.connect();

window.addEventListener('resize', () => scene.resize());

// 성능 계측(?perf): FPS / 변형 소요시간 / 수술 메시 정점 수
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

function animate() {
  requestAnimationFrame(animate);
  const cmd = input.update();
  const result = scene.update(cmd.hands);

  if (perfOn) {
    frames++;
    const now = performance.now();
    if (now - fpsT0 >= 500) {
      const fps = Math.round((frames * 1000) / (now - fpsT0));
      $fps.textContent = `${fps} FPS`;
      $fps.className = fps >= 50 ? '' : fps >= 30 ? 'warn' : 'bad';
      const dm = scene.deformer.lastMs;
      $deform.textContent = `deform ${dm.toFixed(1)}ms`;
      $deform.className = dm <= 4 ? '' : dm <= 10 ? 'warn' : 'bad';
      $verts.textContent = `${(scene.surgeryMesh.geometry.attributes.position.count / 1000).toFixed(0)}k verts`;
      const calls = scene.renderer.info.render.calls;
      $calls.textContent = `${calls} calls`;
      $calls.className = calls <= 150 ? '' : calls <= 400 ? 'warn' : 'bad';
      frames = 0; fpsT0 = now;
    }
  }
  // 활성 손(핀치 중)의 세기/깊이를 텔레메트리로
  const active = cmd.hands.right.pinch > 0.5 ? cmd.hands.right
    : cmd.hands.left.pinch > 0.5 ? cmd.hands.left
    : cmd.hands.right.present ? cmd.hands.right : cmd.hands.left;
  hud.setTelemetry(active.pinch, active.target.y * 10);
  if (result) hud.setProgress(result.tool, result.progress);
}
animate();
