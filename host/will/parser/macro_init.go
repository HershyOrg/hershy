package parser

// Init은 Compile시 InitList를 명시하기 위한 가이드임
// 현재 Init은 빌트인 함수가 아닌 파서 노드로써 작동 중임
// 이 역시 언어가 되면 쓸모없을 것
// 사실 Will전체가 두 달 뒤엔 갈아엎어질 것임.
type Init struct {
	wills []Stmt
}

var _ Stmt = (*Init)(nil)

func (it *Init) Node() string {
	return "Init"
}

func (it *Init) Stmt() string {
	return it.Node()
}
