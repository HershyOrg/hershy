package main

import "os"

var hersh = (hershLib)(nil)

func S_XXX_Example(userMessage string, ctx HershContext) error {
	bit := hersh.Watch()
	if bit != nil {
		print("거래!")
	}
	return nil
}

// 받은 소스코드에 대한 예시임
func ExampleCode() {
	watcher := hersh.NewWatcher()

	f, _ := os.Open("xxx.py")

	// watcher가 사이드 프로세스 감시 가능.
	watcher.RunSideProccess(f)

	//Manage함수 만큼은 확실하게 매니지.
	watcher.Manage(S_XXX_Example, "localhost:watchID_xxxx")

	return
}

type hershLib interface {
	Watch() any
	NewWatcher() Watcher
	Cleanup()
}

type HershContext interface{}

type Watcher interface {
	//Manage는 S_xxx함수를 받음
	Manage(func(userMessage string, ctx HershContext) error, string)

	RunSideProccess(any)

	talkWithHost() // 내부적으로 호스트와 통신.
}
