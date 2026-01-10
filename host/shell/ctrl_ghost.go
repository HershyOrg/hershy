package shell

import (
	"fmt"
	"host/ghost"
)

// ControlTx는 Ghost를 제어하기 위한 트랜잭션의 구조임
// *현재 시점에선 보안 등의 기능은 신경쓰지 않음.
// 지금은 Tx에 Sender정보를 기입하지 않음
type ControlTx struct {
	ghostId ghost.GhostId
}

// StopGhost는 tx를 받아 해당 Ghost를 종료함
func (s *Shell) StopGhost(tx ControlTx) error {
	s.shellMu.RLock()
	cancleFuncs, ok := s.cancleManager[tx.ghostId]
	s.shellMu.Unlock()
	if !ok {
		return fmt.Errorf("Shell의 CancleManager에 해당 Ghost의 종료 정보가 들어있지 않음")
	}
	cancleFuncs.CancleWatch()
	cancleFuncs.CancleReact()

	s.shellMu.Lock()
	//현재는 ghostMonitor구현이 개판이라 넘어감
	//10분 후에 ghostMonitor분리 후 고치기
	s.ghostMonitor[tx.ghostId] = GhostWithState{
		Ghost: ghost.Ghost{},
		State: StoppedGhost,
	}
	s.shellMu.Unlock()
	return nil
}
