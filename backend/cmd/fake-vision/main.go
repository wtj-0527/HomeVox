package main

import (
	"encoding/json"
	"log"
	"net/http"
)

func main() {
	http.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer e2e-fake-key" {
			http.Error(w, "invalid controlled vision request", http.StatusBadRequest)
			return
		}
		var request struct {
			Model string `json:"model"`
			Messages []json.RawMessage `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Model != "e2e-fake-vision" || len(request.Messages) != 2 {
			http.Error(w, "invalid controlled vision contract", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"rooms\":[],\"walls\":[{\"id\":\"wall-1\",\"x1\":80,\"y1\":80,\"x2\":520,\"y2\":80},{\"id\":\"wall-2\",\"x1\":520,\"y1\":80,\"x2\":520,\"y2\":360},{\"id\":\"wall-3\",\"x1\":520,\"y1\":360,\"x2\":80,\"y2\":360},{\"id\":\"wall-4\",\"x1\":80,\"y1\":360,\"x2\":80,\"y2\":80}],\"doors\":[{\"id\":\"door-1\",\"kind\":\"door\",\"wallId\":\"wall-1\",\"position\":0.5,\"width\":72,\"confirmed\":false}],\"windows\":[{\"id\":\"window-1\",\"kind\":\"window\",\"wallId\":\"wall-2\",\"position\":0.5,\"width\":64,\"confirmed\":false}],\"scale\":{\"unit\":\"px\"},\"metadata\":{\"source\":\"controlled-e2e-fake\",\"image_width\":600,\"image_height\":440}}"}}]}`))
	})
	log.Fatal(http.ListenAndServe("0.0.0.0:18089", nil))
}
