package parser

// WillNode은 세미-언어임. 스크립트 언어와 유사함.
// 함수 정의같은 복잡한 부분은 없음
// 대신 For, If, Break, Continue, Panic등의 제어와
// 각종 거래를 위한 빌트인 함수를 제공할 예정임
type WillNode interface {
	Node() string
}
type Stmt interface {
	WillNode
	Stmt() string
}
