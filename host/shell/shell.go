package shell

import (
	"context"
	"host/ghost"
	"host/will"
	"sync"
)

// Shell은 Ghost들을 마운트해서 실행시키는 엔진임.
// Ghost가 프로그램의 "설계도"라면, Shell은 설계도를 바탕으로 실제 실행을 하는 엔진임
type Shell struct {
	shellInfo ShellInfo
	//shellState: killed, errorOccured, running, sleeping
	shellState ShellStateKind

	//ghostMonitor는 Shell이 마운트한 Ghost목록을 관리함
	ghostMonitor map[ghost.GhostId]GhostWithState
	monitorMu    sync.RWMutex //monitorMu는 ghostMonitor에 대한 접근 제어자

	//triggers는 자신이 마운트한 Ghost의 Watch필드를 기반으로
	//자원을 모니터링한 후 Ghost를 실행함
	//* 현재 단계에서 자원 모니터링의 효율성은 따지지 않음.
	//즉, 동일한 자원은 n개의 trigger가 watch하는 경우가 발생할 수 있음.
	//추후 성능 개선 시 가장 첫 번쨰로 고려할 것.
	//한다면 Watcher의 will을 Hash해서, Hash단위로 Set화 후 감시하면 될듯.
	triggers map[ghost.GhostId][]Trigger

	//ghost를 취소하고 싶을 때 호출할 함수 저장소
	cancleManager map[ghost.GhostId]CancleInfo

	// Shell내의 통신 채널
	triggeredChan chan TriggeredSignal
	errChan       chan error
	controlChan   chan ControlInfo
	//Shell의 동시성 제어
	shellMu sync.RWMutex
}

// GhostWithState는 Shell이 Ghost의 State를 관리하기 위해 쓰는 구조체임
type GhostWithState struct {
	Ghost ghost.Ghost
	State GhostState
}

type GhostState int

const (
	ReadyGhost GhostState = iota
	StoppedGhost
	RunningGhost
)

// CancleInfo내의 CancleXXX함수를 통해 Ghost의 동작을 제어할 수 있음
type CancleInfo struct {
	CancleWatch context.CancelFunc //Ghost의 Watch가 제대로 작동 x시 CancleWatch로 제어 가능
	CancleReact context.CancelFunc //Ghost의 React가 블로킹 되거나 하면 CancleReact로 제어가능
}

// ControlInfo는 Ghost에 대한 더 자세한 통제를 위한 정보들임
type ControlInfo struct {
	IsGlobal      bool //모든 Ghost에 대한 제어인지 flag
	GhostId       ghost.GhostId
	GhostCtrlKind GhostCtrlKind
}
type GhostCtrlKind int

const (
	UnMountGhost GhostCtrlKind = iota
	ReMountGhost
	PauseGhost
)

// Trigger는 정규화된 Ghost의 Watcher임
// Ghost는 여러 Watcher를 가지므로
// Ghost는 여러 Trigger를 지님.
type Trigger struct {
	//ghostId는 Trigger와 링크된 ghost의 id임
	ghostId ghost.GhostId
	//referedWatcher는 Trigger를 만들기 위해 참조한
	//Ghost의 Watcher정보임
	referedWatcher will.Watcher
}

// ShellInfo는 Shell의 주소 및 고유 Id를 표현함
type ShellInfo struct {
	Address string
	hostId  uint64
}
type ShellStateKind int
