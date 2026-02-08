import { useTheme } from '../contexts/ThemeContext'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const cycleTheme = () => {
    const themes = ['light', 'dark', 'system'] as const
    const currentIndex = themes.indexOf(theme)
    const nextIndex = (currentIndex + 1) % themes.length
    setTheme(themes[nextIndex])
  }

  const getIcon = () => {
    switch (theme) {
      case 'light':
        return '☀️'
      case 'dark':
        return '🌙'
      case 'system':
        return '💻'
    }
  }

  const getLabel = () => {
    switch (theme) {
      case 'light':
        return 'Light'
      case 'dark':
        return 'Dark'
      case 'system':
        return 'System'
    }
  }

  return (
    <button
      onClick={cycleTheme}
      className="fixed top-4 right-4 z-50 px-4 py-2 bg-card border-2 border-border rounded-lg hover:bg-muted transition-all shadow-md hover:shadow-lg cursor-pointer flex items-center gap-2 group"
      title={`Theme: ${getLabel()} (click to cycle)`}
    >
      <span className="text-2xl transition-transform group-hover:scale-110">{getIcon()}</span>
      <span className="text-sm font-medium text-foreground hidden sm:inline">{getLabel()}</span>
    </button>
  )
}
