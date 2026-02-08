import type { ConfigResponse } from '../api/types'

interface ConfigCardProps {
  config: ConfigResponse
}

export function ConfigCard({ config }: ConfigCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Watcher Configuration</h2>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 dark:bg-blue-950 rounded p-3">
            <div className="text-xs text-muted-foreground mb-1">Server Port</div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {config.config.serverPort}
            </div>
          </div>

          <div className="bg-green-50 dark:bg-green-950 rounded p-3">
            <div className="text-xs text-muted-foreground mb-1">Signal Chan Capacity</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {config.config.signalChanCapacity}
            </div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-950 rounded p-3">
            <div className="text-xs text-muted-foreground mb-1">Max Log Entries</div>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {config.config.maxLogEntries}
            </div>
          </div>

          <div className="bg-orange-50 dark:bg-orange-950 rounded p-3">
            <div className="text-xs text-muted-foreground mb-1">Max Memo Entries</div>
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {config.config.maxMemoEntries}
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-border">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Last Retrieved</span>
            <span className="text-xs">{new Date(config.timestamp).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
