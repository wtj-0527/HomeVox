package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/draw"
	_ "image/png"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	modelName                  = "e2e-fake-vision"
	fixtureDataURL             = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAlgAAAG4CAIAAAAWqA6UAAAJQklEQVR4nO3VsY1kVRRF0cmCCMgBEQfhkBoh4Y8QBm4ZR8OMxOdWaS9pmW20Xv1z95evf/0NAFlfzv8DADgkhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkPRvCn37+jX91/hG8p/PfBXgrz10bIbx3npz3dP67AG/luWsjhPdeX+z3X/98dV6jQ+e/C/BWnrs2Qnjv9cWE0McDTM9dGyG89/piQujjAabnro0Q3nt9MSH08QDTc9dGCO+9vpgQ+niA6blrI4T3Xl9MCH08wPTctRHCe68vJoQ+HmB67tqchfD8zr4nIYwwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQIawwDZiEECGsMA2YhBAhrDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYQK04BJCKHCNGASQqgwDZiEECpMAyYhhArTgEkIocI0YBJCqDANmIQQKkwDJiGECtOASQihwjRgEkKoMA2YhBAqTAMmIYSKb0wDmJ7boxDCgfObAh/nuT0KIRw4vynwcZ7boxDCgfObAh/nuT0KIRw4vynwcZ7boxDCgfObAh/nuT0KIRw4vynwcZ7boxDCgfObAh/nuT0KIRw4vynwcZ7boxAC8C6EEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgB4P8mhACkCSEAaUIIQJoQAnDmlz++vvpP/vJHCSEAZ4QQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBCBNCAFIE0IA0oQQgDQhBIBjQghAmhACkCaEAKQJIQDv4qQaQgjAuxBCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANJaIQSA7yeEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkPapIQSANyeEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKT9A4N4s+U669UwAAAAAElFTkSuQmCC"
	visionSystem               = "You extract residential floor-plan structure. Return only one strict JSON object matching this schema: {rooms:[{name,type,approximate_bounds:{x1,y1,x2,y2},area_ratio}], walls:[{id,x1,y1,x2,y2}], doors:[{id,kind,wallId,position,width,source,confirmed}], windows:[{id,kind,wallId,position,width,source,confirmed}], scale:{unit,pixel_to_unit}, metadata:{source,confidence,image_width,image_height}}. Every listed field is required, no additional fields are accepted, and arrays may be empty. All coordinates and opening widths are image pixels. scale.pixel_to_unit must be either a finite number or null, never a string: when no physical scale is explicitly visible, return exactly scale:{unit:\"px\",pixel_to_unit:null}; do not infer a conversion, orientation, height, thickness, or load-bearing status. metadata.confidence must be a finite number and image_width/image_height must be integers."
	visionUser                 = "Parse this floor-plan image into the required JSON structure. Do not include markdown fences. Omit an opening if its wall-local position or width cannot be established."
	candidateSystem            = "Find reliable single-floor-plan crops in this source image. Return only one strict JSON object matching this schema: {mode:string,candidates:[{x:number,y:number,width:number,height:number}]}. mode must be exactly one of \"single\", \"composite\", or \"uncertain\". Candidates must be absolute integer-pixel rectangles on the source image. Return mode \"uncertain\" with candidates:[] when no reliable crop can be established. Return \"single\" with exactly one candidate; return \"composite\" with two or more non-overlapping candidates. Do not add fields or markdown."
	candidateUser              = "Detect reliable crop rectangles that each contain one standalone floor plan. Do not guess a crop when the image is ambiguous."
	singleCandidateResponse    = `{"choices":[{"message":{"content":"{\"mode\":\"single\",\"candidates\":[{\"x\":20,\"y\":20,\"width\":560,\"height\":400}]}"}}]}`
	compositeCandidateResponse = `{"choices":[{"message":{"content":"{\"mode\":\"composite\",\"candidates\":[{\"x\":20,\"y\":20,\"width\":260,\"height\":400},{\"x\":320,\"y\":20,\"width\":260,\"height\":400}]}"}}]}`
	visionResponse             = `{"choices":[{"message":{"content":"{\"rooms\":[],\"walls\":[{\"id\":\"wall-1\",\"x1\":60,\"y1\":60,\"x2\":500,\"y2\":60},{\"id\":\"wall-2\",\"x1\":500,\"y1\":60,\"x2\":500,\"y2\":340},{\"id\":\"wall-3\",\"x1\":500,\"y1\":340,\"x2\":60,\"y2\":340},{\"id\":\"wall-4\",\"x1\":60,\"y1\":340,\"x2\":60,\"y2\":60}],\"doors\":[{\"id\":\"door-1\",\"kind\":\"door\",\"wallId\":\"wall-1\",\"position\":0.5,\"width\":72,\"source\":\"controlled-e2e-fake\",\"confirmed\":true}],\"windows\":[{\"id\":\"window-1\",\"kind\":\"window\",\"wallId\":\"wall-2\",\"position\":0.5,\"width\":64,\"source\":\"controlled-e2e-fake\",\"confirmed\":true}],\"scale\":{\"unit\":\"px\",\"pixel_to_unit\":null},\"metadata\":{\"source\":\"controlled-e2e-fake\",\"confidence\":1,\"image_width\":560,\"image_height\":400}}"}}]}`
)

type chatRequest struct {
	Model    string `json:"model"`
	Messages []struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"messages"`
}

type requestFact struct {
	Prompt       string `json:"prompt"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	ImageDiffers bool   `json:"imageDiffers"`
	CropMatches  bool   `json:"cropMatches"`
}

var facts struct {
	sync.Mutex
	Requests      []requestFact
	CandidateMode string
}

func requestImage(content json.RawMessage) (string, bool) {
	var user []struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		ImageURL struct {
			URL string `json:"url"`
		} `json:"image_url"`
	}
	if json.Unmarshal(content, &user) != nil || len(user) != 2 || user[0].Type != "text" || user[1].Type != "image_url" {
		return "", false
	}
	return user[1].ImageURL.URL, true
}
func decodeImage(dataURL string) (image.Image, bool) {
	comma := strings.IndexByte(dataURL, ',')
	if comma < 0 {
		return nil, false
	}
	data, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
	if err != nil {
		return nil, false
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, false
	}
	return decoded, true
}
func imageSize(dataURL string) (int, int, bool) {
	decoded, ok := decodeImage(dataURL)
	if !ok {
		return 0, 0, false
	}
	return decoded.Bounds().Dx(), decoded.Bounds().Dy(), true
}
func cropImage(source image.Image, rect image.Rectangle) image.Image {
	target := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	draw.Draw(target, target.Bounds(), source, rect.Min, draw.Src)
	return target
}
func pixelDigest(source image.Image) string {
	bounds := source.Bounds()
	hash := sha256.New()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, a := source.At(x, y).RGBA()
			_, _ = hash.Write([]byte{byte(r >> 8), byte(g >> 8), byte(b >> 8), byte(a >> 8)})
		}
	}
	return hex.EncodeToString(hash.Sum(nil))
}
func matchesExpectedCrop(dataURL string) bool {
	actual, actualOK := decodeImage(dataURL)
	source, sourceOK := decodeImage(fixtureDataURL)
	if !actualOK || !sourceOK {
		return false
	}
	if actual.Bounds().Dx() != 560 || actual.Bounds().Dy() != 400 {
		return false
	}
	actualDigest := pixelDigest(actual)
	// The lifecycle parses the recommended crop, then deliberately nudges it one
	// source pixel before retrying. Both positions are explicit product actions;
	// any other same-size crop must fail the controlled pixel-content contract.
	for _, left := range []int{20, 21} {
		if actualDigest == pixelDigest(cropImage(source, image.Rect(left, 20, left+560, 420))) {
			return true
		}
	}
	return false
}
func validContract(request chatRequest) (string, bool) {
	if request.Model != modelName || len(request.Messages) != 2 || request.Messages[0].Role != "system" || request.Messages[1].Role != "user" {
		return "", false
	}
	var system string
	if json.Unmarshal(request.Messages[0].Content, &system) != nil {
		return "", false
	}
	imageURL, ok := requestImage(request.Messages[1].Content)
	if !ok {
		return "", false
	}
	if system == candidateSystem {
		var user []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(request.Messages[1].Content, &user) != nil || user[0].Text != candidateUser || imageURL != fixtureDataURL {
			return "", false
		}
		return "candidate", true
	}
	if system != visionSystem {
		return "", false
	}
	var user []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(request.Messages[1].Content, &user) != nil || user[0].Text != visionUser || !strings.HasPrefix(imageURL, "data:image/png;base64,") {
		return "", false
	}
	return "parse", true
}

func main() {
	http.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer e2e-fake-key" {
			http.Error(w, "invalid controlled vision request", http.StatusBadRequest)
			return
		}
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, "invalid controlled vision request", http.StatusBadRequest)
			return
		}
		kind, ok := validContract(request)
		if !ok {
			http.Error(w, "invalid controlled vision contract", http.StatusBadRequest)
			return
		}
		imageURL, _ := requestImage(request.Messages[1].Content)
		width, height, decoded := imageSize(imageURL)
		facts.Lock()
		cropMatches := kind == "parse" && matchesExpectedCrop(imageURL)
		facts.Requests = append(facts.Requests, requestFact{Prompt: kind, Width: width, Height: height, ImageDiffers: imageURL != fixtureDataURL, CropMatches: cropMatches})
		facts.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if kind == "candidate" {
			time.Sleep(400 * time.Millisecond)
			facts.Lock()
			mode := facts.CandidateMode
			facts.Unlock()
			if mode == "composite" {
				_, _ = w.Write([]byte(compositeCandidateResponse))
			} else {
				_, _ = w.Write([]byte(singleCandidateResponse))
			}
			return
		}
		if !decoded || width != 560 || height != 400 || imageURL == fixtureDataURL || !cropMatches {
			http.Error(w, fmt.Sprintf("expected cropped 560x400 parse image, got %dx%d", width, height), http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(visionResponse))
	})
	http.HandleFunc("/e2e/requests", func(w http.ResponseWriter, _ *http.Request) {
		facts.Lock()
		defer facts.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(facts.Requests)
	})
	http.HandleFunc("/e2e/candidate-mode", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Mode string `json:"mode"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || (body.Mode != "single" && body.Mode != "composite") {
			http.Error(w, "invalid candidate mode", http.StatusBadRequest)
			return
		}
		facts.Lock()
		facts.CandidateMode = body.Mode
		facts.Unlock()
		w.WriteHeader(http.StatusNoContent)
	})
	log.Fatal(http.ListenAndServe("0.0.0.0:18089", nil))
}
