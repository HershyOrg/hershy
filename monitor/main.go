package main

import (
	"context"
	"log"
	"monitor/market/api"

	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// start API server
	srv := api.NewServer(db, ":8080")
	go func() {
		if err := srv.Start(ctx); err != nil {
			log.Printf("[main] api server error: %v", err)
		}
	}()

	// go func() {
	// 	if err := cmd.RunBothConcurrent(ctx, db); err != nil {
	// 		log.Printf("[main] sync error: %v", err)
	// 	}
	// }()

	// wait for signal
	<-ctx.Done()
	log.Println("[main] shutting down")
}
