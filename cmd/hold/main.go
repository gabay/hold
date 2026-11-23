package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gabay/hold/internal/auth"
	"github.com/gabay/hold/internal/config"
	"github.com/gabay/hold/internal/db"
	"github.com/gabay/hold/internal/finance"
	"github.com/gabay/hold/internal/portfolio"
	"github.com/gabay/hold/internal/server"
	"github.com/gabay/hold/web"
)

func main() {
	cfg := config.Load()

	store, err := db.Open(cfg.DatabaseURL)
	if err != nil {
		slog.Error("open database failed", "path", cfg.DatabaseURL, "error", err)
		os.Exit(1)
	}
	defer func() {
		if err := store.Close(); err != nil {
			slog.Error("close database failed", "error", err)
		}
	}()

	financeSvc := finance.NewService(store, nil, nil)
	portfolioSvc := portfolio.NewService(store, financeSvc)
	authSvc, err := auth.NewService(cfg, store)
	if err != nil {
		slog.Error("initialize auth failed", "error", err)
		os.Exit(1)
	}

	staticFS, err := web.DistFS()
	if err != nil {
		slog.Error("load embedded frontend failed", "error", err)
		os.Exit(1)
	}

	handler := server.New(cfg, store, authSvc, financeSvc, portfolioSvc, staticFS)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("hold server listening",
			"addr", srv.Addr,
			"db", cfg.DatabaseURL,
			"oidc", cfg.OIDCEnabled(),
			"demo_login", cfg.AllowDemoLogin,
		)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("http server error", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down hold server")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("http server shutdown error", "error", err)
	}
}

