import type { MemoCacheResponse } from '../api/types'

interface MemoCacheCardProps {
  memoCache: MemoCacheResponse
}

export function MemoCacheCard({ memoCache }: MemoCacheCardProps) {
  const entries = Object.entries(memoCache.entries)

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Memo Cache</h2>
        <span className="px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded-full text-sm font-medium">
          {memoCache.count} entries
        </span>
      </div>

      {entries.length > 0 ? (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {entries.map(([key, value], index) => (
            <div
              key={index}
              className="p-3 bg-muted/50 rounded hover:bg-muted transition-colors border border-border/50"
            >
              <div className="flex items-start gap-2 mb-2">
                <svg className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground font-medium mb-1">Key</div>
                  <div className="font-mono text-sm text-foreground break-all">{key}</div>
                </div>
              </div>
              <div className="pl-6">
                <div className="text-xs text-muted-foreground font-medium mb-1">Value</div>
                <div className="font-mono text-xs bg-background p-2 rounded border border-border overflow-x-auto">
                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <svg className="mx-auto h-10 w-10 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-sm">Memo cache is empty</p>
        </div>
      )}

      <div className="pt-4 mt-4 border-t border-border">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Last Updated</span>
          <span className="text-xs">{new Date(memoCache.timestamp).toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
