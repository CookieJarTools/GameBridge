import {
  LayoutGrid,
  Store,
  Activity,
  FileJson,
  Settings as SettingsIcon,
  Gamepad2
} from 'lucide-react'
import { useStore, type View } from '../store'

const NAV: { id: View; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'library', label: 'Library', icon: LayoutGrid },
  { id: 'stores', label: 'Asset Stores', icon: Store },
  { id: 'instances', label: 'Instances', icon: Activity },
  { id: 'data', label: 'Data', icon: FileJson },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

export function Sidebar(): JSX.Element {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const count = useStore((s) => s.projects.length)
  const runningGames = useStore((s) => Object.values(s.runs).filter((r) => r.running).length)
  const runningBuilds = useStore((s) => Object.values(s.builds).filter((b) => b.running).length)
  const busy = runningGames + runningBuilds

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-bg-soft">
      <div className="flex h-11 items-center gap-2 px-3">
        <Gamepad2 className="text-accent" size={17} />
        <span className="text-md font-semibold tracking-tight text-fg">GameBridge</span>
      </div>

      <nav className="flex-1 px-2 py-1">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`row mb-0.5 ${view === id ? 'row-selected' : ''}`}
          >
            <Icon size={16} className={view === id ? 'text-fg' : 'text-fg-subtle'} />
            <span className="font-medium">{label}</span>
            {id === 'library' && (
              <span className="badge text-fg-faint">{count}</span>
            )}
            {id === 'instances' && busy > 0 && (
              <span className="badge bg-ok/15 text-ok">{busy}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="border-t border-line px-3 py-2.5 text-2xs leading-relaxed text-fg-faint">
        Unity · Unreal · Custom
        <br />
        launcher — v{__APP_VERSION__}
      </div>
    </aside>
  )
}
