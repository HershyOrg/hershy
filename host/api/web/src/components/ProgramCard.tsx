import { Link } from 'react-router-dom'
import type { GetProgramResponse } from '../api/types'
import { hostAPI } from '../api/host'
import { useMutation, useQueryClient } from '@tanstack/react-query'

interface ProgramCardProps {
  program: GetProgramResponse
}

const stateColors = {
  Created: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  Building: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  Built: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  Starting: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  Running: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  Stopped: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  Failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

export function ProgramCard({ program }: ProgramCardProps) {
  const queryClient = useQueryClient()

  const startMutation = useMutation({
    mutationFn: () => hostAPI.startProgram(program.program_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['programs'] }),
  })

  const stopMutation = useMutation({
    mutationFn: () => hostAPI.stopProgram(program.program_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['programs'] }),
  })

  const restartMutation = useMutation({
    mutationFn: () => hostAPI.restartProgram(program.program_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['programs'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => hostAPI.deleteProgram(program.program_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['programs'] }),
  })

  const stateColor = stateColors[program.state as keyof typeof stateColors] || stateColors.Created

  return (
    <div className="group rounded-lg border-2 border-border bg-card p-6 shadow-md hover:shadow-xl hover:border-primary/50 transition-all duration-200 cursor-default">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <Link
            to={`/${program.program_id}`}
            className="text-lg font-semibold text-foreground hover:text-primary transition-colors cursor-pointer underline decoration-transparent hover:decoration-primary decoration-2 underline-offset-4"
          >
            {program.program_id}
          </Link>
          <p className="text-sm text-muted-foreground mt-1">User: {program.user_id}</p>
        </div>
        <span className={`px-3 py-1.5 rounded-full text-xs font-semibold ${stateColor} shadow-sm`}>
          {program.state}
        </span>
      </div>

      <div className="space-y-2 mb-4">
        <div className="text-sm">
          <span className="text-muted-foreground">Build ID:</span>{' '}
          <span className="font-mono text-xs">{program.build_id}</span>
        </div>
        {program.container_id && (
          <div className="text-sm">
            <span className="text-muted-foreground">Container:</span>{' '}
            <span className="font-mono text-xs">{program.container_id.substring(0, 12)}</span>
          </div>
        )}
        {program.proxy_url && (
          <div className="text-sm">
            <span className="text-muted-foreground">Proxy:</span>{' '}
            <a
              href={program.proxy_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-mono text-xs cursor-pointer"
            >
              {program.proxy_url}
            </a>
          </div>
        )}
      </div>

      {program.error_msg && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
          {program.error_msg}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {program.state === 'Ready' && (
          <>
            <button
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              className="flex-1 min-w-[80px] px-3 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 active:bg-destructive/80 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-all shadow-sm hover:shadow-md cursor-pointer"
            >
              {stopMutation.isPending ? '⏳ Stopping...' : '⏹ Stop'}
            </button>
            <button
              onClick={() => restartMutation.mutate()}
              disabled={restartMutation.isPending}
              className="flex-1 min-w-[80px] px-3 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 active:bg-secondary/70 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-all shadow-sm hover:shadow-md cursor-pointer"
            >
              {restartMutation.isPending ? '⏳ Restarting...' : '🔄 Restart'}
            </button>
          </>
        )}
        {(program.state === 'Stopped' || program.state === 'Built' || program.state === 'Created') && (
          <button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="flex-1 min-w-[80px] px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-all shadow-sm hover:shadow-md cursor-pointer"
          >
            {startMutation.isPending ? '⏳ Starting...' : '▶️ Start'}
          </button>
        )}
        <Link
          to={`/${program.program_id}/watcher`}
          className="flex-1 min-w-[80px] px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:bg-primary/80 text-sm font-semibold transition-all shadow-sm hover:shadow-md cursor-pointer inline-block text-center"
        >
          📊 Watcher
        </Link>
        <button
          onClick={() => {
            if (confirm(`Delete program ${program.program_id}?`)) {
              deleteMutation.mutate()
            }
          }}
          disabled={deleteMutation.isPending}
          className="px-3 py-2 bg-destructive/10 text-destructive rounded-md hover:bg-destructive/20 active:bg-destructive/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-all cursor-pointer"
        >
          {deleteMutation.isPending ? '⏳' : '🗑️ Delete'}
        </button>
        <Link
          to={`/${program.program_id}`}
          className="px-3 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 active:bg-secondary/70 text-sm font-semibold transition-all shadow-sm hover:shadow-md cursor-pointer inline-block"
        >
          📄 Details
        </Link>
      </div>

      <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Created: {new Date(program.created_at).toLocaleString()}</span>
          <span>Updated: {new Date(program.updated_at).toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
