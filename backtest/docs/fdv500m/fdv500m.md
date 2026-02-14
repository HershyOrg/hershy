지금 이 채팅 환경에서는 **거래소/코인 API의 JSON 응답을 파일로 직접 “다운로드”해서 스프레드시트로 가공하는 작업이 막혀있어서**, 제가 여기서 곧바로 “전부 다” 테이블을 만들어 드리긴 어려워요. 대신 **로컬(또는 Colab)에서 한 번에 실행하면** 요청하신 것처럼 **FDV 500M 이하 코인만 골라서**, **Binance/Bitget/OKX/Gate.io/Bybit의 현물·선물(퍼프 포함) 페어를 이름순으로 정리한 Excel**을 자동 생성하는 스크립트를 만들어뒀어요. (공식/공개 엔드포인트 기반) ([CoinGecko API][1])

### 1) 파일 다운로드

* [fdv500m_pairs.py](sandbox:/mnt/data/fdv500m_pairs.py)
* [requirements.txt](sandbox:/mnt/data/requirements.txt)
* [README_fdv500m_pairs.md](sandbox:/mnt/data/README_fdv500m_pairs.md)

### 2) 실행 방법 (Mac/Windows 공통)

터미널에서 파일 있는 폴더로 이동해서:

```bash
pip install -r requirements.txt
python fdv500m_pairs.py --out fdv_le_500m_pairs.xlsx
```

선택(권장): CoinGecko가 최근 **데모 키 헤더(x-cg-demo-api-key)**를 쓰는 경우가 있어요. 키가 있으면 환경변수로 넣어두면 더 안정적입니다. ([CoinGecko API][1])

```bash
export COINGECKO_DEMO_API_KEY="YOUR_KEY"
```

### 3) 결과물(엑셀) 구성

* **Summary**: FDV ≤ 500M 코인 목록 + 어느 거래소에 있는지 요약 (이름순)
* **각 거래소 시트**: `Coin Name / Symbol / FDV / Spot pairs / Futures(perp 포함) pairs` (이름순)
* **AllPairs_Normalized**: (exchange, symbol, market, pair) 형태로 정규화된 원본 테이블
* **Ambiguous_Symbols**: 심볼이 겹쳐서(예: 같은 티커가 다른 코인) CoinGecko 매칭이 애매한 것들 목록
  ↳ 참고로 **FDV(fully diluted valuation)**는 CoinGecko의 FDV 지표(fully_diluted_valuation)를 사용합니다. ([CoinGecko][2])

### 4) 주의/한계 (그래도 “전부”에 최대한 가깝게)

* **심볼 충돌**: 티커는 전세계적으로 유일하지 않아서, 스크립트는 “같은 심볼이면 시총이 가장 큰 CoinGecko 항목”으로 기본 매칭하고, 다중 매칭은 `Ambiguous_Symbols`로 따로 뽑습니다.
* **Binance 스팟**: 어떤 네트워크/지역에서는 `exchangeInfo`가 막힐 수 있어요. 그 경우 스크립트가 공식 시장데이터 전용 도메인도 시도하고(가능하면), 마지막엔 `/ticker/price` 기반 휴리스틱으로 페어를 추정합니다. ([Binance Developer Center][3])
* **Bybit 선물**: `linear/inverse`는 심볼이 많아 `cursor`로 페이지네이션이 필요할 수 있어서 스크립트가 자동 처리합니다. ([Bybit Exchange][4])

원하시면, 스크립트 돌려서 나온 **`fdv_le_500m_pairs.xlsx`를 여기 업로드**해 주세요. 그 파일 기준으로 “정확히 원하는 표 형태(예: 거래소별/코인별 피벗, 현물·선물 분리 표, CSV로도)”로 더 깔끔하게 다듬어 드릴게요.

[1]: https://docs.coingecko.com/v3.0.1/reference/coins-markets?utm_source=chatgpt.com "Coins List with Market Data"
[2]: https://www.coingecko.com/?utm_source=chatgpt.com "CoinGecko: Cryptocurrency Prices, Charts, and Crypto Market ..."
[3]: https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only "https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only"
[4]: https://bybit-exchange.github.io/docs/v5/market/instrument "https://bybit-exchange.github.io/docs/v5/market/instrument"
