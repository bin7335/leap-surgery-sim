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

## 립모션 연동 (실기기)

1세대 오리지널 컨트롤러 기준:
1. **Leap Motion Orion 4.1.0** 설치.
2. Leap Control Panel → **"Allow Web Apps(웹앱 허용)" 체크** → 웹소켓(`ws://127.0.0.1:6437`) 활성화.
3. 앱에서 **"립모션" 모드** 선택 → 배지가 "립모션 연결됨"이면 손으로 조작.

> Gemini V5는 웹소켓을 기본 제공하지 않으므로(브리지 필요) 이 데모는 Orion 4.1 웹소켓을 사용합니다.
> 현장 운영 팁: 센서에 직사광/할로겐 조명이 닿으면 Robust 모드로 지연이 커집니다 — PRD의 부스 체크리스트 참고.

## 3D 모델 배치

사실적 장기 모델은 라이선스·용량 문제로 저장소(master)에 포함하지 않습니다.
[`public/models/README.md`](public/models/README.md)를 참고해 GLB를 직접 배치하세요(없으면 절차적 위장으로 폴백).

## 기술 스택

Vite · Three.js(0.169) · three-mesh-bvh · MediaPipe Tasks Vision(웹캠) · 립모션 WebSocket(v6.json)

> 웹캠 모드는 MediaPipe 엔진/모델을 CDN에서 로드합니다(인터넷 필요). 오프라인 부스는 립모션 또는 마우스 모드 사용.
