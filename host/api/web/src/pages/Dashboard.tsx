import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hostAPI } from '../api/host'
import { ProgramCard } from '../components/ProgramCard'
import { FilterBar } from '../components/FilterBar'
import { CreateProgramModal } from '../components/CreateProgramModal'
import { ThemeToggle } from '../components/ThemeToggle'

export function Dashboard() {
  const [searchTerm, setSearchTerm] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['programs'],
    queryFn: hostAPI.listPrograms,
    refetchInterval: 5000, // Poll every 5 seconds
  })

  const filteredPrograms = data?.programs.filter((program) => {
    const matchesSearch =
      program.program_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      program.user_id.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesState = !stateFilter || program.state === stateFilter
    return matchesSearch && matchesState
  })

  return (
    <div className="min-h-screen bg-background">
      <ThemeToggle />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Programs Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Manage and monitor your deployed programs
          </p>
        </div>

        <FilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          stateFilter={stateFilter}
          onStateFilterChange={setStateFilter}
          onCreateClick={() => setIsCreateModalOpen(true)}
        />

        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="text-muted-foreground mt-4">Loading programs...</p>
          </div>
        )}

        {error && (
          <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
            <h3 className="font-semibold mb-2">Error loading programs</h3>
            <p className="text-sm">{(error as Error).message}</p>
          </div>
        )}

        {data && (
          <div className="mb-4 text-sm text-muted-foreground">
            Showing {filteredPrograms?.length || 0} of {data.count} programs
          </div>
        )}

        {filteredPrograms && filteredPrograms.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPrograms.map((program) => (
              <ProgramCard key={program.program_id} program={program} />
            ))}
          </div>
        ) : (
          !isLoading && (
            <div className="text-center py-16 bg-card border-2 border-dashed border-border rounded-lg">
              <div className="mb-4">
                <svg className="mx-auto h-12 w-12 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              </div>
              <p className="text-lg font-medium text-foreground mb-2">No programs found</p>
              <p className="text-sm text-muted-foreground mb-6">
                {searchTerm || stateFilter ? 'Try adjusting your filters' : 'Get started by creating your first program'}
              </p>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 active:bg-primary/80 font-medium transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 cursor-pointer"
              >
                + Create Your First Program
              </button>
            </div>
          )
        )}

        <CreateProgramModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
        />
      </div>
    </div>
  )
}
