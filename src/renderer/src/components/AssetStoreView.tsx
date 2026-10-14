import { useEffect, useRef, useState } from 'react'
import { RotateCw, ExternalLink, ArrowLeft, ArrowRight } from 'lucide-react'
import { ASSET_STORES } from '@shared/stores'
import { KIND_COLORS } from '@shared/engines'

/** Subset of Electron's <webview> element API that we use. */
interface WebviewEl extends HTMLElement {
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
}

/** Electron's <webview> is a custom element; render it untyped to avoid JSX attribute clashes. */
const Webview = 'webview' as unknown as (props: Record<string, unknown>) => JSX.Element

export function AssetStoreView(): JSX.Element {
  const [activeId, setActiveId] = useState(ASSET_STORES[0].id)
  const webviewRef = useRef<WebviewEl | null>(null)
  const active = ASSET_STORES.find((s) => s.id === activeId)!

  const reload = (): void => webviewRef.current?.reload()
  const back = (): void => {
    const w = webviewRef.current
    if (w?.canGoBack()) w.goBack()
  }
  const forward = (): void => {
    const w = webviewRef.current
    if (w?.canGoForward()) w.goForward()
  }
  const openExternal = (): void => {
    window.gamebridge.openExternal(webviewRef.current?.getURL() || active.url)
  }

  return (
    <div className="flex h-full">
      {/* Store list */}
      <div className="w-[232px] shrink-0 overflow-y-auto border-r border-line bg-bg-soft">
        <div className="space-y-px p-2">
          {ASSET_STORES.map((store) => (
            <button
              key={store.id}
              onClick={() => setActiveId(store.id)}
              className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                store.id === activeId ? 'bg-accent/15' : 'hover:bg-bg-hover'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-medium ${
                    store.id === activeId ? 'text-fg' : 'text-fg-muted'
                  }`}
                >
                  {store.name}
                </span>
                <div className="ml-auto flex gap-1">
                  {store.engines.map((e) => (
                    <span
                      key={e}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: KIND_COLORS[e] }}
                    />
                  ))}
                </div>
              </div>
              <p className="mt-0.5 text-2xs leading-snug text-fg-faint">{store.blurb}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Web panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-line px-2">
          <button onClick={back} className="nav-btn" title="Back">
            <ArrowLeft size={16} />
          </button>
          <button onClick={forward} className="nav-btn" title="Forward">
            <ArrowRight size={16} />
          </button>
          <button onClick={reload} className="nav-btn" title="Reload">
            <RotateCw size={15} />
          </button>
          <span className="ml-2 text-md font-medium tracking-tight text-fg">{active.name}</span>
          <button onClick={openExternal} className="nav-btn ml-auto" title="Open in browser">
            <ExternalLink size={15} />
          </button>
        </div>
        <StoreWebview key={active.id} url={active.url} webviewRef={webviewRef} />
      </div>
    </div>
  )
}

function StoreWebview({
  url,
  webviewRef
}: {
  url: string
  webviewRef: React.MutableRefObject<WebviewEl | null>
}): JSX.Element {
  const localRef = useRef<WebviewEl | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const el = localRef.current
    if (!el) return
    webviewRef.current = el
    const done = (): void => setLoading(false)
    const start = (): void => setLoading(true)
    el.addEventListener('did-stop-loading', done)
    el.addEventListener('did-start-loading', start)
    return () => {
      el.removeEventListener('did-stop-loading', done)
      el.removeEventListener('did-start-loading', start)
    }
  }, [webviewRef])

  return (
    <div className="relative flex-1 bg-white">
      {loading && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-accent/30 overflow-hidden">
          <div className="h-full w-1/3 bg-accent animate-[loading_1s_ease-in-out_infinite]" />
        </div>
      )}
      <Webview
        ref={localRef}
        src={url}
        partition="persist:stores"
        allowpopups="true"
        style={{ width: '100%', height: '100%', display: 'flex' }}
      />
    </div>
  )
}
