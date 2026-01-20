# Script명세

## Rule

- "S_xxx"로 시작하는 이름의 함수를 "main함수"로 취급함.
- 해당 함수의 타입은 func(b Body. mailBox hersh.MailBox) error여야 함
- 한 파일에 "S_xxx"가 두 개 이상 시 리졸버 에러를 냄

## script example

```go
import "hersh"

//"S_"로 시작하는 함수는 유일해야 하며, 이를 컴파일함
// body는 사용자의 개인정보가 들어감. 코드엔 넣어선 안되는 api key가 그 예시.
func S_myStrategy(body hersh.Body, mailBox hersh.MailBox)error {
    // 간단한 예시임. 이렇게 통신도 가능.
    hersh.ReactMailBox(mailBox,func(msg string){
        if msg == "kill" {hersh.Kill()}
        if msg == "liquidate" {hersh.Liquidate()}
    })
    //스크립트 내에선 되도록 라이브러리를 활용함
    //직접 io호출을 해도 되지만, 성능과 사용감 면에서 단점이 있음.
    fundManager := hersh.NewFundManager(body)
    trigger := func() string {
        if bit > eth {
            return "BuyBit"
        }
        return "BuyEth"
    }
    //1초마다 해당 조건 만족여부 확인 명령
    //혹은 cmd리턴 등의 고도화도 가능. 여기선 예시만 제공
    fundManager.RegisterWatch(trigger, time.Second)
    count := 1
    polycy := func(c string) error {
        // 상태를 바탕으로 더한 작업도 되겠지
        // BuyEth를 5번 이상 받으면 더 사기 등
        if c = "BuyEth" {
            fundManager.Buy("Eth",100,1)
            count++
        }
        // policy는 cmd보다 더 정교하게 작업 가능 by 상태
        if count > 5 {
            fundManger.Buy("Eth", 1000,1)
        }
    }

    fundManager.RegisterPolycy(policy)

    // Run에는 
    fundManager.Run("연속", []{"2026.01.01", "2026.02.02"})
}
```

