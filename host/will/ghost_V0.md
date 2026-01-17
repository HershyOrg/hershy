# GhostLang_V0

## 목표

- Ghost v1의 열화판 빠르게 만들기
- Ghost, Event, Func는 구현하되 그 내부적인 대수적 구조는 생략하기.

## 구성

언어 Will (event, ghost라는 특수 타입을 지님.)

내부 런타임 객체 Ghost (런타임이 관리하는 프로세스. 격리된 메모리와 상태)

런타임 호스트 Shell

## 예시

예시 1

- 선언된 이벤트는 ghost, func에서 쓰임.
- ghost는 Mount(schedule)을 이용해 마운트됨.

```go
func main(body Body){
// event는 type 선언하듯 선언함
event BitPriceChanged struct {
 Price int
}

// 이벤트엔 메서드를 달 수 있음
func (e BitPriceChanged) String() string {
 return fmt.Printf("bit price changed %d", e.Price)
}

ghost[PriceChangedEvent->OrderResultEvent] OrderGhost(exClient ExchangeClient) {
 // 초기화
 market := exClient.FetchMarket("BitMarket")
 
 //반복
 priceEvent <- PriceChangedEvent
 limitPrice := priceEvent.Price - 1.0
 market.Buy("bit", limitPrice, 1)
 BitOrderEvent{Price: limitPrice, size: 1}->OrderResultEvent
 
 // 종료
 println("종료됨")
}

result := OrderGhost(init).Mount(Once) //Mount를 통해 해당 Ghost의 생존 기간 지정 가능.

//힘수를 이용한 경우 
ghost[PriceChangedEvent->OrderEvent] OrderGhost(exClient ExchangeClient) {
 // 초기화
 market := exClient.FetchMarket("BitMarket")
 // 반복
 priceEvent <- PriceChangedEvent
 switch priceEvent {
  // 리턴 이벤트가 합 타입인 것을 이용.
  case BitPriceChanged:
       OrderBitFunc(priceEvent, market)-> BitOrderEvent
  case EthPriceChanged:
     OrderEthFunc(priceEvent, market) -> EthOrderEvent
 }
 
}
// 함수는 이벤트를 매게변수와 리턴값으로 다룰 수 있음.
func OrderBitFunc(event BitPriceChanged, market MarketClient) EthOrderEvent {
 //...거래 코드...///
 return BitOrderEvent{price:1}
} 
func OrderEthFunc(event BitPriceChanged, market MarketClient) EthOrderEvent {
 //...거래 코드...///
 return EthOrderEvent{price:1}
} 

}
```

예시 2

- ghost는 이벤트를 처리함(생산-소비)
- ghost합성 파이프라인에서 소비된 이벤트는 ghost합성 파이프를 빠져나가지 않음
- 처리되지 못한 이벤트는 main루프 내에서 cascading됨. c의 switch와 유사. 
- cascade시 매치되는 이벤트를 소비하는 모든 ghost에 차례로 이벤트 주입함.

```go
func main(body Body){
 ghost[None->SomeEvent] Emitter(){
 //...이벤트 발생//
 }
 
 ghost CatchEmit interface = { SomeEvent->None }
 ghost[CatchEmit] G1 (){....}
 ghost[CatchEmit] G2 (){...}
 
 // 아래와 같은 겨우 Emitter가 tick될 때마다 매번 G2, G1순으로 두 Ghost가 반응함
 Emitter().Mount()
 G2().Mount()
 G1().Mount()
 
 
 //이벤트가 Ghost내부에서 처리될 경우, 
 //Emitter의 이벤트는 핸들링되며, 전파되는 이벤트는 없음.
 //따라서 아래의 G1().Mount()는 컴파일 에러가 남.
 Emitter()->G2().Mount()
 G1().Mount()
 
 // 합성으로 처리하고 싶다면 이렇게 해야함.
 Emitter()->G1()&G2().Mount()
}
```

## Will의 특징

### event, ghost, func

- event: ghost와 func가 다루는 대상.
- ghost: event를 지속적으로 수신 후 반응하는 객체.
(ghost는 합성될 수 있음)
(런타임의 Ghost와는 다름)
- func: 함수. 함수는 event를 받아서 리턴할 수 있음. (ghost는 제외.)

### event

- event는 “불변 객체”임. (=Read-only)
- 모든 이벤트는 기본값으로 none을 지님.
- func, react는 event를 다룰 수 있음
- event에 메서드(리시버)를 달 수 있음

### ghost

- ghost는 자동으로 병렬 스레드로 처리됨.
(go로 따지면, Ghost하나당 go루틴 하나 매핑)
- ghost내에서 소비된 이벤트는 ghost를 벗어나지 않음.
- ghost는 Event→Event타입의 프로시저로, 부수효과로 init state를 받음.
- ghost는 자유변수를 지닐 수 없음.
  모든 내부 변수는 지역변수거나, 매개변수로부터 참조됨.
  이렇게 명시적으로 해야 그나마 디버깅 쉬워짐.
- ghost의 코드는 3부분으로 나뉘어짐
    1. 초기화: “←” 심볼 이전의 영역. Mount시 한 번 호출됨.
    2. 반복: “←”와 “→”사이 영역. 이벤트를 받을 때마다 이 영역이 핸들링됨.
    3. 마무리: “→” 심볼 이후의 영역. 반복이 종료된 후 실행됨.
- →는 “리턴”과 같음.
  Ghost내에서 → 는 여러번 호출될 수 없음. 이벤트 emit은 아토믹해야 함.
- ghost는 “Mount(timeSlice)”를 통해서 호출됨.

## Will의 기반

### GO lang

- event, ghost를 제외한 나머지 will의 문법은 go를 상속함
- 클로저, 호이스팅 로직, 다중선언 및 다중 리턴 로직 등
- 단 아래와 같은 사항은 go로부터 상속받지 않음 (의도적 배제)
    1. go루틴
    2. chan
- 또한 아래와 같은 사항은 "아직은" 상속받지 않음 (MVP용 언어에 따른 배제)
    1. interface
    2. 제너릭
- 현재 단계에서 구현할 것은 다음과 같음
    1. int, bool, string, float, nil과 같은 빌트인 타입과 상수 구현
    2. *T, T[], map[K]V와 같은 복합 타입의 구현
    3. type XXX struct {}를 통한 커스텀 타입 정의 구현.
    4. func (a *A) XXX(){}를 통한 리시버 함수 구현.
    5. go의 계산모델 구현. (호이스팅, 정적 바인딩, main함수부터 실행, 다중선언과 다중할당, 다중리턴.)

### Will의 특수 기능

- 현재 단계에서 다음과 같은 will의 특수 기능을 구현함
- Will의 계산모델
    1. main함수 내에서만 ghost를 Mount()할 수 있음.
    2. ghost가 발생한 이벤트는 ghost합성 파이프라인에서 처리되거나, 그렇지 못하면 케스케이딩됨.
- Will의 타입
    1. event 선언. (리시버 함수도 선언 가능함)
    2. event 사용. (함수와 ghost의 사용)
    3. ghost 선언. (event이용. 선언 시 자유변수 불가)
    4. ghost의 호출. (init을 주는 호출 및, .Mount(schedule)을 이용한 호출)
    5. body의 이용. (main함수는 인자로 body Body를 받음. 이를 통해 기초적인 환경변수나 설정값을 받아옴)

## Ghost의 특징

### Ghost의 기능

- Ghost는 Will이 표현된 런타임 구조체임
- WIll이 언어라면, Ghost는 Will의 ast및 실행에 필요한 정보를 담은 캡슐임
- Ghost는 자신의 런타임인 Shell위에서 스케쥴링됨.

## 제약

- 현재 시점에서 다음과 같은 것은 구현하지 않음.
- 아래 사항은 신경쓰지 말 것.
- 이 외에도 더 많은 미구현 사항 존재. 그것은 노션 참고. (net관련, ?! 관련 등.)
- event의 인터페이스, 합타입, 곱타입
- ghost의 인터페이스, 합타입, 곱타입
- ghost합성에서의 병렬 제어
- shell 마운트 시의 자원 상태 관리. (NodeBode, Rebindable, Pure).