import { LeapSource } from './LeapSource.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// MediaPipe 랜드마크 인덱스: 0=손목, 손가락별 [mcp, pip, dip, tip]
const FINGER_LM = [
  [1, 2, 3, 4],     // 엄지
  [5, 6, 7, 8],     // 검지
  [9, 10, 11, 12],  // 중지
  [13, 14, 15, 16], // 약지
  [17, 18, 19, 20], // 소지
];

// 이미지 좌표(0..1) → 립모션 mm 호환 좌표(기존 매핑 재사용을 위해)
const X_RANGE = 300; // 화면 가로 → ±150mm
const Z_MIN = 45, Z_MAX = 165; // 화면 세로 → 립모션 z(앞뒤) 범위

/**
 * 웹캠(MediaPipe Hands) 기반 손 트래킹 소스.
 * 프레임을 립모션과 동일한 정규화 형식으로 방출해, 나머지 파이프라인을 그대로 재사용한다.
 * 핀치 = 엄지끝-검지끝 거리(손 크기로 정규화).
 */
export class WebcamSource extends LeapSource {
  constructor() {
    super();
    this._video = null;
    this._landmarker = null;
    this._raf = 0;
    this._running = false;
  }

  async connect() {
    if (this._running) return;
    this._emit('status', 'connecting');
    try {
      // 카메라 권한 + 스트림
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      this._video = document.createElement('video');
      this._video.srcObject = stream;
      this._video.muted = true;
      this._video.playsInline = true;
      await this._video.play();

      // MediaPipe 로드(wasm + 모델은 CDN — 오프라인 부스에서는 로컬화 필요, PRD 참고)
      const fileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      this._landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        numHands: 2,
        runningMode: 'VIDEO',
      });

      this._running = true;
      this._emit('status', 'live');
      const loop = () => {
        if (!this._running) return;
        this._detect();
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    } catch (e) {
      console.warn('[webcam] 시작 실패:', e);
      this._emit('status', 'error');
    }
  }

  _detect() {
    if (!this._landmarker || this._video.readyState < 2) return;
    const res = this._landmarker.detectForVideo(this._video, performance.now());
    const hands = [];
    for (let h = 0; h < (res.landmarks?.length ?? 0); h++) {
      const lm = res.landmarks[h];
      // MediaPipe 라벨은 "거울 반전 이미지" 기준 — 원본 스트림을 쓰므로 라벨을 그대로 사용
      const label = res.handednesses?.[h]?.[0]?.categoryName ?? 'Right';
      const type = label === 'Left' ? 'left' : 'right';

      const toMM = (p) => [(0.5 - p.x) * X_RANGE, 0, Z_MIN + p.y * (Z_MAX - Z_MIN)];
      const wrist = lm[0];
      const midMcp = lm[9];
      const handSize = Math.hypot(wrist.x - midMcp.x, wrist.y - midMcp.y) || 0.1;

      // 핀치: 엄지끝(4)-검지끝(8) 거리를 손 크기로 정규화 → 0(벌림)~1(붙음)
      const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / handSize;
      const pinch = Math.min(1, Math.max(0, 1.15 - pinchDist * 1.6));

      const fingers = FINGER_LM.map((idx, type_) => ({
        type: type_,
        joints: [lm[0], ...idx.map((i) => lm[i])].map(toMM),
      }));

      // 손바닥 중심 ≈ 손목과 중지 MCP의 중간
      const palm = toMM({ x: (wrist.x + midMcp.x) / 2, y: (wrist.y + midMcp.y) / 2 });
      hands.push({ type, palm, grab: pinch, pinch, fingers });
    }
    this._emit('frame', { timestamp: performance.now(), hands });
  }

  dispose() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    this._landmarker?.close?.();
    this._video?.srcObject?.getTracks?.().forEach((t) => t.stop());
    this._video = null;
  }
}
