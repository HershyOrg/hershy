# front

순수 Vite + React 프론트엔드 앱입니다.

- `npm run dev`: Vite 개발 서버를 실행합니다.
- `npm run build`: TypeScript 검사와 Vite production build를 실행합니다.
- `npm run start`: build 결과를 Vite preview로 확인합니다.

현재 `/api/*` 서버 라우트는 사용하지 않습니다. 화면에서 필요한 데이터는 `src/shared/api/dummyApi.ts`의 프론트 더미 API가 반환합니다. 백엔드 연결 시 이 파일의 함수 구현을 실제 HTTP client로 교체하면 됩니다.
