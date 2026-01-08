package ghost

import "context"

func BuildGhost(willInfo WillInfo, bodyInfo string) (Ghost, error)

type WillInfo interface {
	String() string
	Compile() ([]Will, []Watcher)
}

type BodyInfo interface {
	String() string
	Compile() Body
}

type Ghost struct {
	//wills은 "Ghost가 할 행동"임
	//wills는 "선형적인" Will로 이루어짐.
	//언어 수준의 표현은 안되겠지만, 스크립트 수준의 자유도는 갖출 수 있음
	wills []Will
	//Watcher는 wills를 트리거 하기 위한 감시 목록+감시 함수에 대한 정보임
	watchers []Watcher
	//Body는 will,watcher가 참고하는 개인화된 정보나 기록임
	body Body

	//sandbox은 Will동안 파생되어 지속되어야 하는 값 다루는 공간임
	//스코핑, 리졸빙은 신경쓰지 않음.
	//sandbox은 한번의 wills사이클이 끝날 때마다 초기화됨.
	//장기 기억이 필요한 값은 body의 Memory에 저장됨
	sandbox Env

	//state: mounted, unmounted, running, sleeping, errorOccurend
	state StateKind
	//식별자 리스트
	willId  WillId
	bodyId  BodyId
	ghostId GhostId
}

func (g *Ghost) DoWills(ctx context.Context) (*CtrlInfo, error) {
	g.sandbox = make(Env) //실행전 샌드박스 초기화
	for _, w := range g.wills {
		ctrlInfoOrNil, err := w.Do(g.body, g.sandbox, ctx)
		if ctrlInfoOrNil != nil || err != nil {
			return ctrlInfoOrNil, err
		}
	}
	return nil, nil
}

type Will interface {
	// Do는 body의 Memory, log를 바꾼 후 CtrlInfo, err를 리턴함
	Do(b Body, sandbox Env, ctx context.Context) (*CtrlInfo, error)

	// valuate는 Do과정에서 일어난 연산을 표현
	valuate() ([]Value, *CtrlInfo, error)
}

type CtrlInfo struct {
	//Kind: Return, Continue, Break, Panic
	Kind CtrlKind
	// Return, Panic시의 리턴값 혹은 에러 메시지
	Values []Value
}

type CtrlKind int

type Watcher struct {
	//resourceName은 현실 세계에서의 식별자임.
	//ex: Bitcoin Price
	resourceName string
	//varId는 Ghost프로그램 내부에서의 식별자임
	//ex: varName:BitPrice, Value: int(100)
	varId VarId
	//watch는 해당 자원을 감시하는 함수임
	watch func(ctx context.Context) <-chan ResourceInfo

	//body, sandbox Watch가 참조할 환경임
	body    Body
	sandbox Env
}

type ResourceInfo interface {
	ResourceName() string
	VarId() VarId
	Value() Value
}

type Value interface {
	Inspect() string
	Type() ValueType
}
type ValueType int

type Body struct {
	//Config는 일종의 .env임
	Config map[string]string
	//Log는 Ghost가 배출한 기록을 최대 n개로 커트하며 유지-보관.
	Log []string
	//Memory는 임시 환경임
	//스코핑이나 리졸빙은 신경쓰지 않음
	Memory Env
}
type Env map[VarId]Value
type WillId int
type BodyId int
type GhostId int
type VarId struct {
	id   int
	name string
}
type StateKind int
