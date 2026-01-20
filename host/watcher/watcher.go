package watcher

import "host/script"

// Watcher는 한 전략을 실행하는 단위임
type Watcher struct {
	WatcherId  WatcherId
	ScriptHash ScriptHash

	body   Body
	script script.Script
	//Watcher와 Host의 통신은 Erlang의 엑터 모델을 참고했음
	//스크립트 내부의 go루틴은 채널 기반 통신이지만,
	//Host와 Watcher는 액터 기반 통신을 함. 그게 각 환경에 적합하다 판단했음.
	mailbox chan HostMail
	log     []string

	State WatcherState
}

type ScriptHash int64

// WatcherState = Running/ Killed/ Stopped
type WatcherState string

// HostMail은 호스트가 Watcher에게 보내는 메일임
type HostMail struct {
	isGet    bool
	sender   string //json파싱 후 얻어내기
	getOrNil *GetStmt
	setOrNil *SetStmt
}
type GetStmt any
type SetStmt any
type WatcherId int64
type Body struct {
	BodyId         BodyId
	hashFunction   func(id int64) int64
	hashedPassword HashedPassword
}

type BodyId int64
type HashedPassword int64
