import type { SignalsResponse } from '../api/types'

interface SignalCardProps {
  signals: SignalsResponse
}

const signalTypeBadge = {
  var: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200',
  user: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
  watcher: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200',
}

export function SignalCard({ signals }: SignalCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Signal Metrics</h2>

      <div className="space-y-4">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 dark:bg-blue-950 rounded p-3">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {signals.varSigCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Variable Signals</div>
          </div>

          <div className="bg-green-50 dark:bg-green-950 rounded p-3">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {signals.userSigCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">User Signals</div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-950 rounded p-3">
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {signals.watcherSigCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Watcher Signals</div>
          </div>

          <div className="bg-orange-50 dark:bg-orange-950 rounded p-3">
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {signals.totalPending}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Total Pending</div>
          </div>
        </div>

        {/* Recent Signals */}
        {signals.recentSignals && signals.recentSignals.length > 0 && (
          <div className="pt-4 border-t border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              Recent Signals (Last {signals.recentSignals.length})
            </h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {signals.recentSignals.map((signal, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 p-2 bg-muted/50 rounded hover:bg-muted transition-colors text-xs"
                >
                  <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${signalTypeBadge[signal.type as keyof typeof signalTypeBadge] || 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'}`}>
                    {signal.type}
                  </span>
                  <span className="flex-1 font-mono text-foreground break-all">{signal.content}</span>
                  <span className="text-muted-foreground text-xs flex-shrink-0">
                    {new Date(signal.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-border">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Last Updated</span>
            <span className="text-xs">{new Date(signals.timestamp).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
