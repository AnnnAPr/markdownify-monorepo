import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { encode } from 'gpt-tokenizer'

export interface ScrapeOptions {
  removeImages?: boolean
}

export interface ScrapeResult {
  status: 'success' | 'error'
  title: string
  author: string | null
  publishedDate: string | null
  wordCount: number
  rawTokenCount: number
  cleanTokenCount: number
  tokensSavedEstimate: number
  savingsPercent: number
  markdown: string
  cached?: boolean
}

interface CacheEntry {
  result: ScrapeResult
  expiresAt: number
}

const CACHE_DURATION_MINUTES = 10 * 60 * 1000 // 10 minutes
const MAX_HTML_INPUT_LENGTH = 1024 * 1024 // 1 MB

export class ScraperService {
  private turndownService: TurndownService
  private cache = new Map<string, CacheEntry>()

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
    })

    // Add a rule to remove image tags from the markdown output
    this.turndownService.addRule('remove-images', {
      filter: ['img'],
      replacement: () => '',
    })
  }

  /**
   * Validates a URL for security risks before making any network requests.
   * Blocks private/internal IPs (SSRF protection) and non-HTTP protocols.
   */
  validateUrl(urlString: string): void {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(urlString)
    } catch (_) {
      throw new Error('Invalid URL structure.')
    }

    // Only allow http and https protocols
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(
        `Unsupported protocol "${parsedUrl.protocol}". Only http: and https: are allowed.`
      )
    }

    // Block private/internal IPs and localhost (SSRF protection)
    const hostname = parsedUrl.hostname.toLowerCase()
    const blockedPatterns = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']

    if (blockedPatterns.includes(hostname)) {
      throw new Error('URLs pointing to localhost or loopback addresses are not allowed.')
    }

    // Block private IP ranges: 10.x.x.x, 192.168.x.x, 172.16-31.x.x
    const privateIpPatterns = [
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
      /^192\.168\.\d{1,3}\.\d{1,3}$/,
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
      /^169\.254\.\d{1,3}\.\d{1,3}$/, // Link-local
      /^0\.0\.0\.0$/,
    ]

    if (privateIpPatterns.some((pattern) => pattern.test(hostname))) {
      throw new Error('URLs pointing to private or internal IP addresses are not allowed.')
    }
  }

  /**
   * Fetches the raw HTML content from a given URL.
   * Mimics a realistic browser user agent to avoid simple blocking.
   */
  async fetchHtml(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        // Timeout signal (10 seconds)
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch page. HTTP Status: ${response.status} ${response.statusText}`
        )
      }

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        throw new Error(`Invalid content type: ${contentType}. Expected HTML.`)
      }

      const contentLength = response.headers.get('content-length')
      if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
        throw new Error('Page too large (exceeds 5MB limit).')
      }

      const text = await response.text()
      if (text.length > 5 * 1024 * 1024) {
        throw new Error('Page too large (exceeds 5MB limit).')
      }

      return text
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        throw new Error('Request timed out after 10 seconds.')
      }
      const networkErrors = ['fetch failed', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN']
      if (networkErrors.some((code) => error.message?.includes(code) || error.code === code)) {
        throw new Error(
          'Failed to fetch the page. The site may be down, blocking automated requests, or unreachable from this server.'
        )
      }
      throw new Error(`Failed to fetch HTML: ${error.message}`)
    }
  }

  /**
   * Main scrape logic: extracts clean HTML using Mozilla Readability,
   * converts to Markdown, and calculates metrics.
   */
  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    // Check cache first
    const cached = this.cache.get(url)
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, cached: true }
    }

    const rawHtml = await this.fetchHtml(url)

    const article = this.extractArticle(rawHtml, url)
    const markdown = this.turndownService.turndown(article.content || '').trim()

    if (!markdown) {
      throw new Error('Extracted content resulted in an empty Markdown string.')
    }

    const result = this.buildResult({
      rawHtml,
      markdown,
      title: article.title || 'Untitled',
      author: article.byline || null,
      publishedDate: null,
    })

    // Store in cache
    this.cache.set(url, { result, expiresAt: Date.now() + CACHE_DURATION_MINUTES })

    return result
  }

  /**
   * Translates raw HTML directly to Markdown using Turndown,
   * bypassing the Mozilla Readability selector, and calculates metrics.
   */
  async convertHtml(html: string): Promise<ScrapeResult> {
    const rawHtml = html || ''

    if (rawHtml.length > MAX_HTML_INPUT_LENGTH) {
      throw new Error(`HTML input exceeds ${MAX_HTML_INPUT_LENGTH / 1024 / 1024}MB limit.`)
    }

    const cleanedHtml = this.stripNonContent(rawHtml)
    const markdown = this.turndownService.turndown(cleanedHtml).trim()

    const result = this.buildResult({
      rawHtml,
      markdown,
      title: 'Direct HTML Input',
      author: null,
      publishedDate: null,
    })

    return result
  }

  private countTokens(text: string): number {
    try {
      return encode(text).length
    } catch (e) {
      return Math.ceil(text.length / 4)
    }
  }

  private buildResult(opts: {
    rawHtml: string
    markdown: string
    title: string
    author: string | null
    publishedDate: string | null
  }): ScrapeResult {
    const rawTokenCount = this.countTokens(opts.rawHtml)
    const wordCount = opts.markdown.split(/\s+/).filter((word) => word.length > 0).length
    const cleanTokenCount = this.countTokens(opts.markdown)
    const tokensSavedEstimate = Math.max(0, rawTokenCount - cleanTokenCount)
    const savingsPercent =
      rawTokenCount > 0 ? Math.round((tokensSavedEstimate / rawTokenCount) * 100) : 0

    return {
      status: 'success',
      title: opts.title,
      author: opts.author,
      publishedDate: opts.publishedDate,
      wordCount,
      rawTokenCount,
      cleanTokenCount,
      tokensSavedEstimate,
      savingsPercent,
      markdown: opts.markdown,
    }
  }

  private extractArticle(html: string, url?: string) {
    const dom = new JSDOM(html, { url })
    const document = dom.window.document

    const removeElements = document.querySelectorAll('script, style, iframe, noscript')
    removeElements.forEach((el) => el.remove())

    const reader = new Readability(document)
    const article = reader.parse()

    if (!article) {
      throw new Error(
        'Failed to extract readable content from the webpage. The page may lack clear structured text.'
      )
    }

    return article
  }

  private stripNonContent(html: string): string {
    const dom = new JSDOM(html)
    const document = dom.window.document
    const removeElements = document.querySelectorAll(
      'head, script, style, iframe, noscript, template, svg, canvas, meta, link'
    )
    removeElements.forEach((el) => el.remove())
    return document.body.innerHTML
  }
}
