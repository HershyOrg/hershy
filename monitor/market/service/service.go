package service

import (
	"context"
	"monitor/market/repository"
	"monitor/market/repository/model"
	"time"
)

type MarketService interface {
    ListPolymarkets(ctx context.Context, limit, offset int) ([]model.PolyMarket, error)
    ListKalshimarkets(ctx context.Context, limit, offset int) ([]model.KalshiMarket, error)

    GetLastUpdatedPolymarket(ctx context.Context) (time.Time, error)
    GetLastUpdatedKalshi(ctx context.Context) (time.Time, error)
}

type marketService struct {
    repo repository.Repository
}

func NewMarketService(repo repository.Repository) MarketService {
    return &marketService{repo: repo}
}

func (s *marketService) ListPolymarkets(ctx context.Context, limit, offset int) ([]model.PolyMarket, error) {
    return s.repo.ListPolymarkets(ctx, limit, offset)
}

func (s *marketService) ListKalshimarkets(ctx context.Context, limit, offset int ) ([]model.KalshiMarket, error) {
    return s.repo.ListKalshimarkets(ctx, limit, offset)
}

func (s *marketService) GetLastUpdatedPolymarket(ctx context.Context) (time.Time, error) {
    return s.repo.GetLastUpdatedPolymarket(ctx)
}
func (s *marketService) GetLastUpdatedKalshi(ctx context.Context) (time.Time, error) {
    return s.repo.GetLastUpdatedKalshi(ctx)
}