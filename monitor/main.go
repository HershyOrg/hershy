package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type Event struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Time    string `json:"time"`
}

func sendEvent() {
	event := Event{
		Type:    "TEST_EVENT",
		Message: "Hello from monitor",
		Time:    time.Now().Format(time.RFC3339),
	}

	body, _ := json.Marshal(event)

	resp, err := http.Post(
		"http://host:8090/event",
		"application/json",
		bytes.NewBuffer(body),
	)
	if err != nil {
		log.Println("❌ failed to send event:", err)
		return
	}
	defer resp.Body.Close()

	log.Println("✅ event sent to host, status:", resp.Status)
}

func main() {
	log.Println("🚀 monitor server started")

	// 5초마다 host로 이벤트 전송
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			sendEvent()
		}
	}
}
