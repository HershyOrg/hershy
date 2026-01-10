package will

import "context"

// TODO 이 빌트인 부분은
// TODO https://github.com/guzus/dr-manhattan 참고하기

// BuildWatcer는 Watcher 생성을 도와줌
// 이 will은 컴파일 과정에서 Watcher로 번역됨
type BuildWatcer struct {
}

// *현재 BuildWatcher의 Do는 어떤 행위도 하지 않음
// 추후 언어로써 성숙한다면 BuildWatcher가 WatcherValue를 리턴하거나, Expr로써 쓰일 것임.
// 현재로써 BuilWatcher는 CopmpileWill시에 Watcher를 주입하기 위한 가이드 정보일 뿐임.
func (b *BuildWatcer) Do(body Body, sandbox Env, ctx context.Context) (*CtrlInfo, error) {
	return nil, nil
}

// Compile은 Will을 Compile시 BuildWatcher의 정보를 바탕으로 Watcher를 만들기 위한 메서드임
// 현재 Will이 반의 반쪽짜리 유사 언어라 발생하는 현상임
// Watcher를 Will의 Value_model에선 다루지 못함
func (b *BuildWatcer) Compile() Watcher {
	panic("미구현")
}

var _ Will = (*BuildWatcer)(nil)

// Init은 Compile시 InitList를 명시하기 위한 가이드임
// 현재 Init은 빌트인 함수가 아닌 파서 노드로써 작동 중임
// 이 역시 언어가 되면 쓸모없을 것
// 사실 Will전체가 두 달 뒤엔 갈아엎어질 것임.
type Init struct {
	wills []Will
}

// Will
type Buy struct {
}

var _ Will = (*Buy)(nil)

func (b *Buy) Do(body Body, sandbox Env, ctx context.Context) (*CtrlInfo, error) {
	panic("미구현")
}
