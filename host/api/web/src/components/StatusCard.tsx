import type { StatusResponse } from '../api/types'

interface StatusCardProps {
  status: StatusResponse
}

export function StatusCard({ status }: StatusCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Watcher Status</h2>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">State</span>
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              status.isRunning
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
            }`}
          >
            {status.state}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Running</span>
          <span className="text-sm font-medium">
            {status.isRunning ? 'Yes' : 'No'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Watcher ID</span>
          <span className="text-sm font-mono">{status.watcherID}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Uptime</span>
          <span className="text-sm font-medium">{status.uptime}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Last Update</span>
          <span className="text-sm">{new Date(status.lastUpdate).toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
