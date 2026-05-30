'use client'

import { useState, useEffect } from 'react'

export default function Home() {
  const [url, setUrl] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [stats, setStats] = useState<any>(null)
  const [rateLimit, setRateLimit] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const fetchRateLimit = async () => {
      try {
        const res = await fetch(`http://localhost:3001/v1/rate-limit`)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setMarkdown('')
    setStats(null)
    setCopied(false)

    try {
      const response = await fetch(`http://localhost:3001/v1/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        if (errData.rateLimit) {
          setRateLimit(errData.rateLimit)
        }
        throw new Error(errData.message || 'Failed to fetch markdown')
      }

      const data = await response.json()
      // The backend returns the scraped markdown in data.markdown
      setMarkdown(data.markdown || data.content || JSON.stringify(data, null, 2))
      setStats(data)
      if (data.rateLimit) {
        setRateLimit(data.rateLimit)
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
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

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-8 font-sans">
      <div className="max-w-[1600px] mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2 pt-12">
          <h1 className="text-4xl font-bold tracking-tight text-white">Markdownify</h1>
          <p className="text-neutral-400">
            Paste any URL to extract its content into clean Markdown.
          </p>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="flex gap-4 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (error) setError('')
              }}
              placeholder="https://example.com/article"
              required
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 pr-10 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            {url && (
              <button
                type="button"
                onClick={() => {
                  setUrl('')
                  setError('')
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
        </form>

        {/* Error Message */}
        {error && (
          <div className="p-4 bg-red-900/20 border border-red-900 text-red-400 rounded-lg max-w-2xl mx-auto text-center">
            {error}
          </div>
        )}

        {/* Result Area */}
        {markdown && (
          <div className="mt-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(auto,896px)_1fr] gap-6 items-start">
              {/* Left spacer */}
              <div className="hidden xl:block"></div>

              {/* Main Column */}
              <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Result</h2>
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
                </div>

                <div className="relative group">
                  <textarea
                    readOnly
                    value={markdown}
                    className="w-full h-[500px] p-6 bg-neutral-900 border border-neutral-800 rounded-xl text-neutral-300 font-mono text-sm leading-relaxed focus:outline-none resize-y"
                  />
                </div>
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
                        <div className="text-2xl font-semibold text-green-400">
                          {stats.tokensSavedEstimate?.toLocaleString()}
                          <span className="text-sm font-normal text-green-500/70 ml-2">
                            ({stats.savingsPercent}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
