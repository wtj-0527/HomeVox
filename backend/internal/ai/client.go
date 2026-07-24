package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/config"
)

type Message struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type Client struct {
	BaseURL string
	APIKey  string
	Model   string
	HTTP    *http.Client
}

func NewClient(baseURL, apiKey, model string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		Model:   model,
		HTTP:    &http.Client{Timeout: 120 * time.Second},
	}
}

func NewClientFromConfig(cfg config.Config) *Client {
	return NewClient(cfg.AIBaseURL, cfg.AIAPIKey, cfg.AIModel)
}

func (c *Client) Chat(ctx context.Context, messages []Message) (map[string]any, error) {
	body, err := json.Marshal(map[string]any{
		"model":    c.Model,
		"messages": messages,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("ai api returned HTTP %d", resp.StatusCode)
	}

	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

func summarizeBody(body []byte) string {
	summary := strings.TrimSpace(string(body))
	if summary == "" {
		return "<empty body>"
	}
	return summary
}
