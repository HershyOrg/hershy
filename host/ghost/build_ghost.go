package ghost

import "host/will"

// CompileWill는 설계도를 받아서 Ghost를 만듦
// body의 환경이 will, init에 맞춰 적절히 초기화되어 있어야 함.
func CompileWill(wills []will.Will, bodyInfo string) (Ghost, error) {
	panic("구현되지 않음")
}

// WillInfo는 []Will과 []Watcher를 만들기 위한 정보임
type WillInfo interface {
	String() string
	Compile() (init []will.Will, wiils []will.Will, watchers []will.Watcher)
}

// BodyInfo는 Body를 만들기 위한 정보임
type BodyInfo interface {
	String() string
	Compile() will.Body
}
