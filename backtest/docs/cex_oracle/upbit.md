## 2) WebSocket으로 실시간 오더북 받기 (추천)

### WebSocket URL

`wss://api.upbit.com/websocket/v1`

### 구독 메시지 포맷(핵심)

업비트는 연결 후 **JSON 배열**을 한 번 보내서 구독을 시작해. (ticket → type/codes → format 순)

예시(오더북 + KRW-BTC):

<pre class="overflow-visible! px-0!" data-start="788" data-end="890"><div class="contain-inline-size rounded-2xl corner-superellipse/1.1 relative bg-token-sidebar-surface-primary"><div class="sticky top-[calc(var(--sticky-padding-top)+9*var(--spacing))]"><div class="absolute end-0 bottom-0 flex h-9 items-center pe-2"><div class="bg-token-bg-elevated-secondary text-token-text-secondary flex items-center gap-4 rounded-sm px-2 font-sans text-xs"></div></div></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-json"><span><span>[</span><span>
  </span><span>{</span><span>"ticket"</span><span>:</span><span>"test"</span><span>}</span><span>,</span><span>
  </span><span>{</span><span>"type"</span><span>:</span><span>"orderbook"</span><span>,</span><span>"codes"</span><span>:</span><span>[</span><span>"KRW-BTC"</span><span>]</span><span>}</span><span>,</span><span>
  </span><span>{</span><span>"format"</span><span>:</span><span>"SIMPLE"</span><span>}</span><span>
</span><span>]</span><span>
</span></span></code></div></div></pre>

### “호가 단위(몇 단계)” 줄이기: `.count` 옵션

업비트 WebSocket 오더북은 코드 뒤에 `.count`를 붙여서 **호가 유닛 수를 제한**할 수 있어. 현재 지원되는 값이 `1, 5, 15, 30`으로 안내돼 있어.

* Top 1: `KRW-BTC.1`
* Top 5: `KRW-BTC.5`
* Top 15: `KRW-BTC.15`
* Top 30: `KRW-BTC.30`

예시(Top 15로 가볍게):

<pre class="overflow-visible! px-0!" data-start="1208" data-end="1313"><div class="contain-inline-size rounded-2xl corner-superellipse/1.1 relative bg-token-sidebar-surface-primary"><div class="sticky top-[calc(var(--sticky-padding-top)+9*var(--spacing))]"><div class="absolute end-0 bottom-0 flex h-9 items-center pe-2"><div class="bg-token-bg-elevated-secondary text-token-text-secondary flex items-center gap-4 rounded-sm px-2 font-sans text-xs"></div></div></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-json"><span><span>[</span><span>
  </span><span>{</span><span>"ticket"</span><span>:</span><span>"test"</span><span>}</span><span>,</span><span>
  </span><span>{</span><span>"type"</span><span>:</span><span>"orderbook"</span><span>,</span><span>"codes"</span><span>:</span><span>[</span><span>"KRW-BTC.15"</span><span>]</span><span>}</span><span>,</span><span>
  </span><span>{</span><span>"format"</span><span>:</span><span>"SIMPLE"</span><span>}</span><span>
</span><span>]</span><span>
</span></span></code></div></div></pre>

---

## 3) 파이썬 예제 (WebSocket으로 오더북 받기)

<pre class="overflow-visible! px-0!" data-start="1392" data-end="2352"><div class="contain-inline-size rounded-2xl corner-superellipse/1.1 relative bg-token-sidebar-surface-primary"><div class="sticky top-[calc(var(--sticky-padding-top)+9*var(--spacing))]"><div class="absolute end-0 bottom-0 flex h-9 items-center pe-2"><div class="bg-token-bg-elevated-secondary text-token-text-secondary flex items-center gap-4 rounded-sm px-2 font-sans text-xs"></div></div></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-python"><span><span>import</span><span> asyncio, json, websockets

URL = </span><span>"wss://api.upbit.com/websocket/v1"</span><span>

</span><span>async</span><span></span><span>def</span><span></span><span>main</span><span>():
    </span><span>async</span><span></span><span>with</span><span> websockets.connect(URL) </span><span>as</span><span> ws:
        sub = [
            {</span><span>"ticket"</span><span>: </span><span>"my-orderbook"</span><span>},
            {</span><span>"type"</span><span>: </span><span>"orderbook"</span><span>, </span><span>"codes"</span><span>: [</span><span>"KRW-BTC.15"</span><span>]},  </span><span># 1/5/15/30 가능</span><span>
            {</span><span>"format"</span><span>: </span><span>"SIMPLE"</span><span>},
        ]
        </span><span>await</span><span> ws.send(json.dumps(sub))

        </span><span>while</span><span></span><span>True</span><span>:
            </span><span># 업비트 WS는 바이너리 프레임으로 오는 경우가 있어 decode 필요</span><span>
            msg = </span><span>await</span><span> ws.recv()
            </span><span>if</span><span></span><span>isinstance</span><span>(msg, (</span><span>bytes</span><span>, </span><span>bytearray</span><span>)):
                msg = msg.decode(</span><span>"utf-8"</span><span>)
            data = json.loads(msg)

            </span><span># data 안에 orderbook_units가 들어옴(상위 N단계)</span><span>
            units = data.get(</span><span>"orderbook_units"</span><span>, [])
            </span><span>if</span><span> units:
                best_ask = units[</span><span>0</span><span>][</span><span>"ask_price"</span><span>], units[</span><span>0</span><span>][</span><span>"ask_size"</span><span>]
                best_bid = units[</span><span>0</span><span>][</span><span>"bid_price"</span><span>], units[</span><span>0</span><span>][</span><span>"bid_size"</span><span>]
                </span><span>print</span><span>(</span><span>"best_bid"</span><span>, best_bid, </span><span>"best_ask"</span><span>, best_ask)

asyncio.run(main())
</span></span></code></div></div></pre>

(구독 포맷/오더북 WS 문서는 업비트 개발자 문서에 예시가 있어.)

---

## 4) 너가 “10 depth”를 원하면?

업비트 WS는 **1/5/15/30**만 딱 지원이라  **10은 직접 지정 못 해** .

대신 보통 이렇게 해:

* **`.15`로 받아서 상위 10단계만 잘라서** 저장/시계열화

---

원하면 바로 “저장까지” 같이 잡아줄게.

* 네가 원하는 건 **KRW 마켓(예: KRW-BTC)** 이 맞아?
* 그리고 저장은 **best bid/ask + mid/spread만** 할 거야, 아니면 **상위 10단계 전체**를 남길 거야?
*

응. Upbit에서 말하는 “틱(호가 단위)”은  **주문 가격을 얼마 단위로만 찍을 수 있느냐** (최소 가격 간격)이야. 마켓(KRW/BTC/USDT)마다 규칙이 달라.

---

## KRW 마켓(원화마켓) 호가 단위(틱) — 가격 구간별로 다름

아래가 Upbit 공식 “거래 이용 안내”에 있는 KRW 마켓 틱 규칙이야. ([업비트(UPbit)](https://support.upbit.com/hc/ko/articles/4403838454809-%EA%B1%B0%EB%9E%98-%EC%9D%B4%EC%9A%A9-%EC%95%88%EB%82%B4?utm_source=chatgpt.com "거래 이용 안내"))

| 1코인 가격(원) 구간 | 틱(호가단위) |
| ------------------: | -----------: |
|    1,000,000원 이상 |      1,000원 |
| 500,000 ~ 1,000,000 |        500원 |
|   100,000 ~ 500,000 |        100원 |
|    50,000 ~ 100,000 |         50원 |
|     10,000 ~ 50,000 |         10원 |
|      5,000 ~ 10,000 |          5원 |
|       1,000 ~ 5,000 |          1원 |
|         100 ~ 1,000 |          1원 |
|            10 ~ 100 |        0.1원 |
|              1 ~ 10 |       0.01원 |
|             0.1 ~ 1 |      0.001원 |
|          0.01 ~ 0.1 |     0.0001원 |
|        0.001 ~ 0.01 |    0.00001원 |
|      0.0001 ~ 0.001 |   0.000001원 |
|    0.00001 ~ 0.0001 |  0.0000001원 |
|      0.00001원 미만 | 0.00000001원 |

> 예: KRW-BTC가 60,000,000원대면 틱은 1,000원이어서 **60,000,000 / 60,001,000 / 60,002,000** 같은 가격만 주문 가능.

---

## BTC 마켓 틱(가격이 BTC로 표시되는 마켓)

BTC 마켓은 가격 구간 상관없이  **고정 틱** : `0.00000001 BTC` ([Upbit Developer Center](https://global-docs.upbit.com/docs/btc-market-info.md?utm_source=chatgpt.com "https://global-docs.upbit.com/docs/btc-market-info.md"))

---

## USDT 마켓 틱(글로벌 문서 기준)

USDT 마켓은 **가격 구간별 틱**이 있고, 예를 들어 (문서 예시) 이렇게 안내돼 있어. ([Upbit Developer Center](https://global-docs.upbit.com/changelog/usdt_tick_unit_change?utm_source=chatgpt.com "Changes to the minimum order amount on the BTC, USDT ..."))

| 가격(USDT) 구간 |   틱(USDT) |
| --------------: | ---------: |
|         10 이상 |       0.01 |
|          1 ~ 10 |      0.001 |
|         0.1 ~ 1 |     0.0001 |
|      0.01 ~ 0.1 |    0.00001 |
|    0.001 ~ 0.01 |   0.000001 |
|  0.0001 ~ 0.001 |  0.0000001 |
|     0.0001 미만 | 0.00000001 |

---

## “틱 단위로 가격을 맞춰서 주문가를 만들고 싶다”면

원하는 가격 `p`가 있을 때:

* KRW 마켓: 위 표에서 해당 구간의 `tick`을 찾고
  **`round(p / tick) * tick`** 형태로 “틱에 맞는 가격”으로 보정하면 돼.

---

원하는 게 정확히 이거 맞지?

* **업비트에서 주문 넣을 때 가격을 틱에 맞춰 자동으로 스냅(보정)하는 함수**
  이거면, 너가 쓰는 마켓이 **KRW인지(예: KRW-BTC)** / **USDT인지**만 말해주면 그 마켓 규칙 그대로 반영한 파이썬 함수(반올림/버림 옵션 포함)로 바로 만들어줄게.
