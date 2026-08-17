# 해부 모델 넣는 곳

여기에 3D 해부 모델을 넣으면 앱이 자동으로 불러와 절차적(코드) 위장을 대체합니다.
(파일이 없으면 지금처럼 절차적 위장으로 표시됩니다.)

## 넣는 방법 (아래 중 하나면 됨 — 자동 인식)

앱이 다음 경로를 순서대로 찾습니다:

1. `public/models/organ.glb`          ← 단일 GLB 파일이면 이 이름으로 저장 (권장)
2. `public/models/organ/scene.gltf`   ← Sketchfab glTF 폴더를 통째로 `organ/`에 넣은 경우
3. `public/models/scene.gltf`         ← glTF 폴더 내용을 여기 바로 푼 경우

### Sketchfab에서 받은 경우
- **glTF Binary (.glb)** 로 받았으면 → 파일명을 `organ.glb` 로 바꿔 여기에 저장.
- **glTF (폴더/zip)** 로 받았으면 → 압축을 풀어 `scene.gltf` + `scene.bin` + `textures/` 를
  통째로 `public/models/organ/` 폴더 안에 넣기.

## 라이선스 주의
- CC BY-NC 모델은 **비영리(학교 교육용) 사용 + 제작자 크레딧 표기** 조건.
- 크레딧은 앱 화면이나 안내판에 "모델: 제작자명 (출처, 라이선스)" 형태로 남기세요.

## 상업 이용까지 필요하면
- BodyParts3D(CC BY-SA) `.obj` 를 받아 프로젝트에 두면 GLB 변환을 도와줄 수 있음.
