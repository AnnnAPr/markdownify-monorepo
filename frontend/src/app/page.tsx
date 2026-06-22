'use client'

import { useState, useEffect } from 'react'

interface RateLimitInfo {
  burstLimit: number
  burstRemaining: number
  burstResetInMs: number
  dailyLimit: number
  dailyRemaining: number
  dailyResetInMs: number
}

interface ScrapeResult {
  status: string
  title: string
  author: string | null
  publishedDate: string | null
  wordCount: number
  rawTokenCount?: number
  cleanTokenCount?: number
  tokensSavedEstimate?: number
  savingsPercent?: number
  markdown: string
  cached?: boolean
}

export default function Home() {
  const [mode, setMode] = useState<'url' | 'html'>('url')
  const [url, setUrl] = useState('')
  const [htmlInput, setHtmlInput] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [stats, setStats] = useState<ScrapeResult | null>(null)
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const fetchRateLimit = async () => {
      try {
        const res = await fetch(`${API_URL}/v1/rate-limit`)
        if (res.ok) {
          const data = await res.json()
          if (data.rateLimit) {
            setRateLimit(data.rateLimit)
          }
        }
      } catch (err) {
        console.error('Failed to fetch rate limit:', err)
      }
    }
    fetchRateLimit()
  }, [])

  const handleModeChange = (newMode: 'url' | 'html') => {
    setMode(newMode)
    setError('')
    setMarkdown('')
    setStats(null)
    setCopied(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setMarkdown('')
    setStats(null)
    setCopied(false)

    try {
      const isHtmlMode = mode === 'html'
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      const endpoint = isHtmlMode ? `${API_URL}/v1/convert` : `${API_URL}/v1/scrape`
      const body = isHtmlMode ? JSON.stringify({ html: htmlInput }) : JSON.stringify({ url })

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        if (errData.rateLimit) {
          setRateLimit(errData.rateLimit)
        }
        throw new Error(errData.message || 'Failed to process request')
      }

      const data = await response.json()
      setMarkdown(data.markdown || '')
      setStats(data)
      if (data.rateLimit) {
        setRateLimit(data.rateLimit)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const handleDownload = () => {
    if (!markdown) return
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' })
    const urlBlob = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = urlBlob
    const fileName = stats?.title
      ? `${stats.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`
      : 'extracted.md'
    link.setAttribute('download', fileName)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(urlBlob)
  }

  // Real-time Rate Limit Countdown Timer
  useEffect(() => {
    if (!rateLimit) return
    const hasBurstTimer = rateLimit.burstRemaining === 0 && rateLimit.burstResetInMs > 0
    const hasDailyTimer = rateLimit.dailyRemaining === 0 && rateLimit.dailyResetInMs > 0
    if (!hasBurstTimer && !hasDailyTimer) return

    const timer = setInterval(() => {
      setRateLimit((prev) => {
        if (!prev) return null
        return {
          ...prev,
          burstResetInMs: Math.max(0, prev.burstResetInMs - 1000),
          dailyResetInMs: Math.max(0, prev.dailyResetInMs - 1000),
        }
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [
    rateLimit
      ? (rateLimit.burstRemaining === 0 && rateLimit.burstResetInMs > 0) ||
        (rateLimit.dailyRemaining === 0 && rateLimit.dailyResetInMs > 0)
      : false,
  ])

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-8 font-sans">
      <div className="max-w-[1600px] mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2 pt-12">
          <h1 className="text-4xl font-bold tracking-tight text-white">Markdownify</h1>
          <p className="text-neutral-400">
            Extract any URL or convert raw HTML into clean Markdown.
          </p>
        </div>

        {/* Mode Tab Toggle */}
        <div className="flex justify-center">
          <div className="inline-flex bg-neutral-900 border border-neutral-800 rounded-xl p-1 gap-1">
            <button
              type="button"
              id="tab-url"
              onClick={() => handleModeChange('url')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                mode === 'url'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              URL Extractor
            </button>
            <button
              type="button"
              id="tab-html"
              onClick={() => handleModeChange('html')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                mode === 'html'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              </svg>
              HTML Converter
            </button>
          </div>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-3">
          {mode === 'url' ? (
            <div className="flex gap-4">
              <div className="relative flex-1">
                <input
                  type="url"
                  value={url}
                  disabled={isLoading}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    if (error) setError('')
                    setStats(null)
                    setMarkdown('')
                    setCopied(false)
                  }}
                  placeholder="https://example.com/article"
                  required
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 pr-10 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {url && !isLoading && (
                  <button
                    type="button"
                    onClick={() => {
                      setUrl('')
                      setError('')
                      setStats(null)
                      setMarkdown('')
                      setCopied(false)
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white transition-colors"
                    aria-label="Clear URL"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isLoading || !url}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-all active:scale-95 flex items-center justify-center min-w-[120px]"
              >
                {isLoading ? 'Extracting...' : 'Extract'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <textarea
                  value={htmlInput}
                  disabled={isLoading}
                  onChange={(e) => {
                    setHtmlInput(e.target.value)
                    if (error) setError('')
                    setStats(null)
                    setMarkdown('')
                    setCopied(false)
                  }}
                  placeholder={`Paste raw HTML here...\n\n<article>\n  <h1>My Article</h1>\n  <p>Content goes here...</p>\n</article>`}
                  required
                  rows={8}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-300 font-mono text-sm placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all resize-y leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {htmlInput && !isLoading && (
                  <button
                    type="button"
                    onClick={() => {
                      setHtmlInput('')
                      setError('')
                      setStats(null)
                      setMarkdown('')
                      setCopied(false)
                    }}
                    className="absolute right-3 top-3 text-neutral-400 hover:text-white transition-colors"
                    aria-label="Clear HTML"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isLoading || !htmlInput.trim()}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                  />
                </svg>
                {isLoading ? 'Converting...' : 'Convert to Markdown'}
              </button>
            </div>
          )}
        </form>

        {/* Error Message */}
        {error && (
          <div className="p-4 bg-red-900/20 border border-red-900 text-red-400 rounded-lg max-w-2xl mx-auto text-center">
            {error}
          </div>
        )}

        {/* Result Area */}
        {stats && (
          <div className="mt-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(auto,896px)_1fr] gap-6 items-start">
              {/* Left spacer */}
              <div className="hidden xl:block"></div>

              {/* Main Column */}
              <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Result</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopy}
                      className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                        copied
                          ? 'bg-green-600/20 text-green-400 border border-green-600/50'
                          : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700'
                      }`}
                    >
                      {copied ? (
                        <>
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        <>
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                            />
                          </svg>
                          Copy Markdown
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 active:scale-95"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                      Download .md
                    </button>
                  </div>
                </div>

                <div className="relative group">
                  <textarea
                    readOnly
                    value={markdown}
                    className="w-full h-[500px] p-6 bg-neutral-900 border border-neutral-800 rounded-xl text-neutral-300 font-mono text-sm leading-relaxed focus:outline-none resize-y"
                  />
                </div>

                {/* Low-quality output warning — shown in HTML mode when result is nearly empty */}
                {mode === 'html' && stats && stats.wordCount < 20 && (
                  <div className="flex gap-3 p-4 bg-amber-950/40 border border-amber-800/60 rounded-lg text-amber-300">
                    <svg
                      className="w-5 h-5 mt-0.5 shrink-0 text-amber-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                      />
                    </svg>
                    <div className="text-sm space-y-1">
                      <p className="font-medium text-amber-200">Output is nearly empty</p>
                      <p className="text-amber-400/80">
                        The pasted HTML produced very little readable content. This usually happens
                        when you paste{' '}
                        <code className="bg-amber-900/40 px-1 rounded text-amber-300">
                          &lt;head&gt;
                        </code>
                        ,{' '}
                        <code className="bg-amber-900/40 px-1 rounded text-amber-300">
                          &lt;script&gt;
                        </code>
                        , or{' '}
                        <code className="bg-amber-900/40 px-1 rounded text-amber-300">
                          &lt;style&gt;
                        </code>{' '}
                        elements which contain no visible text. Try pasting the{' '}
                        <code className="bg-amber-900/40 px-1 rounded text-amber-300">
                          &lt;body&gt;
                        </code>{' '}
                        or a specific article element instead.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Stats Column */}
              {stats && stats.rawTokenCount !== undefined && (
                <div className="w-full xl:w-80 space-y-6 xl:pt-[44px]">
                  {/* Rate Limits Card */}
                  {rateLimit && (
                    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-4">
                      <h3 className="text-lg font-medium text-white">Rate Limits</h3>
                      <div className="space-y-4">
                        {/* 15-Minute Limit */}
                        <div>
                          <div className="flex justify-between items-center mb-1 text-sm">
                            <span className="text-neutral-400">15-Min Limit</span>
                            <span
                              className={`font-semibold ${
                                rateLimit.burstRemaining === 0
                                  ? 'text-red-400'
                                  : rateLimit.burstRemaining <= 5
                                    ? 'text-yellow-400'
                                    : 'text-blue-400'
                              }`}
                            >
                              {rateLimit.burstRemaining} / {rateLimit.burstLimit}
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-500 ${
                                rateLimit.burstRemaining === 0
                                  ? 'bg-red-500'
                                  : rateLimit.burstRemaining <= 5
                                    ? 'bg-yellow-500'
                                    : 'bg-blue-500'
                              }`}
                              style={{
                                width: `${(rateLimit.burstRemaining / rateLimit.burstLimit) * 100}%`,
                              }}
                            />
                          </div>
                          {rateLimit.burstRemaining === 0 && rateLimit.burstResetInMs > 0 && (
                            <div className="text-xs text-red-400/80 mt-1.5 flex items-center gap-1.5">
                              <svg
                                className="w-3.5 h-3.5 animate-spin"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                />
                              </svg>
                              Resets in {Math.ceil(rateLimit.burstResetInMs / 1000)}s
                            </div>
                          )}
                        </div>

                        {/* Daily Limit */}
                        <div>
                          <div className="flex justify-between items-center mb-1 text-sm">
                            <span className="text-neutral-400">Daily Limit</span>
                            <span
                              className={`font-semibold ${
                                rateLimit.dailyRemaining === 0
                                  ? 'text-red-400'
                                  : rateLimit.dailyRemaining <= 20
                                    ? 'text-yellow-400'
                                    : 'text-green-400'
                              }`}
                            >
                              {rateLimit.dailyRemaining} / {rateLimit.dailyLimit}
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-500 ${
                                rateLimit.dailyRemaining === 0
                                  ? 'bg-red-500'
                                  : rateLimit.dailyRemaining <= 20
                                    ? 'bg-yellow-500'
                                    : 'bg-green-500'
                              }`}
                              style={{
                                width: `${(rateLimit.dailyRemaining / rateLimit.dailyLimit) * 100}%`,
                              }}
                            />
                          </div>
                          {rateLimit.dailyRemaining === 0 && rateLimit.dailyResetInMs > 0 && (
                            <div className="text-xs text-red-400/80 mt-1.5">
                              Resets in {Math.ceil(rateLimit.dailyResetInMs / (60 * 60 * 1000))}h
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Statistics Card */}
                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
                    <h3 className="text-lg font-medium text-white mb-4">Statistics</h3>
                    <div className="space-y-4">
                      <div>
                        <div className="text-sm text-neutral-400 mb-1">Raw HTML Tokens</div>
                        <div className="text-2xl font-semibold text-white">
                          {stats.rawTokenCount?.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-neutral-400 mb-1">Clean Markdown Tokens</div>
                        <div className="text-2xl font-semibold text-white">
                          {stats.cleanTokenCount?.toLocaleString()}
                        </div>
                      </div>
                      <div className="pt-4 border-t border-neutral-800">
                        <div className="text-sm text-neutral-400 mb-1">Tokens Saved</div>
                        {stats.wordCount >= 20 ? (
                          <div className="text-2xl font-semibold text-green-400">
                            {stats.tokensSavedEstimate?.toLocaleString()}
                            <span className="text-sm font-normal text-green-500/70 ml-2">
                              ({stats.savingsPercent}%)
                            </span>
                          </div>
                        ) : (
                          <div className="text-2xl font-semibold text-neutral-500">—</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating Feedback Button */}
      <a
        href="https://forms.gle/rGmrD4HJ86dMw2Tm9"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed top-6 right-6 z-50 flex items-center gap-2 bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 backdrop-blur-md text-neutral-300 hover:text-white px-4 py-2.5 rounded-full shadow-lg shadow-black/40 transition-all hover:scale-105 active:scale-95 text-sm font-medium"
      >
        <svg
          className="w-4 h-4 text-blue-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
          />
        </svg>
        Share Feedback
      </a>
    </main>
  )
}
