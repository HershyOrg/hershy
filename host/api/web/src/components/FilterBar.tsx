interface FilterBarProps {
  searchTerm: string
  onSearchChange: (value: string) => void
  stateFilter: string
  onStateFilterChange: (value: string) => void
  onCreateClick: () => void
}

export function FilterBar({
  searchTerm,
  onSearchChange,
  stateFilter,
  onStateFilterChange,
  onCreateClick,
}: FilterBarProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 mb-6">
      <div className="flex-1 relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          type="text"
          placeholder="Search programs..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border-2 border-input bg-background rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all cursor-text"
        />
      </div>
      <select
        value={stateFilter}
        onChange={(e) => onStateFilterChange(e.target.value)}
        className="px-4 py-2.5 border-2 border-input bg-background rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary cursor-pointer font-medium transition-all"
      >
        <option value="">All States</option>
        <option value="Created">Created</option>
        <option value="Building">Building</option>
        <option value="Starting">Starting</option>
        <option value="Ready">Ready</option>
        <option value="Stopping">Stopping</option>
        <option value="Stopped">Stopped</option>
        <option value="Error">Error</option>
      </select>
      <button
        onClick={onCreateClick}
        className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 active:bg-primary/80 font-semibold transition-all shadow-md hover:shadow-lg whitespace-nowrap cursor-pointer inline-flex items-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Create Program
      </button>
    </div>
  )
}
