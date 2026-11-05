# 립모션 로봇수술 시뮬레이션 체험 (Leap Surgery Sim)

립모션(Leap Motion) 또는 **웹캠** 손 트래킹으로 **양손 레이저 도구를 조작**해 3D 장기를 절개하고 봉합하는 교육용 웹 데모입니다. (Vite + Three.js)

## 🌐 라이브 데모

**https://bin7335.github.io/leap-surgery-sim/**

설치 없이 바로 체험 가능:
- **웹캠 모드** — 카메라만 있으면 손으로 조작 (MediaPipe)
- **마우스 모드** — 상단 [절개|봉합] 토글 + 클릭
- **자동 시연** — 절개→봉합 수술 루프 반복
- **립모션 모드** — 립모션+Orion 설치된 PC에서 (아래 참고)

## 조작

- **오른손 집게(핀치) → 빨강 레이저 절개** / **왼손 집게 → 파랑 레이저 봉합**
- 평소엔 초록 레이저로 조준, 확실히 핀치하면 발사
- 절개하면 붉은 내부 조직이 드러나고, 봉합하면 켈로이드 흉터만 남으며 아묾

## 게임 모드

- **🩹 연습 모드**: 자유 절개·봉합
- **🏆 기록 도전**: 이름 입력 → 부위 2곳 연속 수술(절개→종양 제거→봉합) 타임어택. 빗나가면 시간 페널티. TOP5 순위판(브라우저 저장).

자세한 기획·구현 내용은 [`docs/PRD.md`](docs/PRD.md) 참고.

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:5173/leap-surgery-sim/ 접속.
- 하드웨어 없이 테스트: 마우스/웹캠 모드 또는 `?mock`(가짜 손), `?perf`(성능 계측)

## 배포

```bash
npm run deploy   # 빌드 후 gh-pages 브랜치로 GitHub Pages 배포
```

## 립모션 연동 (실기기 — 로컬 서버 없이 웹에서 바로 사용 가능)

별도로 로컬 서버(`npm run dev`)를 띄우지 않아도, PC에 **Orion 4.1.0 드라이버와 `LeapService`**만 실행 중이면 배포된 웹페이지(**https://bin7335.github.io/leap-surgery-sim/**)에서 로컬 웹소켓(`ws://127.0.0.1:6437/v6.json`)으로 즉시 연결됩니다.

### 1) 드라이버 설치 및 필수 설정 (1세대 오리지널 컨트롤러 기준)
1. **반드시 Leap Motion Orion 4.1.0 (`4.1.0+52211`) 설치**
   - ⚠️ 상위 버전인 **Ultraleap Gemini V5 이상**은 기본 웹소켓 서버가 빠져 있어 별도 브리지 없이는 웹앱과 연결되지 않습니다. 무조건 **Orion 4.1.0**으로 설치하세요.
2. 트레이 아이콘(`C:\Program Files\Leap Motion\Core Services\LeapControlPanel.exe`) 실행 → **General 탭 → "Allow Web Apps(웹앱 허용)" 체크** (`ws://127.0.0.1:6437` 활성화).
3. 웹페이지 접속 후 좌상단에서 **"립모션" 모드** 선택 → 배지가 **"립모션 연결됨"**으로 바뀌면 양손으로 즉시 조작 가능.

### 2) 서비스 및 설정 파일(`config.json`) 빠른 점검
제어판 UI를 열지 않고도 아래 설정이 적용되어 있으면 USB만 꽂아 바로 동작합니다.

- **백그라운드 서비스 확인 (PowerShell)**:
  ```powershell
  Get-Service -Name "LeapService"   # Status가 Running이어야 함 (중지 시 Start-Service LeapService)
  ```
- **설정 파일 경로**: `%APPDATA%\Leap Motion\config.json` 및 `C:\ProgramData\Leap Motion\config.json`
- **권장 `config.json` 값** (웹소켓 활성화 + 조명 간섭 시 딜레이 유발하는 Robust 모드 비활성화):
  ```json
  {
    "configuration": {
      "auto_install_updates": false,
      "image_processing_auto_flip": false,
      "images_mode": 2,
      "metrics_enabled": false,
      "no_cp_startup": true,
      "robust_mode_enabled": false,
      "websockets_enabled": true
    }
  }
  ```

### 3) 현장 운영 및 브라우저 연결 문제 해결
- **브라우저 차단 해제**: Chrome/Edge에서 `https://` 페이지가 로컬 `ws://127.0.0.1:6437`에 접근할 때 로컬 네트워크 권한 팝업이 뜨면 **[허용]**을 누르세요. 만약 연결이 막히면 주소창 왼쪽 아이콘(사이트 설정) → **안전하지 않은 콘텐츠(Insecure content) → 허용**으로 변경하면 즉시 연결됩니다.
- **조명 주의**: 센서에 직사광선이나 할로겐 조명이 닿으면 적외선(IR) 간섭으로 인해 트래킹 지연이 커집니다. 실내 LED 조명 환경에서 사용하세요.

## 3D 모델 배치

사실적 장기 모델은 라이선스·용량 문제로 저장소(master)에 포함하지 않습니다.
[`public/models/README.md`](public/models/README.md)를 참고해 GLB를 직접 배치하세요(없으면 절차적 위장으로 폴백).

## 기술 스택

Vite · Three.js(0.169) · three-mesh-bvh · MediaPipe Tasks Vision(웹캠) · 립모션 WebSocket(v6.json)

> 웹캠 모드는 MediaPipe 엔진/모델을 CDN에서 로드합니다(인터넷 필요). 오프라인 부스는 립모션 또는 마우스 모드 사용.
