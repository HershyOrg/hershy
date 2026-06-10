# strategy-editor

전략 캔버스와 노드 편집기 전용 feature 코드입니다.

- `components`: 노드, 엣지, 툴바, 캔버스 UI 컴포넌트입니다.
- `store`: 전략 실행, 히스토리, 메타데이터 상태 저장소입니다.
- `types`: 노드와 그래프 편집기 타입입니다.
- `utils`: 그래프 변환, 레이아웃, 조건 브래킷 같은 순수 로직입니다.
- `mock-data`: 전략 편집기에서 쓰는 데모 전략과 Binance 데모 데이터입니다.
- `api`: 전략 편집기 전용 API client가 필요해질 때 들어갈 자리입니다. 현재 공통 더미 API는 `shared/api`에 있습니다.
- `hooks`: 전략 편집기 전용 hook이 들어갈 자리입니다.
