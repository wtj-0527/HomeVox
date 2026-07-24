package main

import (
	"encoding/json"
	"log"
	"net/http"
)

const (
	modelName      = "e2e-fake-vision"
	fixtureDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAF0lEQVR4nGL6////fwZkwARjAAIAAP//YgEEAT/f/TcAAAAASUVORK5CYII="
	visionSystem   = "You extract residential floor-plan structure. Return only one strict JSON object matching this schema: {rooms:[{name,type,approximate_bounds:{x1,y1,x2,y2},area_ratio}], walls:[{id,x1,y1,x2,y2}], doors:[{id,kind,wallId,position,width,source,confirmed}], windows:[{id,kind,wallId,position,width,source,confirmed}], scale:{unit,pixel_to_unit}, metadata:{source,confidence,image_width,image_height}}. Every listed field is required, no additional fields are accepted, and arrays may be empty. Use pixel coordinates when exact scale is unknown. Never infer or fabricate wall associations, opening widths, architectural dimensions, scale, orientation, height, thickness, or load-bearing status."
	visionUser     = "Parse this floor-plan image into the required JSON structure. Do not include markdown fences. Omit an opening if its wall-local position or width cannot be established."
	visionResponse = `{"choices":[{"message":{"content":"{\"rooms\":[],\"walls\":[{\"id\":\"wall-1\",\"x1\":80,\"y1\":80,\"x2\":520,\"y2\":80},{\"id\":\"wall-2\",\"x1\":520,\"y1\":80,\"x2\":520,\"y2\":360},{\"id\":\"wall-3\",\"x1\":520,\"y1\":360,\"x2\":80,\"y2\":360},{\"id\":\"wall-4\",\"x1\":80,\"y1\":360,\"x2\":80,\"y2\":80}],\"doors\":[{\"id\":\"door-1\",\"kind\":\"door\",\"wallId\":\"wall-1\",\"position\":0.5,\"width\":72,\"source\":\"controlled-e2e-fake\",\"confirmed\":true}],\"windows\":[{\"id\":\"window-1\",\"kind\":\"window\",\"wallId\":\"wall-2\",\"position\":0.5,\"width\":64,\"source\":\"controlled-e2e-fake\",\"confirmed\":true}],\"scale\":{\"unit\":\"px\",\"pixel_to_unit\":1},\"metadata\":{\"source\":\"controlled-e2e-fake\",\"confidence\":1,\"image_width\":600,\"image_height\":440}}"}}]}`
)

type chatRequest struct {
	Model    string `json:"model"`
	Messages []struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"messages"`
}

func validContract(request chatRequest) bool {
	if request.Model != modelName || len(request.Messages) != 2 || request.Messages[0].Role != "system" || request.Messages[1].Role != "user" {
		return false
	}
	var system string
	if json.Unmarshal(request.Messages[0].Content, &system) != nil || system != visionSystem {
		return false
	}
	var user []struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		ImageURL struct {
			URL string `json:"url"`
		} `json:"image_url"`
	}
	if json.Unmarshal(request.Messages[1].Content, &user) != nil || len(user) != 2 {
		return false
	}
	return user[0].Type == "text" && user[0].Text == visionUser && user[1].Type == "image_url" && user[1].ImageURL.URL == fixtureDataURL
}

func main() {
	http.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer e2e-fake-key" {
			http.Error(w, "invalid controlled vision request", http.StatusBadRequest)
			return
		}
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || !validContract(request) {
			http.Error(w, "invalid controlled vision contract", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(visionResponse))
	})
	log.Fatal(http.ListenAndServe("0.0.0.0:18089", nil))
}
