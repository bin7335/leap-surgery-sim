import { LeapSource } from './LeapSource.js';

/**
 * 립모션 트래킹 서비스의 WebSocket JSON 프로토콜(v6)에 직접 연결한다.
 *
 * 연결 대상: ws://127.0.0.1:6437/v6.json
 *   - 구버전(Orion V4/v3.2.1) 트래킹 서비스: 이 포트를 네이티브로 제공
 *   - Gemini V5+: Ultraleap 공식 브리지(UltraleapTrackingWebSocket)를 실행하면 동일 포트로 제공
 *
 * 참고: https://github.com/ultraleap/UltraleapTrackingWebSocket
 */
export class WebSocketLeapSource extends LeapSource {
  constructor(url = 'ws://127.0.0.1:6437/v6.json') {
    super();
    this._url = url;
    this._ws = null;
    this._retry = null;
    this._lastFrame = 0;
    this._live = false;
    // 서비스만 살아있고 기기가 없으면 소켓은 열리지만 프레임이 안 온다 →
    // 실제 프레임이 흐를 때만 'live', 2초 이상 끊기면 'nodevice'
    this._heartbeat = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN && this._live && performance.now() - this._lastFrame > 2000) {
        this._live = false;
        this._emit('status', 'nodevice');
      }
    }, 1000);
  }

  connect() {
    this._emit('status', 'connecting');
    this._open();
  }

  _open() {
    let ws;
    try {
      ws = new WebSocket(this._url);
    } catch (e) {
      this._scheduleRetry();
      return;
    }
    this._ws = ws;

    ws.onopen = () => {
      // 포커스/백그라운드 트래킹 설정 전송. 연결됨 표시는 실제 프레임 수신 시점에.
      ws.send(JSON.stringify({ focused: true }));
      ws.send(JSON.stringify({ background: true }));
      this._emit('status', 'nodevice'); // 프레임이 오기 전까지는 기기 미확인
    };

    ws.onmessage = (evt) => {
      let data;
      try { data = JSON.parse(evt.data); } catch { return; }
      if (!data || !Array.isArray(data.hands)) return; // 버전 메시지 등은 무시
      this._lastFrame = performance.now();
      if (!this._live) { this._live = true; this._emit('status', 'live'); }
      this._emit('frame', this._normalize(data));
    };

    ws.onerror = () => { /* onclose에서 재시도 처리 */ };
    ws.onclose = () => {
      this._live = false;
      this._emit('status', 'error');
      this._scheduleRetry();
    };
  }

  setMode(mode) {
    super.setMode(mode);
    // 연결 중이면 트래킹 서비스에 즉시 반영
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ optimizeHMD: mode === 'hmd' }));
    }
  }

  _scheduleRetry() {
    clearTimeout(this._retry);
    this._retry = setTimeout(() => this._open(), 2000);
  }

  /** v6 프레임 → 정규화 프레임 */
  _normalize(data) {
    const pointablesByHand = new Map();
    for (const p of data.pointables || []) {
      if (!pointablesByHand.has(p.handId)) pointablesByHand.set(p.handId, []);
      pointablesByHand.get(p.handId).push(p);
    }

    const hands = (data.hands || []).map((h) => {
      const fingers = (pointablesByHand.get(h.id) || []).map((p) => ({
        type: p.type,
        // 손목 → 끝 방향 관절 5개
        joints: [
          p.carpPosition || p.mcpPosition,
          p.mcpPosition,
          p.pipPosition,
          p.dipPosition,
          p.tipPosition || p.btipPosition,
        ].filter(Boolean),
      }));

      return {
        type: h.type === 'left' ? 'left' : 'right',
        palm: h.palmPosition,
        grab: h.grabStrength ?? 0,
        pinch: h.pinchStrength ?? 0,
        fingers,
      };
    });

    return { timestamp: data.timestamp || 0, hands };
  }

  dispose() {
    clearInterval(this._heartbeat);
    clearTimeout(this._retry);
    if (this._ws) {
      this._ws.onclose = null; // 재시도 방지
      this._ws.close();
      this._ws = null;
    }
  }
}
