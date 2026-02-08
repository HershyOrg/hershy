import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hostAPI } from '../api/host'
import { ThemeToggle } from '../components/ThemeToggle'
import { SourceCodeViewer } from '../components/SourceCodeViewer'

const stateColors = {
  Created: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  Building: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  Built: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  Starting: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  Running: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  Stopped: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  Failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

export function ProgramDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: program, isLoading, error } = useQuery({
    queryKey: ['program', id],
    queryFn: () => hostAPI.getProgram(id!),
    enabled: !!id,
    refetchInterval: 5000,
  })

  const { data: sourceCode } = useQuery({
    queryKey: ['source-code', id],
    queryFn: () => hostAPI.getSourceCode(id!),
    enabled: !!id,
  })

  const startMutation = useMutation({
    mutationFn: () => hostAPI.startProgram(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program', id] })
      queryClient.invalidateQueries({ queryKey: ['programs'] })
    },
  })

  const stopMutation = useMutation({
    mutationFn: () => hostAPI.stopProgram(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program', id] })
      queryClient.invalidateQueries({ queryKey: ['programs'] })
    },
  })

  const restartMutation = useMutation({
    mutationFn: () => hostAPI.restartProgram(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program', id] })
      queryClient.invalidateQueries({ queryKey: ['programs'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => hostAPI.deleteProgram(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] })
      navigate('/')
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-muted-foreground mt-4">Loading program details...</p>
        </div>
      </div>
    )
  }

  if (error || !program) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
            <h3 className="font-semibold mb-2">Error loading program</h3>
            <p className="text-sm">{error ? (error as Error).message : 'Program not found'}</p>
            <Link
              to="/"
              className="inline-block mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const stateColor = stateColors[program.state as keyof typeof stateColors] || stateColors.Created

  return (
    <div className="min-h-screen bg-background">
      <ThemeToggle />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 text-sm font-medium hover:gap-3 transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-sm">
          {/* Header */}
          <div className="p-6 border-b border-border">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground mb-2">{program.program_id}</h1>
                <p className="text-muted-foreground">User: {program.user_id}</p>
              </div>
              <span className={`px-4 py-2 rounded-full text-sm font-medium ${stateColor}`}>
                {program.state}
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 flex-wrap">
              {/* Watcher Button - Always Visible */}
              <Link
                to={`/${id}/watcher`}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 font-semibold transition-all shadow-md hover:shadow-lg cursor-pointer inline-flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                📊 Open Watcher
              </Link>

              {/* State-specific buttons */}
              {program.state === 'Ready' && (
                <>
                  <button
                    onClick={() => stopMutation.mutate()}
                    disabled={stopMutation.isPending}
                    className="px-5 py-2.5 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 active:bg-destructive/80 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all shadow-md hover:shadow-lg cursor-pointer"
                  >
                    {stopMutation.isPending ? '⏳ Stopping...' : '⏹ Stop Program'}
                  </button>
                  <button
                    onClick={() => restartMutation.mutate()}
                    disabled={restartMutation.isPending}
                    className="px-5 py-2.5 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 active:bg-secondary/70 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all shadow-md hover:shadow-lg cursor-pointer"
                  >
                    {restartMutation.isPending ? '⏳ Restarting...' : '🔄 Restart Program'}
                  </button>
                </>
              )}
              {(program.state === 'Stopped' || program.state === 'Built' || program.state === 'Created') && (
                <button
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all shadow-md hover:shadow-lg cursor-pointer"
                >
                  {startMutation.isPending ? '⏳ Starting...' : '▶️ Start Program'}
                </button>
              )}

              {/* Delete Button */}
              <button
                onClick={() => {
                  if (confirm(`Are you sure you want to delete program ${program.program_id}?`)) {
                    deleteMutation.mutate()
                  }
                }}
                disabled={deleteMutation.isPending}
                className="px-5 py-2.5 bg-destructive/10 text-destructive border-2 border-destructive/20 rounded-lg hover:bg-destructive/20 hover:border-destructive/30 active:bg-destructive/30 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all cursor-pointer"
              >
                {deleteMutation.isPending ? '⏳ Deleting...' : '🗑️ Delete Program'}
              </button>
            </div>
          </div>

          {/* Details Grid */}
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Identifiers */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground mb-3">Identifiers</h2>

              <div>
                <label className="text-sm text-muted-foreground">Program ID</label>
                <p className="font-mono text-sm mt-1">{program.program_id}</p>
              </div>

              <div>
                <label className="text-sm text-muted-foreground">Build ID</label>
                <p className="font-mono text-sm mt-1">{program.build_id}</p>
              </div>

              <div>
                <label className="text-sm text-muted-foreground">User ID</label>
                <p className="font-mono text-sm mt-1">{program.user_id}</p>
              </div>

              {program.image_id && (
                <div>
                  <label className="text-sm text-muted-foreground">Image ID</label>
                  <p className="font-mono text-sm mt-1">{program.image_id}</p>
                </div>
              )}

              {program.container_id && (
                <div>
                  <label className="text-sm text-muted-foreground">Container ID</label>
                  <p className="font-mono text-sm mt-1">{program.container_id}</p>
                </div>
              )}
            </div>

            {/* Network & Timestamps */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground mb-3">Network & Timestamps</h2>

              {program.proxy_url && (
                <div>
                  <label className="text-sm text-muted-foreground">Proxy URL</label>
                  <a
                    href={program.proxy_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-primary hover:underline font-mono text-sm mt-1"
                  >
                    {program.proxy_url}
                  </a>
                </div>
              )}

              <div>
                <label className="text-sm text-muted-foreground">Created At</label>
                <p className="text-sm mt-1">{new Date(program.created_at).toLocaleString()}</p>
              </div>

              <div>
                <label className="text-sm text-muted-foreground">Updated At</label>
                <p className="text-sm mt-1">{new Date(program.updated_at).toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {program.error_msg && (
            <div className="p-6 border-t border-border">
              <h2 className="text-lg font-semibold text-destructive mb-3">Error Details</h2>
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded">
                <pre className="text-sm text-destructive whitespace-pre-wrap">{program.error_msg}</pre>
              </div>
            </div>
          )}

          {/* Source Code */}
          {sourceCode && (
            <div className="p-6 border-t border-border">
              <details>
                <summary className="text-lg font-semibold text-foreground cursor-pointer hover:text-primary mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                  Source Code ({Object.keys(sourceCode.files).length} files)
                </summary>
                <div className="mt-4">
                  <SourceCodeViewer sourceCode={sourceCode} />
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
