"use client"

import Link from "next/link"
import * as React from "react"
import {
  ArrowSquareOutIcon,
  BookmarkSimpleIcon,
  CheckCircleIcon,
  ClipboardIcon,
  CloudSlashIcon,
  DeviceMobileIcon,
  HeartIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShareNetworkIcon,
  SparkleIcon,
} from "@phosphor-icons/react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Source = "bookmark" | "heart" | "shared"
type SourceFilter = "all" | Source

type Memory = {
  id: string
  text: string
  url: string
  postedAt: string
  sources: Source[]
  author: {
    handle: string
    displayName: string
    avatarUrl?: string | null
  }
  media?: Array<{ kind: string; url: string; altText?: string | null }>
}

type Counts = Record<SourceFilter, number>

type ArchiveResponse = {
  results: Memory[]
  counts: Counts
}

type AnswerResponse = {
  answer?: string
  error?: string
  local?: boolean
  retrieval?: string
}

const sources: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "bookmark", label: "Bookmarks" },
  { value: "heart", label: "Hearts" },
  { value: "shared", label: "Shared" },
]

const sourceMeta: Record<Source, { label: string; icon: typeof HeartIcon }> = {
  bookmark: { label: "Bookmarked", icon: BookmarkSimpleIcon },
  heart: { label: "Hearted", icon: HeartIcon },
  shared: { label: "Shared", icon: ShareNetworkIcon },
}

export function MomentoApp() {
  const [query, setQuery] = React.useState("")
  const [debouncedQuery, setDebouncedQuery] = React.useState("")
  const [source, setSource] = React.useState<SourceFilter>("all")
  const [items, setItems] = React.useState<Memory[]>([])
  const [counts, setCounts] = React.useState<Counts>({
    all: 0,
    bookmark: 0,
    heart: 0,
    shared: 0,
  })
  const [online, setOnline] = React.useState<boolean | null>(null)
  const [captureOpen, setCaptureOpen] = React.useState(false)
  const [captureUrl, setCaptureUrl] = React.useState("")
  const [captureSource, setCaptureSource] = React.useState<"bookmark" | "heart">("bookmark")
  const [captureError, setCaptureError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [toast, setToast] = React.useState("")
  const [answer, setAnswer] = React.useState("")
  const [answerError, setAnswerError] = React.useState("")
  const [asking, setAsking] = React.useState(false)
  const [refreshKey, setRefreshKey] = React.useState(0)
  const searchRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [query])

  React.useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({
      q: debouncedQuery,
      source,
      limit: "200",
    })

    fetch(`/api/items?${params}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Archive offline")
        return (await response.json()) as ArchiveResponse
      })
      .then((data) => {
        if (cancelled) return
        setItems(data.results ?? [])
        setCounts(data.counts ?? { all: 0, bookmark: 0, heart: 0, shared: 0 })
        setOnline(true)
      })
      .catch(() => {
        if (!cancelled) setOnline(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery, source, refreshKey])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  React.useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(""), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined)
    }
  }, [])

  async function askArchive(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = query.trim()
    if (!question || asking) return
    setAsking(true)
    setAnswer("")
    setAnswerError("")

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, source, limit: 6 }),
      })
      const data = (await response.json()) as AnswerResponse
      if (!response.ok) throw new Error(data.error || "Momento could not answer that.")
      setAnswer(data.answer || "")
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : "Momento could not answer that.")
    } finally {
      setAsking(false)
    }
  }

  async function pasteFromClipboard() {
    try {
      setCaptureUrl(await navigator.clipboard.readText())
      setCaptureError("")
    } catch {
      setCaptureError("Clipboard access was blocked. Paste the link manually.")
    }
  }

  async function saveCapture(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setCaptureError("")

    try {
      const response = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: captureUrl, source: captureSource }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(data.error || "Could not save this link.")
      setCaptureOpen(false)
      setCaptureUrl("")
      setToast("Saved to Momento.")
      setRefreshKey((key) => key + 1)
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : "Could not save this link.")
    } finally {
      setSaving(false)
    }
  }

  const hasArchive = counts.all > 0
  const hasResults = items.length > 0

  return (
    <div className="isolate min-h-svh bg-background">
      <header className="border-b border-border/80">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="font-mono text-base font-semibold tracking-tight">
            momento<span className="text-primary">.</span>
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <p className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              {online === false ? (
                <CloudSlashIcon className="size-3.5 shrink-0" />
              ) : (
                <CheckCircleIcon className="size-3.5 shrink-0 text-primary" />
              )}
              {online === null ? "Connecting" : online ? "Archive ready" : "Archive offline"}
            </p>
            <Button size="sm" onClick={() => setCaptureOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Add a link
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <section className="max-w-3xl">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Your external memory for X
          </p>
          <h1 className="mt-4 max-w-[16ch] font-heading text-4xl font-medium tracking-tight text-balance sm:text-6xl">
            What do you remember?
          </h1>
          <p className="mt-5 max-w-[58ch] text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
            Search the things you hearted, bookmarked, or sent here before the timeline swallowed them.
          </p>

          <form onSubmit={askArchive} className="relative mt-8 max-w-3xl">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              name="q"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setAnswer("")
                setAnswerError("")
              }}
              aria-label="Search your archive"
              placeholder="A phrase, person, or half-remembered idea…"
              className="h-14 bg-card pr-24 pl-11 text-base shadow-sm sm:text-sm"
            />
            {query.trim() ? (
              <Button
                type="submit"
                size="sm"
                disabled={asking || online === false}
                className="absolute top-1/2 right-2 -translate-y-1/2"
              >
                <SparkleIcon data-icon="inline-start" weight="fill" />
                {asking ? "Thinking…" : "Ask"}
              </Button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground sm:block">
                ⌘ K
              </kbd>
            )}
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Search updates instantly. Press Ask to synthesize a cited answer with your local model.
          </p>
        </section>

        <nav className="mt-5 flex max-w-3xl gap-1 overflow-x-auto" aria-label="Filter archive">
          {sources.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={source === item.value}
              onClick={() => {
                setSource(item.value)
                setAnswer("")
                setAnswerError("")
              }}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 px-3 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:text-xs",
                source === item.value && "bg-muted text-foreground",
              )}
            >
              {item.label}
              <span className="tabular-nums opacity-60">{counts[item.value]}</span>
            </button>
          ))}
        </nav>

        {answer || answerError || asking ? (
          <section className="mt-8 max-w-3xl border border-border bg-card p-5 shadow-sm" aria-live="polite">
            <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
              <h2 className="flex items-center gap-2 font-heading text-sm font-semibold tracking-wider uppercase">
                <SparkleIcon className="size-4 text-primary" weight="fill" />
                Answer from your archive
              </h2>
              <span className="font-mono text-[0.6875rem] text-muted-foreground uppercase">
                Local · private
              </span>
            </div>
            {asking ? (
              <p className="py-6 text-sm text-muted-foreground">Reading the most relevant memories…</p>
            ) : answerError ? (
              <p className="py-6 text-sm text-destructive">{answerError}</p>
            ) : (
              <AnswerText answer={answer} />
            )}
          </section>
        ) : null}

        <div className="mt-12 grid gap-16 lg:grid-cols-[minmax(0,48rem)_13rem]">
          <section className="min-w-0" aria-labelledby="results-heading">
            <div className="flex min-h-8 items-baseline justify-between gap-4 border-b border-border pb-3">
              <h2 id="results-heading" className="font-heading text-sm font-semibold tracking-wider uppercase">
                {debouncedQuery ? "What surfaced" : "Recently remembered"}
              </h2>
              <p className="text-xs text-muted-foreground tabular-nums">
                {hasResults ? `${items.length} ${items.length === 1 ? "memory" : "memories"}` : ""}
              </p>
            </div>

            {hasResults ? (
              <div role="list">
                {items.map((item) => (
                  <MemoryItem key={item.id} item={item} />
                ))}
              </div>
            ) : hasArchive ? (
              <EmptyState
                eyebrow="Nothing surfaced"
                title="Try the part you actually remember."
                copy="Use a person, phrase, or rough idea. Momento ignores filler words like ‘that tweet about’."
                action="Show everything"
                onAction={() => setQuery("")}
              />
            ) : (
              <EmptyState
                eyebrow="Your wall is empty"
                title="Bring back what X forgot."
                copy="Sync Hearts and Bookmarks from the browser extension, or add a tweet from your phone now."
                action="Add your first link"
                onAction={() => setCaptureOpen(true)}
              />
            )}
          </section>

          <aside className="hidden lg:block" aria-label="Archive summary">
            <p className="text-xs font-semibold text-muted-foreground">Archive</p>
            <p className="mt-2 font-heading text-lg font-medium tracking-wide uppercase">
              <span className="tabular-nums">{counts.all}</span> memories
            </p>
            <dl className="mt-5 grid gap-3 border-b border-border pb-6">
              <Stat label="Bookmarks" value={counts.bookmark} icon={BookmarkSimpleIcon} />
              <Stat label="Hearts" value={counts.heart} icon={HeartIcon} />
              <Stat label="Shared" value={counts.shared} icon={ShareNetworkIcon} />
            </dl>
            <div className="border-b border-border py-6">
              <p className="text-xs font-semibold text-muted-foreground">On your phone</p>
              <p className="mt-2 text-sm/6 text-pretty text-muted-foreground">
                Install Momento, then share X links straight into your archive.
              </p>
              <p className="mt-3 flex items-start gap-2 text-xs text-foreground">
                <DeviceMobileIcon className="size-4 shrink-0" />
                Run <code className="font-mono">momento phone</code>
              </p>
            </div>
            <blockquote className="pt-6 font-mono text-xs/5 text-muted-foreground">
              <p>Memory can change the shape of a room.</p>
              <cite className="mt-2 block not-italic opacity-60">A small wink to Memento</cite>
            </blockquote>
          </aside>
        </div>
      </main>

      <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Write it down</DialogTitle>
            <DialogDescription>Paste an X link and choose why it belongs in your memory.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveCapture} className="grid gap-5">
            <div className="grid gap-2">
              <label htmlFor="capture-url" className="text-sm font-medium">
                Tweet URL
              </label>
              <div className="relative">
                <Input
                  id="capture-url"
                  name="url"
                  type="url"
                  inputMode="url"
                  value={captureUrl}
                  onChange={(event) => setCaptureUrl(event.target.value)}
                  placeholder="https://x.com/…/status/…"
                  className="pr-24 max-sm:text-base"
                  required
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={pasteFromClipboard}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2"
                >
                  <ClipboardIcon data-icon="inline-start" />
                  Paste
                </Button>
              </div>
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Remember it as</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <SourceOption
                  source="bookmark"
                  checked={captureSource === "bookmark"}
                  onChange={() => setCaptureSource("bookmark")}
                />
                <SourceOption
                  source="heart"
                  checked={captureSource === "heart"}
                  onChange={() => setCaptureSource("heart")}
                />
              </div>
            </fieldset>

            {captureError ? <p className="text-sm text-destructive">{captureError}</p> : null}
            <DialogFooter>
              <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                {saving ? "Writing it down…" : "Save to Momento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {toast ? (
        <div className="fixed right-4 bottom-4 left-4 z-50 mx-auto flex max-w-sm items-center justify-center gap-2 bg-foreground px-4 py-3 text-sm text-background shadow-lg">
          <CheckCircleIcon className="size-4 shrink-0" />
          {toast}
        </div>
      ) : null}
    </div>
  )
}

function AnswerText({ answer }: { answer: string }) {
  return (
    <div className="py-5 text-sm/7 text-foreground">
      {answer.split("\n").map((line, index) => {
        const source = line.match(/^(\[\d+\])\s+(https?:\/\/\S+)$/)
        if (source) {
          return (
            <p key={`${line}-${index}`} className="mt-1 flex min-w-0 gap-2 text-xs text-muted-foreground">
              <span className="shrink-0 font-mono">{source[1]}</span>
              <a
                href={source[2]}
                target="_blank"
                rel="noreferrer"
                className="truncate underline decoration-border underline-offset-4 hover:text-foreground"
              >
                {source[2]}
              </a>
            </p>
          )
        }
        if (line === "Sources:") {
          return <p key={`${line}-${index}`} className="mt-5 mb-2 text-xs font-semibold uppercase">Sources</p>
        }
        if (!line) return <div key={`space-${index}`} className="h-3" />
        return <p key={`${line}-${index}`}>{line}</p>
      })}
    </div>
  )
}

function MemoryItem({ item }: { item: Memory }) {
  const media = item.media?.find((entry) => entry.kind === "photo" && entry.url)

  return (
    <article role="listitem" className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 border-b border-border py-6 sm:grid-cols-[2.75rem_minmax(0,1fr)] sm:gap-4">
      <Avatar className="size-10 sm:size-11">
        {item.author.avatarUrl ? <AvatarImage src={item.author.avatarUrl} alt="" /> : null}
        <AvatarFallback>{initials(item.author.displayName || item.author.handle)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <p className="max-w-full truncate text-base font-semibold sm:text-sm">{item.author.displayName}</p>
          <p className="text-base text-muted-foreground sm:text-sm">@{item.author.handle}</p>
          <time className="text-sm text-muted-foreground sm:text-xs" dateTime={item.postedAt}>
            · {formatDate(item.postedAt)}
          </time>
        </div>
        <p className="mt-2 whitespace-pre-line text-base/7 text-pretty sm:text-sm/6">{item.text}</p>
        {media ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.url}
            alt={media.altText || "Tweet media"}
            loading="lazy"
            className="mt-4 max-h-96 w-auto max-w-full rounded-[min(1vw,0.625rem)] object-cover ring-1 ring-foreground/10"
          />
        ) : null}
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {item.sources.map((source) => {
              const meta = sourceMeta[source]
              const Icon = meta.icon
              return (
                <Badge key={source} variant="outline" className="gap-1">
                  <Icon className="size-3 shrink-0" weight={source === "heart" ? "fill" : "regular"} />
                  {meta.label}
                </Badge>
              )
            })}
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:text-xs"
          >
            Open on X
            <ArrowSquareOutIcon className="size-4 shrink-0" />
          </a>
        </div>
      </div>
    </article>
  )
}

function EmptyState({
  eyebrow,
  title,
  copy,
  action,
  onAction,
}: {
  eyebrow: string
  title: string
  copy: string
  action: string
  onAction: () => void
}) {
  return (
    <div className="max-w-lg py-12">
      <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{eyebrow}</p>
      <h2 className="mt-3 font-heading text-2xl font-medium tracking-wide text-balance uppercase">{title}</h2>
      <p className="mt-3 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">{copy}</p>
      <Button type="button" variant="secondary" size="sm" className="mt-5" onClick={onAction}>
        {action}
      </Button>
    </div>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number
  icon: typeof HeartIcon
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
      <dt className="flex items-center gap-2">
        <Icon className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

function SourceOption({
  source,
  checked,
  onChange,
}: {
  source: "bookmark" | "heart"
  checked: boolean
  onChange: () => void
}) {
  const meta = sourceMeta[source]
  const Icon = meta.icon
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 border border-border p-3", checked && "bg-muted")}>
      <input
        type="radio"
        name="source"
        value={source}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-5 accent-primary sm:size-4"
      />
      <span className="grid gap-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="size-4 shrink-0" />
          {source === "bookmark" ? "Bookmark" : "Heart"}
        </span>
        <span className="text-sm/5 text-muted-foreground">
          {source === "bookmark" ? "Something to return to." : "Something you appreciated."}
        </span>
      </span>
    </label>
  )
}

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "M"
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date)
}
