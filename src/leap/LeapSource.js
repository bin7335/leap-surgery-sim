/**
 * 손 트래킹 데이터 소스의 공통 인터페이스(베이스 클래스).
 *
 * 구현체:
 *   - MockLeapSource       : 하드웨어 없이 애니메이션된 가짜 손 (개발/데모 폴백)
 *   - WebSocketLeapSource  : 립모션 트래킹 서비스(브리지)의 실시간 데이터
 *
 * 어느 구현이든 아래 이벤트를 방출한다:
 *   'frame'  : (NormFrame)  매 프레임 정규화된 손 데이터
 *   'status' : ('mock'|'connecting'|'live'|'error') 연결 상태 변화
 */
export class LeapSource {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    this.mode = 'desktop'; // 'desktop' | 'hmd'
  }

  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this._listeners.get(event)?.delete(cb);
  }

  _emit(event, payload) {
    this._listeners.get(event)?.forEach((cb) => cb(payload));
  }

  /** 마운트 모드 변경 (데스크톱 / 헤드마운트) */
  setMode(mode) {
    this.mode = mode;
  }

  // 하위 클래스에서 구현
  connect() { throw new Error('not implemented'); }
  dispose() { throw new Error('not implemented'); }
}
