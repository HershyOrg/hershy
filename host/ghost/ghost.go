package ghost

import (
	"context"
	"fmt"
	"host/will/eval"
	"host/will/parser"
)

// Ghost는 Shell위에서 돌아갈 반응형 프로그램의 설계도임.
// Ghost는 sandbox와 body를 제외하곤 불변함
type Ghost struct {
	//wills은 "Ghost가 할 행동"임
	//wills는 "선형적인" Will로 이루어짐.
	//언어 수준의 표현은 안되겠지만, 스크립트 수준의 자유도는 갖출 수 있음
	wills []parser.Stmt

	//whenInits은 Ghost가 Mount될 시 단 한 번 초기화되는 값임.
	//ex: 폴리마켓 프리패치해서 인증 획득
	//ex: 이 인증은 body의 memory에 저장됨.
	whenInits []parser.Stmt
	//whenKilled는 Ghost가 Stop되고나서 단 한 번 실행되는 값임
	// ex: Unmout시 모든 Open 포지션 청산
	whenKilled []parser.Stmt
	//Watcher는 wills를 트리거 하기 위한 감시 목록+감시 함수에 대한 정보임
	watchers []eval.Watcher
	//Body는 will,watcher가 참고하는 개인화된 정보나 기록임
	body eval.Body

	//sandbox은 Will동안 파생되어 지속되어야 하는 값 다루는 공간임
	//스코핑, 리졸빙은 신경쓰지 않음.
	//sandbox은 한번의 wills사이클이 끝날 때마다 초기화됨.
	//장기 기억이 필요한 값은 body의 Memory에 저장됨
	sandbox eval.Env

	//State: mounted, unmounted, running, sleeping, errorOccurend
	//식별자 리스트
	willId  WillId
	bodyId  BodyId
	ghostId GhostId
}

// DoInit은 Ghost가 Shell에 마운트 된 후 한 번 실행되는 값임
// ex: fetchMarket및 인증
func (g *Ghost) DoInit(ctx context.Context) (err error, needStop bool) {
	//실행 전 샌드박스 초기화
	g.sandbox = make(eval.Env)
	for _, w := range g.whenInits {
		ctrlInfoOrNil, err := eval.Do(w, g.body, g.sandbox, ctx)
		if ctrlInfoOrNil != nil {
			if ctrlInfoOrNil.Kind == eval.KillKind {
				fmt.Println("DoInit: Stop 제어신호 받음")
				return nil, true
			}
			if ctrlInfoOrNil.Kind == eval.ReturnKind {
				return nil, false
			}
			return fmt.Errorf("제어 신호가 루트까지 전파됨"), false
		}
		if err != nil {
			return err, false
		}
	}
	return nil, false
}

// DoWills은 Ghost가 Shell에서 시그널 받을 떄마다 실행되는 값임.
func (g *Ghost) DoWills(ctx context.Context) (err error, needStop bool) {
	defer func() {
		g.sandbox = make(eval.Env) //실행후 샌드박스 초기화
	}()
	for _, w := range g.wills {
		ctrlInfoOrNil, err := eval.Do(w, g.body, g.sandbox, ctx)

		if ctrlInfoOrNil != nil {
			if ctrlInfoOrNil.Kind == eval.KillKind {
				fmt.Println("DoWills: Stop 제어신호 받음")
				return nil, true
			}
			if ctrlInfoOrNil.Kind == eval.ReturnKind {
				return nil, false
			}
			return fmt.Errorf("제어 신호가 루트까지 전파됨"), false
		}
		if err != nil {
			return err, false
		}
	}
	return nil, false
}

// DoCleanUps는 Ghost가 Stop시 호출됨
func (g *Ghost) DoCleanUps(ctx context.Context) error {
	defer func() {
		g.sandbox = make(eval.Env) //실행후 샌드박스 초기화
	}()
	for _, w := range g.wills {
		ctrlInfoOrNil, err := eval.Do(w, g.body, g.sandbox, ctx)

		if ctrlInfoOrNil != nil {
			if ctrlInfoOrNil.Kind == eval.KillKind {
				fmt.Println("DoCleanUps: Stop 제어신호 받음")
				return nil
			}
			if ctrlInfoOrNil.Kind == eval.ReturnKind {
				return nil
			}
			return fmt.Errorf("제어 신호가 루트까지 전파됨")
		}
		if err != nil {
			return ctx.Err()
		}
	}
	return nil
}

// UpdateMemory는 Ghost의 Memory를 업데이트 함.
// Memory의 정보를 바탕으로 실행되는 Ghost의 Will이 영향을 받음.
func (g *Ghost) UpdateMemory(varId parser.VarName, value eval.Value) error {
	_, existInMemory := g.body.Memory[varId]
	if !existInMemory {
		return fmt.Errorf("업데이트 하려는 변수가 body의 Memory에 정의되어 있지 않음.")
	}
	g.body.Memory[varId] = value
	return nil
}

func (g *Ghost) GhostId() GhostId {
	return g.ghostId
}
func (g *Ghost) Watchers() []eval.Watcher {
	return g.watchers
}

type WillId int
type BodyId int
type GhostId int

type GhostState int
