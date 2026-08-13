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

function animate() {
  requestAnimationFrame(animate);
  const cmd = input.update();
  const result = scene.update(cmd.hands);
  // 활성 손(핀치 중)의 세기/깊이를 텔레메트리로
  const active = cmd.hands.right.pinch > 0.5 ? cmd.hands.right
    : cmd.hands.left.pinch > 0.5 ? cmd.hands.left
    : cmd.hands.right.present ? cmd.hands.right : cmd.hands.left;
  hud.setTelemetry(active.pinch, active.target.y * 10);
  if (result) hud.setProgress(result.tool, result.progress);
}
animate();
