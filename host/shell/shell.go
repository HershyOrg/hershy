package shell

import (
	"host/ghost"
)

// MountGhost는 Ghost를 받아서
// Ghost의 Watcher를 자신의 Trigger에 올려두고 모니터링한다.
// 이후 Trigger에서 신호 오면 Ghost를 실행한다.
func (s *Shell) MountGhost(g ghost.Ghost) error

type Shell struct {
	shellInfo ShellInfo
	//shellState: killed, errorOccured, running, sleeping
	shellState ShellStateKind

	//mountedGhost는 Shell이 마운트한 Ghost목록을 관리함
	mountedGhost map[ghost.GhostId]ghost.Ghost

	//일시적으로 unmount된 ghost관리
	unmountedGhost map[ghost.GhostId]ghost.Ghost
	//triggers는 자신이 마운트한 Ghost의 Watch필드를 기반으로
	//자원을 모니터링한 후 Ghost를 실행함
	triggers map[ghost.GhostId]Trigger
}
type Trigger struct {
	//ghostId는 Trigger와 링크된 ghost의 id임
	ghostId ghost.GhostId
	//referedWatcher는 Trigger를 만들기 위해 참조한
	//Ghost의 Watcher정보임
	referedWatcher ghost.Watcher
}

type ShellInfo struct {
}
type ShellStateKind int
