package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
)

type ProbModel struct {
	W          []float64 `json:"w"`
	Mu         []float64 `json:"mu"`
	Sd         []float64 `json:"sd"`
	TauNormDiv float64   `json:"tau_norm_div"`
}

func LoadProbModel(path string) (*ProbModel, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("prob model not found: %w", err)
	}
	var model ProbModel
	if err := json.Unmarshal(data, &model); err != nil {
		return nil, fmt.Errorf("invalid prob model json: %w", err)
	}
	if model.TauNormDiv <= 0 {
		model.TauNormDiv = 240.0
	}
	if len(model.W) < 6 || len(model.Mu) < 5 || len(model.Sd) < 5 {
		return nil, fmt.Errorf("prob model missing coefficients")
	}
	return &model, nil
}

func (m *ProbModel) Predict(deltaPct, cumVol1h, mom float64, regime int, tauSec int) float64 {
	x0 := deltaPct
	x1 := math.Log1p(math.Max(cumVol1h, 0.0))
	x2 := mom
	x3 := float64(regime)
	x4 := float64(tauSec) / m.TauNormDiv

	xs := []float64{
		(x0 - m.Mu[0]) / safeDenom(m.Sd[0]),
		(x1 - m.Mu[1]) / safeDenom(m.Sd[1]),
		(x2 - m.Mu[2]) / safeDenom(m.Sd[2]),
		(x3 - m.Mu[3]) / safeDenom(m.Sd[3]),
		(x4 - m.Mu[4]) / safeDenom(m.Sd[4]),
	}

	z := m.W[0]
	for i := 0; i < 5; i++ {
		z += m.W[i+1] * xs[i]
	}
	p := sigmoid(z)
	if p < 0 {
		return 0
	}
	if p > 1 {
		return 1
	}
	return p
}

func ComputePbad(pUp, price, o1h float64) (float64, int) {
	sgn := 1
	if (price - o1h) < 0 {
		sgn = -1
	}
	if sgn == 1 {
		return 1.0 - pUp, sgn
	}
	return pUp, sgn
}

func sigmoid(x float64) float64 {
	return 1.0 / (1.0 + math.Exp(-x))
}

func safeDenom(v float64) float64 {
	if math.Abs(v) < 1e-12 {
		return 1.0
	}
	return v
}
