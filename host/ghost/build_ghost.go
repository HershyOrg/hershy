package ghost

import (
	"host/will/eval"
	"host/will/parser"
)

// CompileWill는 설계도를 받아서 Ghost를 만듦
// body의 환경이 will, init에 맞춰 적절히 초기화되어 있어야 함.
// * 컴파일 시, 렉싱-파싱, 리졸빙, 타입 체크까지 끝내고, 동시에 Init, Tick, OnStop을 구조분해 해서 고스트 필드에 할당할 것
func CompileWill(wills []parser.WillNode, bodyInfo string) (Ghost, error) {
	panic("구현되지 않음")
}

// WillInfo는 []Will과 []Watcher를 만들기 위한 정보임
type WillInfo interface {
	String() string
	Compile() (init []parser.WillNode, wiils []parser.WillNode, watchers []eval.Watcher)
}

// BodyInfo는 Body를 만들기 위한 정보임
type BodyInfo interface {
	String() string
	Compile() eval.Body
}
