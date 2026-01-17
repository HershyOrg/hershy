package eval

import "host/will/parser"

// Body는 Ghost가 자신의 Will을 실행하는데 관련된 정보 저장소임
type Body struct {
	//Memory는 Will이 지속적으로 기억해야 할 변수값을 위한 환경임
	//ex: bitPrice
	//스코핑이나 리졸빙은 신경쓰지 않음
	Memory         Env
	BuiltInFuncEnv BuiltInFuncEnv
	//Log는 Ghost가 배출한 기록을 최대 n개로 커트하며 유지-보관함.
	Log []string
}

// Env는 VarName에 따른 값을 관리함
type Env map[parser.VarName]Value

// BuiltInFuncEnv는 VarName에 따른 BuiltInFunc값을 관리함
type BuiltInFuncEnv map[parser.VarName]BuilInFuncVal
