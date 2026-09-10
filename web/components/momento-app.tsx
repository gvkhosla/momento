"use client"

import Link from "next/link"
import * as React from "react"
import {
  ArrowSquareOutIcon,
  BookmarkSimpleIcon,
  CheckCircleIcon,
  ClipboardIcon,
  CloudSlashIcon,
  EnvelopeSimpleIcon,
  HeartIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShareNetworkIcon,
  SparkleIcon,
} from "@phosphor-icons/react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
type Mode = "today" | "search" | "answer"

type Extraction = {
  status?: string
  url?: string
  title?: string
  site?: string
  excerpt?: string
  imageUrl?: string
  kind?: string
}

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
  extraction?: Extraction | null
}

type BriefCard = {
  id: string
  url: string
  tweetUrl: string
  title: string
  site: string
  excerpt: string
  imageUrl?: string
}

type Brief = {
  date: string
  headline: string
  summary: string
  insights: string[]
  recents: BriefCard[]
  podcastScript: string
}

type Settings = {
  email: string
  briefHour: number
  timezone: string
  mailConfigured: boolean
}

type Counts = Record<SourceFilter, number>

type ArchiveResponse = {
  results: Memory[]
  counts: Counts
  hasMore?: boolean
}

type AnswerResponse = {
  answer?: string
  error?: string
  local?: boolean
  retrieval?: string
  references?: Memory[]
}

const sources: Array<{ value: SourceFilter; label: string }> = [
  { value: "bookmark", label: "Bookmarks" },
  { value: "all", label: "Everything" },
  { value: "heart", label: "Hearts" },
  { value: "shared", label: "Shared" },
]

const PAGE_SIZE = 24

const sourceMeta: Record<Source, { label: string; icon: typeof HeartIcon }> = {
  bookmark: { label: "Bookmarked", icon: BookmarkSimpleIcon },
  heart: { label: "Hearted", icon: HeartIcon },
  shared: { label: "Shared", icon: ShareNetworkIcon },
}

export function MomentoApp() {
  const [mode, setMode] = React.useState<Mode>("today")
  const [query, setQuery] = React.useState("")
  const [debouncedQuery, setDebouncedQuery] = React.useState("")
  const [source, setSource] = React.useState<SourceFilter>("bookmark")
  const [items, setItems] = React.useState<Memory[]>([])
  const [counts, setCounts] = React.useState<Counts>({
    all: 0,
    bookmark: 0,
    heart: 0,
    shared: 0,
  })
  const [online, setOnline] = React.useState<boolean | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const [visibleLimit, setVisibleLimit] = React.useState(PAGE_SIZE)
  const [loadedSearchKey, setLoadedSearchKey] = React.useState("")
  const [captureOpen, setCaptureOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [captureUrl, setCaptureUrl] = React.useState("")
  const [captureSource, setCaptureSource] = React.useState<"bookmark" | "heart">("bookmark")
  const [captureError, setCaptureError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [toast, setToast] = React.useState("")
  const [answer, setAnswer] = React.useState("")
  const [answerReferences, setAnswerReferences] = React.useState<Memory[]>([])
  const [answerError, setAnswerError] = React.useState("")
  const [asking, setAsking] = React.useState(false)
  const [answerPhase, setAnswerPhase] = React.useState<"idle" | "retrieving" | "generating">("idle")
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [brief, setBrief] = React.useState<Brief | null>(null)
  const [briefLoading, setBriefLoading] = React.useState(true)
  const [briefBusy, setBriefBusy] = React.useState(false)
  const [settings, setSettings] = React.useState<Settings>({
    email: "",
    briefHour: 7,
    timezone: "local",
    mailConfigured: false,
  })
  const [emailDraft, setEmailDraft] = React.useState("")
  const [hourDraft, setHourDraft] = React.useState("7")
  const searchRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 120)
    return () => window.clearTimeout(timer)
  }, [query])

  React.useEffect(() => {
    const controller = new AbortController()
    fetch("/api/brief", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("offline")
        return response.json() as Promise<{ brief: Brief | null }>
      })
      .then((data) => setBrief(data.brief))
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return
      })
      .finally(() => setBriefLoading(false))

    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("offline")
        return response.json() as Promise<{ counts?: Counts; settings?: Settings }>
      })
      .then((data) => {
        if (data.counts) setCounts(data.counts)
        if (data.settings) {
          setSettings(data.settings)
          setEmailDraft(data.settings.email || "")
          setHourDraft(String(data.settings.briefHour ?? 7))
        }
        setOnline(true)
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return
        setOnline(false)
      })
    return () => controller.abort()
  }, [refreshKey])

  React.useEffect(() => {
    const timer = window.setInterval(() => setRefreshKey((key) => key + 1), 20_000)
    return () => window.clearInterval(timer)
  }, [])

  const searchKey = `${debouncedQuery}\u0000${source}\u0000${visibleLimit}\u0000${refreshKey}`
  const isSearching = mode === "search" && loadedSearchKey !== searchKey

  React.useEffect(() => {
    if (mode !== "search") return
    const controller = new AbortController()
    const params = new URLSearchParams({
      q: debouncedQuery,
      source,
      limit: String(visibleLimit),
    })

    fetch(`/api/items?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Archive offline")
        return (await response.json()) as ArchiveResponse
      })
      .then((data) => {
        setItems(data.results ?? [])
        setCounts(data.counts ?? { all: 0, bookmark: 0, heart: 0, shared: 0 })
        setHasMore(Boolean(data.hasMore))
        setLoadedSearchKey(searchKey)
        setOnline(true)
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return
        setLoadedSearchKey(searchKey)
        setOnline(false)
      })

    return () => controller.abort()
  }, [debouncedQuery, mode, searchKey, source, visibleLimit])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setMode("search")
        window.setTimeout(() => searchRef.current?.focus(), 0)
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
    setAnswerPhase("retrieving")
    setAnswer("")
    setAnswerReferences([])
    setAnswerError("")

    try {
      const retrievalResponse = await fetch("/api/retrieve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, source, limit: 6 }),
      })
      const retrieval = (await retrievalResponse.json()) as AnswerResponse
      if (!retrievalResponse.ok) {
        throw new Error(retrieval.error || "Momento could not find supporting posts.")
      }
      const references = retrieval.references || []
      setAnswerReferences(references)
      setAnswerPhase("generating")

      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          source,
          referenceIds: references.map((item) => item.id),
          retrieval: retrieval.retrieval,
        }),
      })
      const data = (await response.json()) as AnswerResponse
      if (!response.ok) throw new Error(data.error || "Momento could not answer that.")
      setAnswer(data.answer || "")
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : "Momento could not answer that.")
    } finally {
      setAsking(false)
      setAnswerPhase("idle")
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

  async function generateBrief(send = false) {
    setBriefBusy(true)
    try {
      const response = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: send, skipModel: false }),
      })
      const data = (await response.json()) as { brief?: Brief; error?: string }
      if (!response.ok) throw new Error(data.error || "Could not build today's brief.")
      setBrief(data.brief || null)
      setToast(send ? "Brief emailed." : "Today's brief is ready.")
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not build today's brief.")
    } finally {
      setBriefBusy(false)
    }
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailDraft, briefHour: Number(hourDraft) }),
    })
    const data = (await response.json()) as { settings?: Settings; error?: string }
    if (!response.ok) {
      setToast(data.error || "Could not save settings.")
      return
    }
    if (data.settings) {
      setSettings(data.settings)
      setEmailDraft(data.settings.email || "")
      setHourDraft(String(data.settings.briefHour ?? 7))
    }
    setSettingsOpen(false)
    setToast("Daily brief settings saved.")
  }

  const displayedItems = mode === "answer" ? answerReferences : items
  const hasArchive = counts.bookmark > 0 || counts.all > 0
  const hasResults = displayedItems.length > 0

  function changeMode(nextMode: Mode) {
    setMode(nextMode)
    setAnswer("")
    setAnswerReferences([])
    setAnswerError("")
  }

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
              {online === null ? "Connecting" : online ? "Watching bookmarks" : "Archive offline"}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
              <EnvelopeSimpleIcon data-icon="inline-start" />
              Daily
            </Button>
            <Button size="sm" onClick={() => setCaptureOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Add a link
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="max-w-3xl">
          <h1 className="font-heading text-2xl font-medium tracking-tight text-balance sm:text-3xl">
            {mode === "today" ? "What you saved, written back to you." : "Find something you saved."}
          </h1>
          <p className="mt-2 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
            Momento extracts the articles behind your X bookmarks
            {counts.bookmark ? (
              <>
                {" "}
                — <span className="tabular-nums text-foreground">{counts.bookmark.toLocaleString()}</span> so far
              </>
            ) : null}
            — and sends a brief before you ask.
          </p>

          <div className="mt-6 inline-flex border border-border bg-card p-1" role="tablist" aria-label="Recall mode">
            <ModeTab current={mode} value="today" onClick={() => changeMode("today")} icon={EnvelopeSimpleIcon} label="Today" />
            <ModeTab current={mode} value="search" onClick={() => changeMode("search")} icon={MagnifyingGlassIcon} label="Search" />
            <ModeTab current={mode} value="answer" onClick={() => changeMode("answer")} icon={SparkleIcon} label="Ask" filled />
          </div>

          {mode !== "today" ? (
            <form
              onSubmit={mode === "answer" ? askArchive : (event) => event.preventDefault()}
              className="relative mt-3 max-w-3xl"
            >
              {mode === "answer" ? (
                <SparkleIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-primary" weight="fill" />
              ) : (
                <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              )}
              <Input
                ref={searchRef}
                name="q"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setVisibleLimit(PAGE_SIZE)
                  setAnswer("")
                  setAnswerReferences([])
                  setAnswerError("")
                }}
                aria-label={mode === "answer" ? "Ask your archive" : "Search your archive"}
                placeholder={
                  mode === "answer"
                    ? "Ask a question about what you bookmarked…"
                    : "A phrase, person, or half-remembered article…"
                }
                disabled={asking}
                className="h-12 bg-card pr-24 pl-11 text-base sm:text-sm"
              />
              {mode === "answer" && query.trim() ? (
                <Button
                  type="submit"
                  size="sm"
                  disabled={asking || online === false}
                  className="absolute top-1/2 right-2 -translate-y-1/2"
                >
                  <SparkleIcon data-icon="inline-start" weight="fill" />
                  {answerPhase === "retrieving" ? "Finding…" : answerPhase === "generating" ? "Writing…" : "Answer"}
                </Button>
              ) : (
                <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground sm:block">
                  ⌘ K
                </kbd>
              )}
            </form>
          ) : null}
        </section>

        {mode === "today" ? (
          <TodayBrief
            brief={brief}
            loading={briefLoading}
            busy={briefBusy}
            settings={settings}
            onGenerate={() => generateBrief(false)}
            onSend={() => generateBrief(true)}
            onConfigure={() => setSettingsOpen(true)}
          />
        ) : (
          <>
            <nav className="mt-3 flex max-w-3xl gap-1 overflow-x-auto" aria-label="Filter archive">
              {sources.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={source === item.value}
                  onClick={() => {
                    setSource(item.value)
                    setVisibleLimit(PAGE_SIZE)
                    setAnswer("")
                    setAnswerReferences([])
                    setAnswerError("")
                  }}
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-1.5 px-3 text-base text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-9 sm:text-xs",
                    source === item.value && "bg-muted text-foreground",
                  )}
                >
                  {item.label}
                  <span className="tabular-nums opacity-60">{counts[item.value]}</span>
                </button>
              ))}
            </nav>

            {mode === "answer" && (answer || answerError || asking) ? (
              <section className="mt-8 max-w-3xl border border-border bg-card p-5 shadow-sm" aria-live="polite">
                <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
                  <h2 className="flex items-center gap-2 font-heading text-sm font-semibold tracking-wider uppercase">
                    <SparkleIcon className="size-4 text-primary" weight="fill" />
                    Answer from your bookmarks
                  </h2>
                  <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase">Local · private</p>
                </div>
                {asking ? (
                  <p className="py-6 text-base/7 text-muted-foreground sm:text-sm/6">
                    {answerPhase === "retrieving"
                      ? "Finding the strongest references…"
                      : `Writing from ${answerReferences.length} references on this Mac…`}
                  </p>
                ) : answerError ? (
                  <p className="py-6 text-base/7 text-destructive sm:text-sm/6">{answerError}</p>
                ) : (
                  <AnswerText answer={answer} />
                )}
              </section>
            ) : null}

            <div className="mt-8 max-w-3xl">
              <section className="min-w-0" aria-labelledby="results-heading">
                <div className="flex min-h-8 items-baseline justify-between gap-4 border-b border-border pb-3">
                  <h2 id="results-heading" className="text-sm font-semibold">
                    {mode === "answer" ? "References" : debouncedQuery ? "Search results" : "Recent bookmarks"}
                  </h2>
                  <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                    {isSearching && mode === "search"
                      ? "Searching…"
                      : hasResults
                        ? `${displayedItems.length}${hasMore && mode === "search" ? "+" : ""} ${
                            mode === "answer"
                              ? displayedItems.length === 1 ? "reference" : "references"
                              : displayedItems.length === 1 ? "memory" : "memories"
                          }`
                        : ""}
                  </p>
                </div>

                {hasResults ? (
                  <>
                    <div role="list" aria-busy={isSearching} className={cn(isSearching && "opacity-60")}>
                      {displayedItems.map((item, index) => (
                        <MemoryItem
                          key={item.id}
                          item={item}
                          referenceIndex={mode === "answer" ? index + 1 : undefined}
                        />
                      ))}
                    </div>
                    {mode === "search" && hasMore ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isSearching}
                        onClick={() => setVisibleLimit((limit) => limit + PAGE_SIZE)}
                        className="mt-5"
                      >
                        {isSearching ? "Loading…" : "Load more"}
                      </Button>
                    ) : null}
                  </>
                ) : isSearching && mode === "search" ? (
                  <p className="py-10 text-base/7 text-muted-foreground sm:text-sm/6">Loading your archive…</p>
                ) : mode === "answer" && asking ? null : mode === "answer" && hasArchive ? (
                  <EmptyState
                    eyebrow="Ask mode"
                    title="Ask across what you bookmarked."
                    copy="Momento retrieves the strongest matching bookmarks and extracted articles, then answers only from that evidence."
                    action="Search instead"
                    onAction={() => changeMode("search")}
                  />
                ) : hasArchive ? (
                  <EmptyState
                    eyebrow="Nothing surfaced"
                    title="Try the part you actually remember."
                    copy="Use a person, phrase, or article title. Momento now searches the extracted page, not just the tweet."
                    action="Show everything"
                    onAction={() => setQuery("")}
                  />
                ) : (
                  <EmptyState
                    eyebrow="Your wall is empty"
                    title="Start with bookmarks."
                    copy="Sync Bookmarks from the browser extension. Momento will extract each linked article and write you tomorrow morning."
                    action="Add your first link"
                    onAction={() => setCaptureOpen(true)}
                  />
                )}
              </section>
            </div>
          </>
        )}
      </main>

      <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Write it down</DialogTitle>
            <DialogDescription>Paste any link — an X post, an article, a repo. Momento extracts it and puts it in Today.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveCapture} className="grid gap-5">
            <div className="grid gap-2">
              <label htmlFor="capture-url" className="text-sm font-medium">
                Link
              </label>
              <div className="relative">
                <Input
                  id="capture-url"
                  name="url"
                  type="url"
                  inputMode="url"
                  value={captureUrl}
                  onChange={(event) => setCaptureUrl(event.target.value)}
                  placeholder="https://…"
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

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Daily brief</DialogTitle>
            <DialogDescription>
              Momento writes locally every morning and emails the brief if Resend is configured.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveSettings} className="grid gap-5">
            <div className="grid gap-2">
              <label htmlFor="brief-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="brief-email"
                type="email"
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
                placeholder="you@domain.com"
                className="max-sm:text-base"
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="brief-hour" className="text-sm font-medium">
                Local hour
              </label>
              <Input
                id="brief-hour"
                type="number"
                min={0}
                max={23}
                value={hourDraft}
                onChange={(event) => setHourDraft(event.target.value)}
                className="max-w-24 max-sm:text-base"
              />
              <p className="text-xs text-muted-foreground">
                {settings.mailConfigured
                  ? `Sends around ${hourDraft}:00 ${settings.timezone}.`
                  : "Set RESEND_API_KEY in the environment that runs `momento serve`."}
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full sm:w-auto">
                Save
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

function ModeTab({
  current,
  value,
  onClick,
  icon: Icon,
  label,
  filled,
}: {
  current: Mode
  value: Mode
  onClick: () => void
  icon: typeof MagnifyingGlassIcon
  label: string
  filled?: boolean
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={current === value}
      onClick={onClick}
      className={cn(
        "flex h-10 items-center gap-1.5 px-3 text-base font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-8 sm:text-xs",
        current === value && "bg-muted text-foreground",
      )}
    >
      <Icon className="size-3.5" weight={filled ? "fill" : "regular"} />
      {label}
    </button>
  )
}

function TodayBrief({
  brief,
  loading,
  busy,
  settings,
  onGenerate,
  onSend,
  onConfigure,
}: {
  brief: Brief | null
  loading: boolean
  busy: boolean
  settings: Settings
  onGenerate: () => void
  onSend: () => void
  onConfigure: () => void
}) {
  if (loading) {
    return <p className="mt-10 max-w-3xl text-base/7 text-muted-foreground sm:text-sm/6">Reading today&apos;s brief…</p>
  }

  if (!brief) {
    return (
      <div className="mt-10 max-w-3xl">
        <EmptyState
          eyebrow="No brief yet"
          title="Write this morning's note."
          copy="Momento will extract new bookmarks, reread the archive, and leave a brief here. Add an email if you want it in your inbox."
          action={busy ? "Writing…" : "Write today's brief"}
          onAction={onGenerate}
        />
      </div>
    )
  }

  return (
    <section className="mt-8 max-w-3xl">
      <div className="border border-border bg-card p-5 shadow-sm sm:p-7">
        <p className="font-mono text-[0.6875rem] tracking-widest text-muted-foreground uppercase">
          {brief.date} · daily brief
        </p>
        <h2 className="mt-3 font-heading text-2xl font-medium tracking-tight text-balance">{brief.headline}</h2>
        <p className="mt-3 text-base/7 text-pretty sm:text-sm/6">{brief.summary}</p>
        {brief.insights.length ? (
          <ol className="mt-5 grid gap-3">
            {brief.insights.map((insight) => (
              <li key={insight} className="border-l-2 border-primary/40 pl-3 text-base/7 sm:text-sm/6">
                {insight}
              </li>
            ))}
          </ol>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onGenerate} disabled={busy}>
            {busy ? "Writing…" : "Refresh brief"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={settings.email ? onSend : onConfigure} disabled={busy}>
            <EnvelopeSimpleIcon data-icon="inline-start" />
            {settings.email ? "Email me this" : "Add email"}
          </Button>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="text-sm font-semibold">New bookmarks</h3>
        <div role="list" className="mt-3">
          {brief.recents.length ? (
            brief.recents.map((item) => <BriefItem key={item.id} item={item} />)
          ) : (
            <p className="text-base/7 text-muted-foreground sm:text-sm/6">
              Nothing new in this window. The brief reread older bookmarks instead.
            </p>
          )}
        </div>
      </div>

      {brief.podcastScript ? (
        <div className="mt-8 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Podcast script</h3>
          <p className="mt-3 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">{brief.podcastScript}</p>
        </div>
      ) : null}
    </section>
  )
}

function BriefItem({ item }: { item: BriefCard }) {
  return (
    <article role="listitem" className="grid gap-1 border-b border-border py-4">
      <a href={item.url} target="_blank" rel="noreferrer" className="text-base font-semibold hover:text-primary sm:text-sm">
        {item.title}
      </a>
      <p className="text-xs text-muted-foreground">{item.site}</p>
      <p className="line-clamp-3 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">{item.excerpt}</p>
    </article>
  )
}

function AnswerText({ answer }: { answer: string }) {
  const body = answer.split(/\n+Sources:\s*/i)[0] || answer
  return (
    <div className="py-5 text-base/7 text-foreground sm:text-sm/6">
      {body.split("\n").map((line, index) =>
        line ? <p key={`${line}-${index}`}>{line}</p> : <div key={`space-${index}`} className="h-3" />,
      )}
    </div>
  )
}

function MemoryItem({ item, referenceIndex }: { item: Memory; referenceIndex?: number }) {
  const extracted = item.extraction?.status === "ready" ? item.extraction : null
  return (
    <article
      role="listitem"
      className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-border py-4 [contain-intrinsic-size:auto_11rem] [content-visibility:auto]"
    >
      <Avatar className="size-8">
        <AvatarFallback>{initials(item.author.displayName || item.author.handle)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {referenceIndex ? <p className="font-mono text-xs text-primary">[{referenceIndex}]</p> : null}
          <p className="max-w-full truncate text-base font-semibold sm:text-sm">{item.author.displayName}</p>
          <p className="text-base text-muted-foreground sm:text-sm">@{item.author.handle}</p>
          <time className="text-base text-muted-foreground sm:text-xs" dateTime={item.postedAt}>
            · {formatDate(item.postedAt)}
          </time>
        </div>
        {extracted?.title ? (
          <p className="mt-1.5 text-base font-medium sm:text-sm">{extracted.title}</p>
        ) : null}
        <p className="mt-1.5 line-clamp-5 whitespace-pre-line text-base/7 text-pretty sm:text-sm/6">
          {extracted?.excerpt || item.text}
        </p>
        <div className="mt-3 flex items-end justify-between gap-4">
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
            {extracted?.site ? (
              <Badge variant="secondary">{extracted.site}</Badge>
            ) : null}
          </div>
          <a
            href={extracted?.url || item.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-9 shrink-0 items-center gap-1 text-base text-muted-foreground hover:text-foreground sm:min-h-0 sm:text-xs"
          >
            {extracted?.url ? "Open article" : "Open on X"}
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
      <h2 className="mt-3 font-heading text-2xl font-medium tracking-tight text-balance">{title}</h2>
      <p className="mt-3 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">{copy}</p>
      <Button type="button" variant="secondary" size="sm" className="mt-5" onClick={onAction}>
        {action}
      </Button>
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
      <div className="grid gap-1">
        <p className="flex items-center gap-1.5 text-base font-semibold sm:text-sm">
          <Icon className="size-5 shrink-0 sm:size-4" />
          {source === "bookmark" ? "Bookmark" : "Heart"}
        </p>
        <p className="text-base/6 text-muted-foreground sm:text-sm/5">
          {source === "bookmark" ? "Extract the article. Use it in briefs." : "Keep the mark. Skip the brief."}
        </p>
      </div>
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
