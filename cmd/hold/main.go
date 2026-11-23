package main

import (
	"log"

	"github.com/gabay/hold/internal/config"
	"github.com/gabay/hold/internal/db"
)

func main() {
	cfg := config.Load()

	store, err := db.Open(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open database %q: %v", cfg.DatabaseURL, err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			log.Printf("close database: %v", err)
		}
	}()

	log.Printf("hold initialized (port=%s db=%s oidc=%v)", cfg.Port, cfg.DatabaseURL, cfg.OIDCEnabled())
}
