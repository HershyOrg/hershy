package main

import (
	"context"
	"log"
	"os"

	"monitor/market/cmd"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx := context.Background()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	log.Println("[main] start market sync")
	if err := cmd.RunBothConcurrent(ctx, db); err != nil {
		log.Fatal(err)
	}
	log.Println("[main] done")
}
