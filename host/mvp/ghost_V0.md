# GhostLang_V0

## 목표

- Ghost v1의 열화판 빠르게 만들기
- ghost, event, func는 구현하되 그 내부적인 대수적 구조는 생략하기.

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
- 아래 예시의 interface 표기는 개념 설명용이며, MVP에서는 interface를 구현하지 않음.

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
- func, ghost는 event를 다룰 수 있음
- event에 메서드(리시버)를 달 수 있음
- `<-`와 `->`는 모두 비동기 이벤트 수신을 나타냄.
  - `a <- EvtXXX`는 `EvtXXX` 타입 이벤트를 수신하겠다는 의미임.
  - `EvtXXX -> OtherEvt`는 `EvtXXX`를 수신한 뒤 `OtherEvt`를 emit하는 의미로 사용됨.

### ghost

- ghost는 자동으로 병렬 스레드로 처리됨.
(go로 따지면, Ghost하나당 go루틴 하나 매핑)
- ghost내에서 소비된 이벤트는 ghost를 벗어나지 않음.
- ghost는 Event→Event타입의 프로시저로, 부수효과로 init state를 받음.
- ghost는 자유변수를 지닐 수 없음.
  모든 내부 변수는 지역변수거나, 매개변수로부터 참조됨.
  이렇게 명시적으로 해야 그나마 디버깅 쉬워짐.
  - 자유변수 금지는 resolver로 검증함.
- ghost의 코드는 3부분으로 나뉘어짐
    1. 초기화: “←” 심볼 이전의 영역. Mount시 한 번 호출됨.
    2. 반복: “←”와 “→”사이 영역. 이벤트를 받을 때마다 이 영역이 핸들링됨.
    3. 마무리: “→” 심볼 이후의 영역. 반복이 종료된 후 실행됨.
- →는 “리턴”과 같음.
  Ghost내에서 → 는 여러번 호출될 수 없음. 이벤트 emit은 아토믹해야 함.
- ghost는 “Mount(timeSlice)”를 통해서 호출됨.
  - Mount는 해당 ghost를 go루틴으로 스케줄링함.
  - Mount(timeSlice)는 시작/종료 시간을 지정함.
    시작시간부터 종료시간까지 이벤트를 스트리밍 처리하고,
    종료 시 반복 루프를 종료한 뒤 “←” 아래의 마무리 구간을 수행함.
  - 기본 처리 단위는 이벤트 하나씩이며, emit도 동일하게 하나씩 처리함.
  - 구현은 내부적으로 go루틴 + 채널을 사용해도 됨.
  - 언어 수준에 "채널" 개념은 없고, 오직 이벤트만 존재함.

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
    3. cascade 순서는 Mount된 순서를 따름.
- Will의 타입
    1. event 선언. (리시버 함수도 선언 가능함)
    2. event 사용. (함수와 ghost의 사용)
    3. ghost 선언. (event이용. 선언 시 자유변수 불가)
    4. ghost의 호출. (init을 주는 호출 및, .Mount(schedule)을 이용한 호출)
    5. body의 이용. (main함수는 인자로 body Body를 받음. 이를 통해 기초적인 환경변수나 설정값을 받아옴)
    6. ghost의 `a->b` 타입은 함수 타입 체크와 동일하게 동작함.
       유니언 타입이 없으므로, 타입이 정확히 일치할 때만 허용함.

## 문법 (MVP)

- Go 문법의 서브셋을 기본으로 하되, 아래의 확장만 추가함.
- `event`, `ghost`, `Mount`, 이벤트 수신/emit, ghost 합성 파이프를 정의함.
- 표기는 EBNF이며, `[]`는 optional, `{}`는 repetition, `()`는 grouping, `|`는 alternation.

```ocaml
Program        = { Decl } ;
Decl           = EventDecl | GhostDecl | FuncDecl | VarDecl | TypeDecl ;

EventDecl      = "event" Ident "struct" "{" { FieldDecl } "}" ;
FieldDecl      = Ident TypeName ;

GhostDecl      = RawGhostDecl | CompGhostDecl ; 
RawGhostDecl   = "ghost" "[" EventType "->" EventType "]" Ident
                 "(" [ ParamList ] ")" Block ;
CompGhostDecl  = "ghost" Ident "(" [ ParamList ] ")" "="  CompGhostExpr ;
FuncDecl       = "func" [ Receiver ] Ident "(" [ ParamList ] ")" [ReturnTypes] Block ;
Receiver       = "(" Ident TypeName ")" ;

ReturnTypes    = TypeName | "(" TypeName {"," TypeName} ")" ;

VarDecl        = "var" VarSpec ;
VarSpec        = IdentList [ TypeName ] [ "=" ExprList ] ;
TypeDecl       = "type" TypeSpec 
TypeSpec       = Ident TypeName ;

ParamList      = Param { "," Param } ;
Param          = Ident TypeName ;
IdentList      = Ident { "," Ident } ;
ExprList       = Expr { "," Expr } ;

Block          = "{" { Stmt } "}" ;
Stmt           = SimpleStmt | Block | IfStmt | ForStmt ;
SimpleStmt     = RecvStmt | EmitStmt | AssignStmt | ExprStmt | ReturnStmt | BreakStmt | ContinueStmt ;

RecvStmt       = Ident "<-" EventType ;
EmitStmt       = Expr "->" EventType ;
AssignStmt     = IdentList ( ":=" | "=" ) ExprList ;
ExprStmt       = Expr ;
ReturnStmt     = "return" [ ExprList ] ;
BreakStmt      = "break"
ContinueStmt   = "continue"

(*MountCall은 사실상 메서드콜임.*)
MountCall      = GhostCall "." "Mount" "(" [ TimeSlice ] ")" ;
GhostCall      = Ident "(" [ ExprList ] ")" ;

IfStmt         = "if" Expr Block [ "else" ( IfStmt | Block ) ] ;
ForStmt        = "for" Expr Block

Expr           = BinaryExpr ;
RawGhostExpr   = "ghost" "[" EventType "->" EventType "]" "(" [ ParamList ] ")" Block ;
(*CompGhostExpr은 이중적인 구문임*)
(*CompGhostExpr이 GhostDecl에서 쓰이면 이는 Ghost내부의 구문 취급이라서, GhostCall의 인수는 좌변의 매개변수에서 상속되어야만 함*)
(*그러나 CompGhsotExpr이 그 자체의 표현식으로 쓰이면 이는 Ghost내부 취급이 "아니므로", GhostCall의 인수는 main함수 내에서의 아무 변수를 참조 가능*)
(*즉, ghost인 g1, g2에 대해*)
(*ghost g3(c) = g1(c.a)->g2(c.b); g3(c).Mount()이듯, (g1(c.a)->g2(c.b))(c)로 호출해야 하지만*)
(*표현식인 CompGhostExpr에 한해선 c=xxx; g1(c.a)->g2(c.b).Mount()와 같은 호출이 가능함.*)
CompGhostExpr = GhostCall { "->" GhostCall } 

FuncExpr       = "func" "(" [ ParamList ] ")" [ReturnTypes] Block ;

BinaryExpr     = UnaryExpr { BinOp UnaryExpr } ;
UnaryExpr      = [ UnOp ] PrimaryExpr ;
PrimaryExpr    = Operand { Selector | Index | Call } ;
Operand        = Literal | Ident | CompositeLit | RawGhostExpr | CompGhostExpr| FuncExpr | "(" Expr ")" ;
Selector       = "." Ident ;
Index          = "[" Expr "]" ;
Call           = "(" [ ExprList ] ")" ;

EventType      = Ident ;
TypeName       = Ident | "*" TypeName | "[]" TypeName | "map" "[" TypeName "]" TypeName ;

TimeSlice      = Ident | PrimaryExpr | CompositeLit ;
CompositeLit   = TypeName "{" [ ElementList ] "}" ;
ElementList    = Element { "," Element } ;
Element        = [ Expr ":" ] Expr ;

Literal        = IntLit | FloatLit | StringLit | BoolLit | "none" | "nil" ;
IntLit         = [ "-" ] Digit { Digit } ;
FloatLit       = [ "-" ] Digit { Digit } "." Digit { Digit } ;
StringLit      = "\"" { Char } "\"" ;
BoolLit        = "true" | "false" ;

Ident          = Letter { Letter | Digit | "_" } ;
Digit          = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
Letter         = "A" ... "Z" | "a" ... "z" | "_" ;

BinOp          = "||" | "&&" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "%";
UnOp           = "!" | "-" ;
```

- 다중 선언/다중 할당/다중 리턴을 지원함.
  - `a, b := f()` 또는 `a, b = x, y` 형태가 가능함.
  - `return a, b` 형태가 가능함.
- `RecvStmt`는 이벤트를 수신해서 지역 변수에 바인딩함.
- `EmitStmt`는 수신한 이벤트를 바탕으로 다른 이벤트를 emit함.
- `GhostCall`은 init 인자를 전달한 ghost 인스턴스 생성이며, 실행은 `Mount`로만 시작됨.
- `Literal`은 기본적인 Go 리터럴 + `none`만 허용함. (바이너리/과학표기/허수/구분자 미지원)
- 구조체/슬라이스/맵 접근은 `PrimaryExpr`의 `Selector`(`.`)와 `Index`(`[]`)로 표현함.
- `CompositeLit`은 구조체/슬라이스/맵 리터럴을 공통으로 표현함.
  - 구조체: `TypeName{ field: value }`
  - 슬라이스: `[]T{ v1, v2 }`
  - 맵: `map[K]V{ key: value }`

## 실행 규칙 (MVP)

- 실행 시작점은 `main(body Body)`이며, `Mount`는 `main` 내에서만 허용됨.
- 각 ghost는 `Mount` 시점에 고루틴으로 실행되며, 내부 이벤트 처리 단위는 1개씩 처리하는 것이 기본임.
- ghost 코드는 `초기화 -> 반복 -> 마무리` 순으로 실행됨.
  - 초기화: `←` 이전 영역, Mount 시 1회 실행.
  - 반복: `←`와 `→` 사이, 이벤트를 수신할 때마다 실행.
  - 마무리: `→` 이후 영역, 반복 종료 후 1회 실행.
- `RecvStmt`는 해당 타입 이벤트가 도착할 때까지 대기하며, 수신된 이벤트는 지역 변수로 바인딩됨.
- `EmitStmt`로 발생한 이벤트는 먼저 ghost 합성 파이프라인 내부로 전달됨.
  - 파이프라인 내부에서 소비되면 외부로 전파되지 않음.
  - 파이프라인에서 소비되지 못하면 main 루프에서 cascade 처리됨.
- cascade 순서는 Mount된 순서를 따르며, 타입이 일치하는 ghost에 차례대로 이벤트를 전달함.
- `Mount(timeSlice)`는 시작/종료 시간을 가지는 스케줄 정보를 사용함.
  - 시작시간부터 종료시간까지 ghost가 살아있고 이벤트를 스트리밍 처리함.
  - 종료 시 반복 루프를 종료하고 마무리 영역을 실행함.

## 타입 규칙 (MVP)

- 이벤트 타입은 `event` 선언으로 정의되는 명목 타입임.
- `ghost[In->Out]`는 `func(In) Out`과 동일한 타입 규칙으로 검사함.
  - 유니언 타입이 없으므로 `In`, `Out`은 정확히 일치해야 함.
- `RecvStmt`의 좌변 변수 타입은 ghost의 `In`과 정확히 일치해야 함.
- `EmitStmt`의 우변 타입은 ghost의 `Out`과 정확히 일치해야 함.
- `EmitStmt`의 좌변 표현식은 이벤트 타입이어야 하며, 그 타입은 `Out`과 정확히 일치해야 함.
- 이벤트는 불변 객체이며, 할당/대입 시에도 값 복사로 취급됨.
- `None`은 값 타입이며, `None` 타입의 값의 집합은 `{none}`뿐임.
  - `None`도 이벤트 타입으로 취급되며, `RecvStmt`/`EmitStmt`에서 사용 가능함.

## 에러 모델 (MVP)

- 컴파일 에러
  - `main` 밖에서 `Mount` 호출.
  - ghost 내부에서 자유변수 참조(리졸버가 검증).
  - `ghost[In->Out]`와 `RecvStmt`/`EmitStmt`의 이벤트 타입 불일치.
  - 하나의 ghost 실행 경로에서 `EmitStmt`가 여러 번 호출됨.
- 파이프라인 및 cascade에서 소비되지 않은 이벤트는 컴파일 경고를 냄.
- 런타임 동작
  - 파이프라인 및 cascade에서 소비되지 않은 이벤트는 무시됨.
  - 시간 조건(`Start > End` 등)이 성립하지 않으면 해당 ghost는 실행되지 않음.

## TimeSlice 스펙 (MVP)

- `Mount(timeSlice)`는 ghost 생명주기의 시작/종료 시점을 지정함.
- MVP에서는 `TimeSlice`를 다음과 같은 구조로 정의함.

```go
type TimeSlice struct {
 Start int64 // unix milli
 End   int64 // unix milli
}
```

- `Start`가 없으면 현재 시각을 사용함.
- `End`가 없거나 0이면 종료 없이 지속 실행됨.
- `Start > End`이면 실행하지 않고 종료됨.
- `Once`는 `TimeSlice{Start: now, End: now}`로 동작하는 빌트인 값임.
- Mount의 Start-End가 0이면 <-에서 ->부분은 실행되지 않음. 대신 <-이전의 init과 ->이후의 end가 한 번 실행됨.

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
- shell 마운트 시의 자원 상태 관리. (NodeBind, Rebindable, Pure).
