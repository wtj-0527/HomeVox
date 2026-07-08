package main

import (
	"log"

	"github.com/KingBoyAndGirl/HomeVox/backend/internal/api"
	"github.com/KingBoyAndGirl/HomeVox/backend/internal/config"
)

func main() {
	cfg := config.Load()
	router := api.NewRouter(cfg)

	log.Printf("HomeVox backend listening on %s", cfg.ListenAddr)
	if err := router.Run(cfg.ListenAddr); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
