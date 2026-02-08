import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { hostAPI } from '../api/host'
import { watcherAPI } from '../api/watcher'
import { SignalCard } from '../components/SignalCard'
import { LogViewer } from '../components/LogViewer'
import { CommandPanel } from '../components/CommandPanel'
import { ThemeToggle } from '../components/ThemeToggle'
import { DockerLogViewer } from '../components/DockerLogViewer'
import { ConfigCard } from '../components/ConfigCard'
import { MemoCacheCard } from '../components/MemoCacheCard'
import { IntegratedWatchingCard } from '../components/IntegratedWatchingCard'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

export function WatcherPage() {
  const { id } = useParams<{ id: string }>()

  const { data: program } = useQuery({
    queryKey: ['program', id],
    queryFn: () => hostAPI.getProgram(id!),
    enabled: !!id,
  })

  // Try to fetch Watcher data - enabled for Ready, Starting, Building states
  // Backend returns state as "Ready", "Starting", "Building" (capital first letter)
  const canAccessWatcher = !!id && program &&
    (program.state === 'Ready' || program.state === 'Starting' || program.state === 'Building')

  const { data: status, isLoading: statusLoading, error: statusError } = useQuery({
    queryKey: ['watcher-status', id],
    queryFn: () => watcherAPI.getStatus(id!),
    enabled: canAccessWatcher,
    refetchInterval: 2000,
    retry: 1,
  })

  const { data: signals, error: signalsError } = useQuery({
    queryKey: ['watcher-signals', id],
    queryFn: () => watcherAPI.getSignals(id!),
    enabled: canAccessWatcher,
    refetchInterval: 2000,
    retry: 1,
  })

  const { data: logs, error: logsError } = useQuery({
    queryKey: ['watcher-logs', id],
    queryFn: () => watcherAPI.getLogs(id!),
    enabled: canAccessWatcher,
    refetchInterval: 2000,
    retry: 1,
  })

  const { data: config } = useQuery({
    queryKey: ['watcher-config', id],
    queryFn: () => watcherAPI.getConfig(id!),
    enabled: canAccessWatcher,
    retry: 1,
  })

  const { data: watching } = useQuery({
    queryKey: ['watcher-watching', id],
    queryFn: () => watcherAPI.getWatching(id!),
    enabled: canAccessWatcher,
    refetchInterval: 5000,
    retry: 1,
  })

  const { data: memoCache } = useQuery({
    queryKey: ['watcher-memo-cache', id],
    queryFn: () => watcherAPI.getMemoCache(id!),
    enabled: canAccessWatcher,
    refetchInterval: 5000,
    retry: 1,
  })

  const { data: varState } = useQuery({
    queryKey: ['watcher-var-state', id],
    queryFn: () => watcherAPI.getVarState(id!),
    enabled: canAccessWatcher,
    refetchInterval: 5000,
    retry: 1,
  })

  return (
    <div className="min-h-screen bg-background">
      <ThemeToggle />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link
            to={`/${id}`}
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 text-sm font-medium hover:gap-3 transition-all cursor-pointer mb-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Program Detail
          </Link>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Watcher Interface
              </h1>
              <p className="text-sm text-muted-foreground mt-1 font-mono">{program?.program_id}</p>
            </div>
            {program?.proxy_url && (
              <a
                href={program.proxy_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-secondary/10 text-secondary-foreground border border-secondary/20 rounded-lg hover:bg-secondary/20 hover:border-secondary/30 text-sm font-mono transition-all cursor-pointer inline-flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                {program.proxy_url}
              </a>
            )}
          </div>
        </div>

        {/* State Warning */}
        {program && !canAccessWatcher && (
          <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border-2 border-yellow-200 dark:border-yellow-800 rounded-lg">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="font-semibold text-yellow-800 dark:text-yellow-200">Limited Functionality</h3>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  Program state is <strong>{program.state}</strong>. WatcherAPI is only available when program is Ready, Starting, or Building.
                  {program.state === 'Stopped' && ' Please start the program to access Watcher data.'}
                  {program.state === 'Created' && ' Please start the program first.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error Messages */}
        {(statusError || signalsError || logsError) && canAccessWatcher && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="font-semibold text-red-800 dark:text-red-200">WatcherAPI Connection Error</h3>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                  Unable to connect to WatcherAPI. The container may still be starting up. Retrying automatically...
                </p>
              </div>
            </div>
          </div>
        )}

        {statusLoading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="text-muted-foreground mt-4">Loading Watcher data...</p>
          </div>
        )}

        {status && (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="signals">Signals & Logs</TabsTrigger>
            </TabsList>

            {/* Tab 1: Overview */}
            <TabsContent value="overview" className="space-y-6">
              <div className="space-y-6">
                {config && <ConfigCard config={config} />}
                {watching && varState && (
                  <IntegratedWatchingCard watching={watching} varState={varState} />
                )}
                {memoCache && <MemoCacheCard memoCache={memoCache} />}
                <CommandPanel programId={id!} />
              </div>
            </TabsContent>

            {/* Tab 2: Signals & Logs */}
            <TabsContent value="signals" className="space-y-6">
              {signals && <SignalCard signals={signals} />}
              <DockerLogViewer programId={id!} autoScroll={false} />
              {logs && logs.effectLogs && logs.effectLogs.length > 0 && (
                <details className="bg-card border border-border rounded-lg p-6">
                  <summary className="text-lg font-semibold text-foreground cursor-pointer hover:text-primary">
                    Watcher Internal Logs ({logs.effectLogs.length} entries)
                  </summary>
                  <div className="mt-4">
                    <LogViewer logs={logs} />
                  </div>
                </details>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
