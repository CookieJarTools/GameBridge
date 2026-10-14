import { Play, Code2 } from 'lucide-react'
import type { Project } from '@shared/types'
import { useStore } from '../store'

/**
 * Split launch control:
 *   left  -> open the project only
 *   right -> open the project + its assigned IDE
 */
export function SplitLaunchButton({ project }: { project: Project }): JSX.Element {
  const launch = useStore((s) => s.launch)

  return (
    <div className="flex h-7 items-stretch overflow-hidden rounded-md">
      <button
        onClick={(e) => {
          e.stopPropagation()
          launch(project, 'project')
        }}
        title="Open project"
        className="flex items-center gap-1.5 bg-bg-active px-2.5 text-base font-medium text-fg transition-colors group-hover:bg-accent group-hover:text-accent-fg hover:!bg-accent-hover"
      >
        <Play size={12} fill="currentColor" />
        Launch
      </button>
      <div className="w-px bg-black/30" />
      <button
        onClick={(e) => {
          e.stopPropagation()
          launch(project, 'project+ide')
        }}
        title="Open project + IDE"
        className="flex items-center bg-bg-active px-2 text-fg transition-colors group-hover:bg-accent group-hover:text-accent-fg hover:!bg-accent-hover"
      >
        <Code2 size={14} />
      </button>
    </div>
  )
}
