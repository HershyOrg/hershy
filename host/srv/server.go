package srv

import (
	"host/machine"
	"host/script"
	"host/watcher"
)

type Server struct{}
type ServerInfo struct {
	address string
}

type ServerModel interface {
	//Dispatch는 script, body를 기반으로 Watcher를 생성 후 그 id를 리턴받음
	Dispatch(script script.Script, b watcher.Body) (watcher.WatcherId, error)

	//dispatch는 내부적으로 적절한 host에다 script, body를 기반으로 디스패치함
	dispatch(script script.Script, b watcher.Body, hostId machine.HostId) (watcher.WatcherId, error)

	// SendMail은 Watcher의 Mailbox에 Mail을 보내고, 결과값을 받음
	SendMail(mail watcher.HostMail, watcherId watcher.WatcherId) (string, error)
	// sendMail은 hostId의 Watcher의 Mailbox에 Mail을 보내고, 결과값을 받음
	sendMail(mail watcher.HostMail, watcerId watcher.WatcherId, hostId machine.HostId) (string, error)

	//createHost는 적당한 호스트를 만든 후 내부 데이터에 해당 호스트 등록함
	createHost(hostId machine.HostId, hostInfo machine.HostInfo) error
	//registerHost는 내부에 호스트를 등록함
	registerHost(hostId machine.HostId, hostImage HostImage)
	//checkHost는 주기적으로 호스트의 상태를 체크하거나 로그를 수집해옴.
	checkHost(hostId machine.HostId)
}

// HostDesign은 서버가 관리하는 Host의 이미지임
type HostImage struct {
	hostId    machine.HostId
	hostInfo  machine.HostInfo
	hostState machine.HostState
}
