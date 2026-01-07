package main

import (
	"encoding/json"
	"log"
	"net/http"
)

type Event struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Time    string `json:"time"`
}

func eventHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var event Event
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		log.Println("❌ decode error:", err)
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	log.Printf("📥 event received: %+v\n", event)
	w.WriteHeader(http.StatusOK)
}

func main() {
	http.HandleFunc("/event", eventHandler)
	log.Println("🚀 host server started on :8090")
	if err := http.ListenAndServe(":8090", nil); err != nil {
		log.Fatal(err)
	}
}
