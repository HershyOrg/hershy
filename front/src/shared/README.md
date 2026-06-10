# shared

여러 feature나 page에서 같이 쓰는 프론트엔드 공용 코드입니다.

- `components`: 공용 React 컴포넌트입니다. `ui`에는 shadcn 기반 기본 UI 컴포넌트가 들어갑니다.
- `hooks`: 공용 React hook입니다.
- `api`: 브라우저에서 직접 쓰는 API client 자리입니다. 현재는 백엔드 없이 `dummyApi.ts`가 화면 데이터를 제공합니다.
- `store`: 앱 전역 브라우저 상태 저장소입니다.
- `types`: feature 간 공유되는 타입 정의입니다.
- `utils`: 순수 유틸 함수입니다.
- `constants`: 공용 상수입니다.
- `mock-data`: 여러 영역에서 공유되는 데모 데이터입니다.
