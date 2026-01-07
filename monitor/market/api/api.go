package api

import (
	"context"
	"log"
	"monitor/market/handler"
	"monitor/market/repository"
	"monitor/market/service"
	"net"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)
type Server struct {
    srv *http.Server
}
func (s *Server) Start(ctx context.Context) error {
    ln, err := net.Listen("tcp", s.srv.Addr)
    if err != nil {
        return err
    }

    go func() {
        if err := s.srv.Serve(ln); err != nil && err != http.ErrServerClosed {
            log.Printf("[cmd server] serve error: %v", err)
        }
    }()

    <-ctx.Done()
    // use background ctx for shutdown to allow cleanup
    return s.srv.Shutdown(context.Background())
}
func NewServer(db *pgxpool.Pool, addr string) *Server {
    repo := repository.NewPGRepository(db)
    svc := service.NewMarketService(repo)

    mux := http.NewServeMux()
    handlers := handler.NewMarketHandlers(svc)
    handlers.Register(mux)

    s := &Server{
        srv: &http.Server{
            Addr:    addr,
            Handler: mux,
        },
    }
    return s
}