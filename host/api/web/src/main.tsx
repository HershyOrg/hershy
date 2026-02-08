import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query'
import { ThemeProvider } from './contexts/ThemeContext'
import { Dashboard } from './pages/Dashboard'
import { ProgramDetail } from './pages/ProgramDetail'
import { WatcherPage } from './pages/WatcherPage'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/ui/programs">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/:id" element={<ProgramDetail />} />
            <Route path="/:id/watcher" element={<WatcherPage />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
