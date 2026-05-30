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

    // Calculate raw token count
    let rawTokenCount = 0
    try {
      rawTokenCount = encode(rawHtml).length
    } catch (e) {
      // Fallback simple estimation if tokenizer fails on huge raw inputs
      rawTokenCount = Math.ceil(rawHtml.length / 4)
    }

    // Parse DOM with JSDOM
    const dom = new JSDOM(rawHtml, { url })
    const document = dom.window.document

    // Remove scripts, styles, iframes, and other non-article nodes
    const removeElements = document.querySelectorAll('script, style, iframe, noscript')
    removeElements.forEach((el) => el.remove())

    // Extract main content with Mozilla Readability
    const reader = new Readability(document)
    const article = reader.parse()

    if (!article) {
      throw new Error(
        'Failed to extract readable content from the webpage. The page may lack clear structured text.'
      )
    }

    // Convert content to Markdown using Turndown
    const markdown = this.turndownService.turndown(article.content || '').trim()

    if (!markdown) {
      throw new Error('Extracted content resulted in an empty Markdown string.')
    }

    // Calculate clean markdown word and token count
    const wordCount = markdown.split(/\s+/).filter((word) => word.length > 0).length

    let cleanTokenCount = 0
    try {
      cleanTokenCount = encode(markdown).length
    } catch (e) {
      cleanTokenCount = Math.ceil(markdown.length / 4)
    }

    const tokensSavedEstimate = Math.max(0, rawTokenCount - cleanTokenCount)
    const savingsPercent =
      rawTokenCount > 0 ? Math.round((tokensSavedEstimate / rawTokenCount) * 100) : 0

    const result: ScrapeResult = {
      status: 'success',
      title: article.title || 'Untitled',
      author: article.byline || null,
      publishedDate: null, // Readability doesn't always provide publish date natively, can be expanded later
      wordCount,
      rawTokenCount,
      cleanTokenCount,
      tokensSavedEstimate,
      savingsPercent,
      markdown,
    }

    // Store in cache
    this.cache.set(url, { result, expiresAt: Date.now() + CACHE_DURATION_MINUTES })

    return result
  }
}
