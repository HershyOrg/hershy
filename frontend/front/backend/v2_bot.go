package main

import (
	"context"
	"fmt"
	"time"

	"github.com/HershyOrg/hersh"
	"github.com/HershyOrg/hersh/hutil"
)

type FSMState string

const (
	IDLE        FSMState = "IDLE"
	ACTIVE      FSMState = "ACTIVE"
	REBALANCING FSMState = "REBALANCING"
	CLOSED      FSMState = "CLOSED"
)

// --- Helper: FSM 상태 로드 및 저장 ---
func getState(hCtx hersh.HershContext) FSMState {
	if val := hCtx.GetValue("state"); val != nil {
		return val.(FSMState)
	}
	hCtx.SetValue("state", IDLE)
	return IDLE
}

func setState(hCtx hersh.HershContext, state FSMState) {
	hCtx.SetValue("state", state)
}

// --- Handler 1: 사용자 개입 및 이벤트 메시지 (Init, Emergency, Rebalance Done) ---
func handleMessages(msg *hersh.Message, hCtx hersh.HershContext, state *FSMState) {
	if msg == nil {
		return
	}
	switch msg.Content {
	case "START_INIT":
		if *state == IDLE {
			fmt.Println("\n▶ [Init Sequence] 기초자산 비율 재조정 및 유동성 공급 완료")
			*state = ACTIVE
			setState(hCtx, *state)
		}
	case "FINISH_REBALANCE":
		if *state == REBALANCING {
			fmt.Println("\n▶ [Trigger 2 완료] 델타 뉴트럴 재정렬 완료 -> ACTIVE 복귀")
			*state = ACTIVE
			setState(hCtx, *state)
		}
	case "EMERGENCY_STOP":
		fmt.Println("\n▶ [Emergency Sequence] 긴급 청산: 자산 회수 및 모든 포지션 종료")
		*state = CLOSED
		setState(hCtx, *state)
	}
}

// --- Handler 2: 상시 모니터링 워처 (Tick) ---
func handleMonitoring(hCtx hersh.HershContext, watcher *hersh.Watcher, state *FSMState) {
	tick := hutil.WatchTick("monitor_tick", 1*time.Second, hCtx)

	// 운영 중(ACTIVE)일 때만 시장 데이터 검사
	if tick.IsTriggered(hCtx) && !tick.IsZero() && *state == ACTIVE {
		var tc int
		if countVal := hCtx.GetValue("tickCount"); countVal != nil {
			tc = countVal.(int)
		}
		tc++
		hCtx.SetValue("tickCount", tc)

		// 5초(틱) 마다 위기 감지 발동 트리거 설정
		if tc%5 == 0 {
			fmt.Println("\n⚠ [Trigger 2] 위기 감지: ETH 가격 변동! 델타 뉴트럴 재정렬 시작 (REBALANCING)")
			*state = REBALANCING
			setState(hCtx, *state)

			// 비동기 지연 해결 시뮬레이션
			go func() {
				time.Sleep(2500 * time.Millisecond)
				watcher.SendMessage("FINISH_REBALANCE")
			}()
		} else {
			fmt.Printf("\n✓ [Trigger 1] 상시 모니터링: 양측 자금 비율 정상 (Tick %d)\n", tc)
		}
	}
}

// --- Main Reducer: 모든 핸들러를 통합 관리하는 메인 매니저 함수 ---
func v2StrategyManager(watcher *hersh.Watcher, cancel context.CancelFunc) func(*hersh.Message, hersh.HershContext) error {
	return func(msg *hersh.Message, hCtx hersh.HershContext) error {
		state := getState(hCtx)

		// 1. 메시지 트리거 처리
		handleMessages(msg, hCtx, &state)

		// 2. 모니터링 트리거 처리
		handleMonitoring(hCtx, watcher, &state)

		fmt.Printf(">> 현재 V2 FSM 상태: %s\n", state)

		if state == CLOSED {
			cancel() // 시스템 긴급 종료
		}

		return nil
	}
}

func main() {
	config := hersh.DefaultWatcherConfig()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	watcher := hersh.NewWatcher(config, map[string]string{}, ctx)

	// 매니저 등록: 내부 함수로 깔끔하게 래핑한 리듀서를 반영
	watcher.Manage(
		v2StrategyManager(watcher, cancel),
		"V2LiquidityBot",
	).Cleanup(func(hCtx hersh.HershContext) {
		fmt.Println("\n🔒 V2 유동성 봇 매니저가 완전히 정지되었습니다.")
	})

	fmt.Println("🚀 V2 봇 시뮬레이터를 시작합니다...")
	go func() {
		time.Sleep(1 * time.Second)
		watcher.SendMessage("START_INIT")

		time.Sleep(10 * time.Second)
		watcher.SendMessage("EMERGENCY_STOP") // 10초 후 긴급 종료
	}()

	_ = watcher.Start()
	<-ctx.Done()
	time.Sleep(100 * time.Millisecond)
}
