import { defineConfig } from 'vite';

export default defineConfig({
  base: '/leap-surgery-sim/', // GitHub Pages 하위 경로
  server: {
    host: true, // 부스 PC의 다른 브라우저/기기에서도 접속 가능
    open: true,
    watch: {
      // LeapSDK(문서/샘플 수천 개)는 앱 소스가 아니므로 감시 제외 → 로그·부하 감소
      ignored: ['**/LeapSDK/**'],
    },
  },
});
