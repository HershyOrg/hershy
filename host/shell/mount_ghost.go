package shell

import (
	"context"
	"host/ghost"
	"host/will"
	"time"
)

// MountGhost는 Ghost를 받아서
// Ghost의 Watcher를 자신의 Trigger에 올려두고 모니터링한다.
// 이후 Trigger에서 신호 오면 Ghost를 실행한다.
func (s *Shell) MountGhost(ghost ghost.Ghost, rootCtx context.Context) error {
	//Ghost를 받으면 일단 초기화 작업을 함
	//초기화 작업은 30초 내로 끝나야 함
	initCtx, cancle := context.WithTimeout(rootCtx, 30*time.Second)
	defer cancle()
	err := ghost.DoInit(initCtx)
	if err != nil {
		return err
	}

	watchCtx, cancleWatch := context.WithCancel(rootCtx)
	reactCtx, cancleReact := context.WithCancel(rootCtx)
	triggers := []Trigger{}
	for _, w := range ghost.Watchers() {
		triggers = append(triggers, Trigger{
			ghostId:        ghost.GhostId(),
			referedWatcher: w,
		})
	}

	s.monitorMu.Lock()
	s.ghostMonitor[ghost.GhostId()] = GhostWithState{
		Ghost: ghost,
		State: ReadyGhost,
	}
	s.monitorMu.Unlock()
	s.shellMu.Lock()
	s.triggers[ghost.GhostId()] = triggers
	s.cancleManager[ghost.GhostId()] = CancleInfo{
		CancleWatch: cancleWatch,
		CancleReact: cancleReact,
	}
	s.shellMu.Unlock()
	go s.watchGhost(triggers, watchCtx)
	go s.reactGhost(ghost, reactCtx)
	return nil
}

// watchGhost는 ghost의 watch를 받아서 감시 후, TriggeredInfo를 발생시킴
func (s *Shell) watchGhost(triggers []Trigger, ctx context.Context) error {
	for _, trigger := range triggers {
		go func(ctx context.Context) {
			resourceInfo := <-trigger.referedWatcher.Watch(ctx)
			if resourceInfo.Error() != nil {
				s.errChan <- resourceInfo.Error()
				return
			}
			s.triggeredChan <- TriggeredSignal{ghostId: trigger.ghostId, resourceInfo: resourceInfo}
		}(ctx)
	}
	return nil
}

// reactGhost는 target인 Ghost가 triggerd된 경우, Ghost가 Ready상태 일 때까지 기다렸다가 실행함.
func (s *Shell) reactGhost(target ghost.Ghost, ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return nil
		case triggerdInfo := <-s.triggeredChan:
			if triggerdInfo.ghostId == target.GhostId() {
				go func(ctx context.Context) {
					defer func() {
						//Ghost를 실행이 끝나면 준비 상태로 바꿈
						s.monitorMu.Lock()
						s.ghostMonitor[triggerdInfo.ghostId] = GhostWithState{
							Ghost: target,
							State: ReadyGhost,
						}
						s.monitorMu.Unlock()
					}()

					for {
						s.monitorMu.RLock()
						state := s.ghostMonitor[target.GhostId()].State
						s.monitorMu.RUnlock()
						if state != ReadyGhost {
							//*임시 로직: Ghost가 준비되지 않았다면 5초 대기
							time.Sleep(5 * time.Second)
							continue
						}
						s.monitorMu.Lock()
						s.ghostMonitor[target.GhostId()] = GhostWithState{
							Ghost: target,
							State: RunningGhost,
						}
						s.monitorMu.Unlock()
						break
					}
					resourceInfo := triggerdInfo.resourceInfo
					if resourceInfo.Error() != nil {
						s.errChan <- resourceInfo.Error()
						return
					}
					varId := resourceInfo.VarId()
					value := resourceInfo.Value()
					//받은 triggeredSignal을 기반으로 target의 환경을 업데이트
					err := target.UpdateMemory(varId, value)
					if err != nil {
						s.errChan <- err
						return
					}
					err = target.DoWills(ctx)
					if err != nil {
						s.errChan <- err
					}
				}(ctx)
				return nil
			}
		}
	}
}

// TriggeredSignal은 ghost를 실행하는 시그널임
type TriggeredSignal struct {
	ghostId      ghost.GhostId
	resourceInfo will.ResourceInfo
}
