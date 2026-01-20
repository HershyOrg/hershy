package machine

import (
	"host/script"
	"host/watcher"
)

type Host struct{}

// HostInfo는 호스트의 정적인 정보를 나타냄
type HostInfo struct {
	address string
	port    string
	//서버-호스트 간의 통신도 액터 모델로 진행함
	mailBox chan ServerMail
}

// ServerMail은 서버가 호스트에 보내는 메일임.
type ServerMail struct {
	sender string //json형태로 받음. 서버의 ip등이 내장됨
	// *어떤 타입의 커멘드를 내릴 지 숙고하기
	cmd string
}

// HostState는 호스트의 동적인 상태를 나타냄.
type HostState struct {
	machineState string
	watchers     []watcher.Watcher
}
type HostId int64
type HostModel interface {
	//Dis
	Spawn(script script.Script, body watcher.Body) watcher.Watcher
}
