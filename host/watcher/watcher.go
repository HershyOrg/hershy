package watcher

import (
	"host/script"
	"time"

	"github.com/traefik/yaegi/interp"
)

// Watcher는 한 전략을 실행하는 단위임
type Watcher struct {
	//WatcherId는 Watcher 식별자임
	WatcherId             WatcherId //WatcherID = UserID + ScriptHash
	hashedWatcherPassword HashedWatcherPassword
	watcherHashFunction          func(wp WatcherPassword) HashedWatcherPassword

	//hershScript관련 필드는 사용자에서 입력받은 문자열 정보임
	hershScript    script.HershScript // 사용자가 입력한 허쉬 스크립트
	HershScriptHash     HershScriptHash    // hershScript의 고유값 판별 위한 정보
	hershScriptHashFunc func(s script.HershScript) HershScriptHash

	// ScriptHash는 스크립트의 고유성 판별 위한 해시값임
	goScript script.GoScript
	//targetPackageName과 targetFuncName은 Script를 정적 분석한 결과임
	targetPackageName script.PackageName
	//funcName은 "S_XXX"형태여야 함.
	targetFuncName script.TargetFuncName

	//watchFunc는 최종 실행 가능한 함수임.
	watchFunc WatchFunction // Yaegi에서 interface로 추출해낸, 실행 가능한 함수
	// body는 유저와 관련한 환경 정보를 담음
	//병렬 안전 필요
	body Body
	//userMail은 채널이 아닌 "값"임
	//UserMail은 존재할 수도 아닐수도 있음
	//UserMail은 한 번 전달받고 나면 적용 후 "소멸"됨.
	//ex: "buy"커멘드 한 번 적용 후, nil로 다시 바뀜.
	//병렬 안전 필요
	UserMessage *UserMessage

	//runtime은 Watcher에 할당된 yaegi인터프리터임
	//runtime은 Watcher생성 시 한번 초기화됨
	//Watcher는 런타임에서 "S_xxx"형태의 watchFunc를 한 번 추출 후에
	//그 함수를 매 실행마다 평가하는 식임
	//이렇게 하면 유저도 이 특성을 이용해서 escaped된 변수를 함수 바깥에 지정할 수 있고,
	//성능적으로도 이득이면서, 어차피 함수 재실행 모델이라 계산적 안정성도 챙길 수 있음.
	runtime *interp.Interpreter

	//Watcher와 Host의 통신은 Erlang의 엑터 모델을 참고했음
	//스크립트 내부의 go루틴은 채널 기반 통신이지만,
	//Host와 Watcher는 액터 기반 통신을 함. 그게 각 환경에 적합하다 판단했음.
	controlMail chan WatcherControlMail

	// eventLog는 Watcher의 행동, 이벤트를 기록함
	// 모든 비동기 이벤트 로그는 여기에 저장됨
	//병렬 안전 필요
	eventLog []WatcherLog

	//resultLog는 watchFunc의 리턴 로그임
	//병렬 안전 필요
	resultLog []ResultLog

	//State는 Watcher의 상태를 관리함.
	State WatcherState
}

// WatchFunction은 "유저의 스크립트"를 대변한다.
// 유저는 "유저"와 관련한 body와 userMail를 본다.
type WatchFunction func(body Body, messageOrNil *UserMessage) error

type HershScriptHash int64

// WatcherState = Running/ Killed/ Stopped
type WatcherState int

const (
	Running WatcherState = iota
	Killed
	Stopped
)

type UserID int64

type WatcherPassword int64
type HashedWatcherPassword int64

type UserMessage string

// WatcherControlMail은 호스트가 Watcher에 보내는 메일임
type WatcherControlMail struct {
	CommandKind        CommandToWatcher
	RequestControlTime time.Time
	timeRegion         string
}

// CommandToWatcher는 호스트가 Watcher에 보내는 제어신호임
type CommandToWatcher int

const (
	KillSelf CommandToWatcher = iota
	StopSelf
	StartSelf
)

// WatcherLog는 Watcher가 남기는 값이다.
type WatcherLog struct {
	Time       time.Time
	timeRegion string
	//Head는 Log를 파싱하기 위한 메타적 지침이다.
	Head string
	//Body는 Log의 메시지 본문이다.
	Body string
}

// ResultLog는 WatchFunc의 리턴값을 남긴 로그다
type ResultLog struct {
	Time       time.Time
	timeRegion string
	//ResultKind = Ok, err, panic
	ResultKind ResultKind
	//Message는 에러나 패닉 메시지를 담는다
	Message string
}

// ResultKind는 WatchFunc의 실행결과다.
type ResultKind int

const (
	Ok ResultKind = iota
	ErrOccured
	PanicOccured
)

type WatcherId int64
type Body struct {
	//BodyId는 Body만의 고유한 ID임
	BodyId      BodyId
	UserId      UserID
	ValueConfig map[string]string
}

type BodyId int64
