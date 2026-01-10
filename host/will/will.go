package will

import (
	"context"
)

// Will은 세미-언어임. 스크립트 언어와 유사함.
// 함수 정의같은 복잡한 부분은 없음
// 대신 For, If, Break, Continue, Panic등의 제어와
// 각종 거래를 위한 빌트인 함수를 제공할 예정임
type Will interface {
	// Do는 body의 Memory, log를 바꾼 후 CtrlInfo, err를 리턴함
	Do(b Body, sandbox Env, ctx context.Context) (*CtrlInfo, error)
}

// Body는 Ghost가 자신의 Will을 실행하는데 관련된 정보 저장소임
type Body struct {
	//Config는 will을 위한 .env임
	//ex: apiKey
	//Config는 불변함
	Config map[string]string
	//Log는 Ghost가 배출한 기록을 최대 n개로 커트하며 유지-보관함.
	Log []string
	//Memory는 Will이 지속적으로 기억해야 할 변수값을 위한 환경임
	//ex: bitPrice
	//스코핑이나 리졸빙은 신경쓰지 않음
	Memory Env
}

// Env는 VarName에 따른 값을 관리함
type Env map[VarName]Value
