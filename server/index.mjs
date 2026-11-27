import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)
const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '..')
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14
const IMAGE_LIMIT_BYTES = 4 * 1024 * 1024
const ORDER_STATUSES = ['Новый', 'В работе', 'Выполнен', 'Отменён']

const emptyDatabase = () => ({ users: [], sessions: [], stores: [], products: [], orders: [] })
const makeId = () => crypto.randomUUID()
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const cleanText = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : ''

function slugify(value) {
  const map = {
    а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'y',
    к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f',
    х:'h', ц:'ts', ч:'ch', ш:'sh', щ:'sch', ы:'y', э:'e', ю:'yu', я:'ya', ь:'', ъ:''
  }
  const latin = [...String(value).toLowerCase()].map((char) => map[char] ?? char).join('')
  return latin.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'my-store'
}

function uniqueSlug(value, stores) {
  const base = slugify(value)
  let candidate = base
  let suffix = 2
  while (stores.some((store) => store.slug === candidate)) {
    candidate = base + '-' + suffix
    suffix += 1
  }
  return candidate
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function setSessionCookie(res, token, forceSecure = false) {
  const secure = (forceSecure || process.env.NODE_ENV === 'production') ? '; Secure' : ''
  res.setHeader('Set-Cookie', 'shopai_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000) + secure)
}

function clearSessionCookie(res, forceSecure = false) {
  const secure = (forceSecure || process.env.NODE_ENV === 'production') ? '; Secure' : ''
  res.setHeader('Set-Cookie', 'shopai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + secure)
}

async function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64)
  return salt + ':' + Buffer.from(key).toString('hex')
}

async function passwordMatches(password, stored) {
  const parts = String(stored).split(':')
  const salt = parts[0]
  const hash = parts[1]
  if (!salt || !hash) return false
  const candidate = Buffer.from(await scrypt(password, salt, 64))
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
}

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email }
}

function publicStore(store, products) {
  return {
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug,
      description: store.description,
      category: store.category,
      primaryColor: store.siteConfig?.primaryColor || store.primaryColor,
      siteConfig: safeSiteConfig(store.siteConfig),
    },
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      seoTitle: product.seoTitle,
      category: product.category,
      price: product.price,
      stock: product.stock,
      imageUrl: product.imageUrl,
    })),
  }
}



async function generateCloudflareJson(prompt, maxOutputTokens = 1200, runtimeConfig = process.env) {
  const accountId = runtimeConfig.CLOUDFLARE_ACCOUNT_ID
  const apiToken = runtimeConfig.CLOUDFLARE_API_TOKEN
  if (!accountId || !apiToken) throw new Error('CLOUDFLARE_CONFIG_MISSING')

  const model = runtimeConfig.CLOUDFLARE_AI_MODEL || '@cf/google/gemma-4-26b-a4b-it'
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/ai/v1/chat/completions'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiToken,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Ты создаёшь готовый контент для интернет-магазина. Верни только валидный JSON. Каждое строковое поле должно содержать реальный, законченный текст на заданном языке. Никогда не возвращай названия типов данных, слова string/text, заглушки, пустые строки или текст схемы. Не объясняй ход решения.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.35,
      max_completion_tokens: maxOutputTokens,
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(45000),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('Cloudflare Workers AI API error:', response.status, detail.slice(0, 500))
    const code = response.status === 429
      ? 'CLOUDFLARE_RATE_LIMIT'
      : response.status === 401 || response.status === 403
        ? 'CLOUDFLARE_AUTH_ERROR'
        : response.status === 410 || response.status === 404
          ? 'CLOUDFLARE_MODEL_UNAVAILABLE'
          : 'CLOUDFLARE_PROVIDER_ERROR'
    const error = new Error(code)
    error.status = response.status
    throw error
  }

  const payload = await response.json()
  const message = payload.choices && payload.choices[0] && payload.choices[0].message
  const raw = message && (message.content || message.reasoning_content)
  if (typeof raw !== 'string' || !raw.trim()) {
    console.error('Cloudflare Workers AI returned no text:', JSON.stringify({
      finish_reason: payload.choices && payload.choices[0] && payload.choices[0].finish_reason,
      hasContent: Boolean(message && message.content),
      hasReasoningContent: Boolean(message && message.reasoning_content),
      usage: payload.usage
    }))
    throw new Error('CLOUDFLARE_EMPTY_RESPONSE')
  }

  const cleaned = raw.trim()
    .replace(/^\u0060{3}(?:json)?\s*/i, '')
    .replace(/\s*\u0060{3}$/, '')
  try {
    return { data: JSON.parse(cleaned), model }
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return { data: JSON.parse(cleaned.slice(start, end + 1)), model }
      } catch {}
    }
    throw new Error('CLOUDFLARE_INVALID_JSON')
  }
}

const SITE_PALETTES = {
  violet: { primary: '#6558d3', background: '#f6f4ff' },
  forest: { primary: '#315f4b', background: '#f1f5f0' },
  sand: { primary: '#a66f42', background: '#f8f2e9' },
  mono: { primary: '#292929', background: '#f3f3f1' },
}
const safeSiteConfig = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const palette = Object.hasOwn(SITE_PALETTES, value.palette) ? value.palette : 'violet'
  const style = ['minimal', 'editorial', 'bold'].includes(value.designStyle) ? value.designStyle : 'minimal'
  return {
    heroTitle: cleanText(value.heroTitle, 100),
    heroSubtitle: cleanText(value.heroSubtitle, 320),
    aboutTitle: cleanText(value.aboutTitle, 100),
    aboutText: cleanText(value.aboutText, 500),
    ctaLabel: cleanText(value.ctaLabel, 40) || 'Смотреть каталог',
    productIntro: cleanText(value.productIntro, 100),
    metaTitle: cleanText(value.metaTitle, 160),
    metaDescription: cleanText(value.metaDescription, 300),
    features: Array.isArray(value.features) ? value.features.slice(0, 4).map((item) => cleanText(item, 70)).filter(Boolean) : [],
    palette,
    designStyle: style,
    primaryColor: SITE_PALETTES[palette].primary,
  }
}

const isPlaceholderCopy = (value) => {
  if (typeof value !== 'string' || !value.trim()) return true
  return /^(string|text|title|description|placeholder|todo|tbd|n\/a|\.\.\.|—|-)$/i.test(value.trim())
}
const hasUsableSiteCopy = (config) => {
  if (!config) return false
  const requiredFields = [
    config.heroTitle, config.heroSubtitle, config.aboutTitle, config.aboutText,
    config.ctaLabel, config.productIntro, config.metaTitle, config.metaDescription,
  ]
  return requiredFields.every((value) => !isPlaceholderCopy(value))
    && config.features.length === 3
    && config.features.every((value) => !isPlaceholderCopy(value))
}

function makeDemoCopy({ name, category, details, tone }) {
  const safeName = cleanText(name, 120)
  const safeCategory = cleanText(category, 80) || 'Товары'
  const safeDetails = cleanText(details, 1200)
  const style = tone === 'Премиальный'
    ? 'Текст выдержан в сдержанном премиальном стиле.'
    : tone === 'Краткий'
      ? 'Краткое описание без лишних формулировок.'
      : 'Дружелюбный и понятный текст для покупателя.'
  const description = [safeName + ' — товар из категории «' + safeCategory + '».', safeDetails, style].filter(Boolean).join('\n\n')
  return { description, seoTitle: safeName + ' — купить в интернет-магазине', provider: 'demo' }
}

export async function createApp(options = {}) {
  const runtimeConfig = options.runtimeConfig || process.env
  const persistence = options.persistence || null
  const uploadStorage = options.uploadStorage || null
  const secureCookies = options.secureCookies ?? runtimeConfig.NODE_ENV === 'production'
  const dataFile = options.dataFile || process.env.SHOPAI_DATA_FILE || path.join(projectRoot, 'data', 'shopai.json')
  const uploadsDir = options.uploadsDir || path.join(projectRoot, 'uploads')

  const normalizeDatabase = (value) => {
    const normalized = value && typeof value === 'object' ? value : emptyDatabase()
    for (const key of Object.keys(emptyDatabase())) {
      if (!Array.isArray(normalized[key])) normalized[key] = []
    }
    return normalized
  }

  let db
  let persistenceRevision = 0
  if (persistence) {
    const stored = await persistence.load()
    db = normalizeDatabase(stored?.data)
    persistenceRevision = Number.isInteger(stored?.revision) ? stored.revision : 0
  } else {
    await fs.mkdir(path.dirname(dataFile), { recursive: true })
    if (!uploadStorage) await fs.mkdir(uploadsDir, { recursive: true })
    try {
      db = normalizeDatabase(JSON.parse(await fs.readFile(dataFile, 'utf8')))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      db = emptyDatabase()
      await fs.writeFile(dataFile, JSON.stringify(db, null, 2))
    }
  }

  let writeQueue = Promise.resolve()
  const persist = () => {
    const snapshot = JSON.stringify(db)
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      if (persistence) {
        const nextRevision = await persistence.save(snapshot, persistenceRevision)
        persistenceRevision = Number.isInteger(nextRevision) ? nextRevision : persistenceRevision + 1
        return
      }
      const temporaryFile = dataFile + '.tmp'
      await fs.writeFile(temporaryFile, snapshot, 'utf8')
      await fs.rename(temporaryFile, dataFile)
    })
    return writeQueue
  }

  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '8mb' }))

  // D1-backed requests are reloaded from durable storage and serialized per isolate.
  // The D1 revision check prevents silent overwrites across separate Worker isolates.
  if (persistence) {
    let requestQueue = Promise.resolve()
    app.use((req, res, next) => {
      const previousRequest = requestQueue
      let releaseRequest
      requestQueue = new Promise((resolve) => { releaseRequest = resolve })
      let released = false
      const finishRequest = () => {
        if (released) return
        released = true
        releaseRequest()
      }
      res.once('finish', finishRequest)
      res.once('close', finishRequest)
      previousRequest.then(async () => {
        try {
          const stored = await persistence.load()
          db = normalizeDatabase(stored?.data)
          persistenceRevision = Number.isInteger(stored?.revision) ? stored.revision : 0
          next()
        } catch (error) {
          finishRequest()
          next(error)
        }
      })
    })
  }

  if (uploadStorage) {
    app.get('/uploads/:filename', route(async (req, res) => {
      const filename = cleanText(req.params.filename, 80)
      if (!/^[a-f0-9]{36}\\.(png|jpg|webp)$/.test(filename)) return res.status(404).end()
      const file = await uploadStorage.get(filename)
      if (!file) return res.status(404).end()
      res.setHeader('Content-Type', file.contentType || 'application/octet-stream')
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.status(200).end(Buffer.from(file.data))
    }))
  } else {
    app.use('/uploads', express.static(uploadsDir, { fallthrough: false, maxAge: '1d' }))
  }

  const requireAuth = (req, res, next) => {
    const token = parseCookies(req.headers.cookie).shopai_session
    if (!token) return res.status(401).json({ error: 'Войдите в аккаунт, чтобы продолжить.' })
    const tokenHash = sha256(token)
    const session = db.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > Date.now())
    const user = session && db.users.find((item) => item.id === session.userId)
    if (!user) return res.status(401).json({ error: 'Сессия завершена. Войдите снова.' })
    req.user = user
    req.sessionHash = tokenHash
    next()
  }

  const getOwnedStore = (userId) => db.stores.find((store) => store.ownerId === userId)
  const requireStore = (req, res) => {
    const store = getOwnedStore(req.user.id)
    if (!store) {
      res.status(404).json({ error: 'Магазин не найден. Создайте магазин в настройках аккаунта.' })
      return null
    }
    return store
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'shopai-api' }))

  app.post('/api/auth/register', route(async (req, res) => {
    const name = cleanText(req.body.name, 100)
    const email = cleanText(req.body.email, 180).toLowerCase()
    const password = typeof req.body.password === 'string' ? req.body.password : ''
    const storeName = cleanText(req.body.storeName, 100) || 'Мой магазин'
    const category = cleanText(req.body.category, 80) || 'Товары'
    if (name.length < 2) return res.status(400).json({ error: 'Укажите имя не короче двух символов.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Укажите корректный email.' })
    if (password.length < 8) return res.status(400).json({ error: 'Пароль должен содержать не менее 8 символов.' })
    if (db.users.some((user) => user.email === email)) return res.status(409).json({ error: 'Аккаунт с таким email уже существует.' })

    const user = { id: makeId(), name, email, passwordHash: await passwordHash(password), createdAt: new Date().toISOString() }
    const store = {
      id: makeId(), ownerId: user.id, name: storeName, slug: uniqueSlug(storeName, db.stores),
      description: 'Официальная витрина магазина ' + storeName,
      category, primaryColor: '#6257d9', published: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    const token = crypto.randomBytes(32).toString('base64url')
    db.users.push(user)
    db.stores.push(store)
    db.sessions.push({ tokenHash: sha256(token), userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS })
    await persist()
    setSessionCookie(res, token, secureCookies)
    res.status(201).json({ user: safeUser(user), store })
  }))

  app.post('/api/auth/login', route(async (req, res) => {
    const email = cleanText(req.body.email, 180).toLowerCase()
    const password = typeof req.body.password === 'string' ? req.body.password : ''
    const user = db.users.find((item) => item.email === email)
    if (!user || !(await passwordMatches(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Неверный email или пароль.' })
    }
    const token = crypto.randomBytes(32).toString('base64url')
    db.sessions = db.sessions.filter((session) => session.userId !== user.id)
    db.sessions.push({ tokenHash: sha256(token), userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS })
    await persist()
    setSessionCookie(res, token, secureCookies)
    res.json({ user: safeUser(user), store: getOwnedStore(user.id) || null })
  }))

  app.post('/api/auth/logout', requireAuth, route(async (req, res) => {
    db.sessions = db.sessions.filter((session) => session.tokenHash !== req.sessionHash)
    await persist()
    clearSessionCookie(res, secureCookies)
    res.json({ success: true })
  }))

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: safeUser(req.user), store: getOwnedStore(req.user.id) || null })
  })

  app.get('/api/store', requireAuth, (req, res) => {
    const store = requireStore(req, res)
    if (store) res.json({ store })
  })

  app.patch('/api/store', requireAuth, route(async (req, res) => {
    const store = requireStore(req, res)
    if (!store) return
    if (req.body.published === true) {
      const hasPublishedProducts = db.products.some((product) => product.storeId === store.id && product.published && product.stock > 0)
      if (!hasPublishedProducts) return res.status(409).json({ error: 'Добавьте хотя бы один товар с положительным остатком и включённой публикацией, прежде чем публиковать магазин.' })
    }
    const name = cleanText(req.body.name, 100)
    if (name.length < 2) return res.status(400).json({ error: 'Название магазина должно содержать не менее двух символов.' })
    store.name = name
    store.description = cleanText(req.body.description, 500)
    store.category = cleanText(req.body.category, 80) || 'Товары'
    if (/^#[0-9a-fA-F]{6}$/.test(req.body.primaryColor || '')) store.primaryColor = req.body.primaryColor
    if (req.body.siteConfig) {
      const siteConfig = safeSiteConfig(req.body.siteConfig)
      if (!siteConfig?.heroTitle || !siteConfig?.heroSubtitle || !siteConfig?.aboutText) {
        return res.status(400).json({ error: 'Проверьте содержимое AI-сайта перед сохранением.' })
      }
      store.siteConfig = siteConfig
      store.primaryColor = siteConfig.primaryColor
      store.description = siteConfig.heroSubtitle
    }
    if (typeof req.body.published === 'boolean') store.published = req.body.published
    store.updatedAt = new Date().toISOString()
    await persist()
    res.json({ store })
  }))

  app.get('/api/products', requireAuth, (req, res) => {
    const store = requireStore(req, res)
    if (!store) return
    res.json({ products: db.products.filter((product) => product.storeId === store.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })
  })

  app.post('/api/products', requireAuth, route(async (req, res) => {
    const store = requireStore(req, res)
    if (!store) return
    const name = cleanText(req.body.name, 140)
    const price = Number(req.body.price)
    const stock = Number(req.body.stock)
    if (!name) return res.status(400).json({ error: 'Укажите название товара.' })
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Цена должна быть больше нуля.' })
    if (!Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: 'Остаток должен быть целым неотрицательным числом.' })
    const product = {
      id: makeId(), storeId: store.id, name, category: cleanText(req.body.category, 80) || 'Без категории',
      description: cleanText(req.body.description, 3000), seoTitle: cleanText(req.body.seoTitle, 180),
      price, stock, imageUrl: cleanText(req.body.imageUrl, 1000),
      published: req.body.published !== false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    db.products.push(product)
    await persist()
    res.status(201).json({ product })
  }))

  app.patch('/api/products/:id', requireAuth, route(async (req, res) => {
    const store = requireStore(req, res)
    if (!store) return
    const product = db.products.find((item) => item.id === req.params.id && item.storeId === store.id)
    if (!product) return res.status(404).json({ error: 'Товар не найден.' })
    const name = cleanText(req.body.name, 140)
    const price = Number(req.body.price)
    const stock = Number(req.body.stock)
    if (!name) return res.status(400).json({ error: 'Укажите название товара.' })
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Цена должна быть больше нуля.' })
    if (!Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: 'Остаток должен быть целым неотрицательным числом.' })
    Object.assign(product, {
      name, category: cleanText(req.body.category, 80) || 'Без категории',
      description: cleanText(req.body.description, 3000), seoTitle: cleanText(req.body.seoTitle, 180),
      price, stock, imageUrl: cleanText(req.body.imageUrl, 1000),
      published: req.body.published !== false, updatedAt: new Date().toISOString(),
    })
    await persist()
    res.json({ product })
  }))

  app.delete('/api/products/:id', requireAuth, route(async (req, res) => {
    const store = requireStore(req, res)
    if (!store) return
    const product = db.products.find((item) => item.id === req.params.id && item.storeId === store.id)
    if (!product) return res.status(404).json({ error: 'Товар не найден.' })
    if (db.orders.some((order) => order.storeId === store.id && order.items.some((item) => item.productId === product.id) && order.status !== 'Отменён')) {
      return res.status(409).json({ error: 'Нельзя удалить товар, который входит в действующий заказ. Сначала скройте его с витрины.' })
    }
    db.products = db.products.filter((item) => item.id !== product.id)
    await persist()
    res.json({ success: true })
  }))

  app.post('/api/uploads', requireAuth, route(async (req, res) => {
    const dataUrl = typeof req.body.dataUrl === 'string' ? req.body.dataUrl : ''
    const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/)
    if (!match) return res.status(400).json({ error: 'Поддерживаются изображения PNG, JPEG и WebP.' })
    const buffer = Buffer.from(match[2], 'base64')
    if (!buffer.length || buffer.length > IMAGE_LIMIT_BYTES) return res.status(413).json({ error: 'Размер изображения должен быть не более 4 МБ.' })
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
    const filename = crypto.randomBytes(18).toString('hex') + '.' + extension
    if (uploadStorage) {
      const contentType = match[1] === 'jpeg' ? 'image/jpeg' : 'image/' + match[1]
      await uploadStorage.put(filename, buffer, contentType)
    } else {
      await fs.writeFile(path.join(uploadsDir, filename), buffer, { flag: 'wx' })
    }
    res.status(201).json({ imageUrl: '/uploads/' + filename })
  }))

  app.post('/api/ai/product-copy', requireAuth, route(async (req, res) => {
    const name = cleanText(req.body.name, 140)
    const category = cleanText(req.body.category, 80)
    const details = cleanText(req.body.details, 1200)
    const tone = cleanText(req.body.tone, 40) || 'Дружелюбный'
    if (!name || !details) return res.status(400).json({ error: 'Укажите название и характеристики товара.' })

    const apiConfigured = Boolean(runtimeConfig.CLOUDFLARE_ACCOUNT_ID && runtimeConfig.CLOUDFLARE_API_TOKEN)
    if (!apiConfigured) {
      return res.json({ ...makeDemoCopy({ name, category, details, tone }), message: 'Демонстрационный режим. Для реальной генерации добавьте CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN в .env.' })
    }

    const prompt = [
      'Ты помощник владельца интернет-магазина. Подготовь карточку товара на русском языке.',
      'Используй только факты из исходных данных. Не выдумывай материалы, размеры, гарантию, сертификаты, страну производства и свойства.',
      'Стиль: ' + tone + '. Категория: ' + category + '. Название: ' + name + '. Характеристики: ' + details + '.',
      'Верни только JSON с двумя строковыми полями: description и seoTitle.',
    ].join('\n')
    try {
      const result = await generateCloudflareJson(prompt, 900, runtimeConfig)
      const description = cleanText(result.data.description, 3000)
      const seoTitle = cleanText(result.data.seoTitle, 180)
      if (!description || !seoTitle) return res.status(502).json({ error: 'Cloudflare Workers AI не вернул описание и SEO-заголовок.' })
      res.json({ description, seoTitle, provider: 'live', model: result.model })
    } catch (error) {
      if (error.message === 'CLOUDFLARE_RATE_LIMIT') return res.status(429).json({ error: 'Дневная квота Cloudflare Workers AI временно исчерпана. Попробуйте позже.' })
      if (error.message === 'CLOUDFLARE_AUTH_ERROR') return res.status(502).json({ error: 'Cloudflare отклонил токен или не хватает разрешений. Проверьте Account ID и Workers AI API Token.' })
      if (error.message === 'CLOUDFLARE_MODEL_UNAVAILABLE') return res.status(503).json({ error: 'Модель Cloudflare недоступна или удалена. Обновите CLOUDFLARE_AI_MODEL в .env.' })
      if (error.message === 'CLOUDFLARE_EMPTY_RESPONSE' || error.message === 'CLOUDFLARE_INVALID_JSON') return res.status(502).json({ error: 'Cloudflare вернул пустой или некорректный ответ. Попробуйте ещё раз.' })
      console.error('Cloudflare product copy failed:', error.message)
      return res.status(502).json({ error: 'Cloudflare Workers AI временно не смог создать описание. Подробности смотрите в терминале.' })
    }
  }))


  app.post('/api/ai/storefront', requireAuth, route(async (req, res) => {
    const store = requireStore(req, res)
    if (!store) return
    const brief = {
      storeName: cleanText(req.body.storeName, 100) || store.name,
      niche: cleanText(req.body.niche, 100) || store.category,
      audience: cleanText(req.body.audience, 240),
      products: cleanText(req.body.products, 1000),
      advantage: cleanText(req.body.advantage, 320),
      style: ['minimal', 'editorial', 'bold'].includes(req.body.style) ? req.body.style : 'minimal',
      palette: Object.hasOwn(SITE_PALETTES, req.body.palette) ? req.body.palette : 'violet',
      tone: ['friendly', 'premium', 'expert'].includes(req.body.tone) ? req.body.tone : 'friendly',
      language: req.body.language === 'en' ? 'English' : 'Russian',
    }
    if (!brief.products) return res.status(400).json({ error: 'Опишите товары, которые будет продавать магазин.' })
    const apiConfigured = Boolean(runtimeConfig.CLOUDFLARE_ACCOUNT_ID && runtimeConfig.CLOUDFLARE_API_TOKEN)
    if (!apiConfigured) {
      return res.status(503).json({ error: 'Cloudflare Workers AI не подключён. Добавьте CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN в файл .env и перезапустите сервер.' })
    }
    const palette = SITE_PALETTES[brief.palette]
    const prompt = [
      'You are a senior ecommerce conversion copywriter and UX designer.',
      'Create copy and a compact design specification for a real small online-store landing page.',
      'Return ONLY valid JSON. No markdown fences, no comments.',
      'Never invent certifications, guarantees, delivery promises, years in business, reviews, discounts, addresses, contacts or product specifications.',
      'Use only facts in the brief. If information is missing, write neutral copy without making claims.',
      'Keep hero title concise (3-9 words), subtitle one or two sentences, about text 2-4 sentences.',
      'features must contain 3 short, factual value propositions derived from the brief, not fabricated service promises.',
      'Do not change the selected palette or layout.',
      'Return one JSON object with exactly these keys: heroTitle, heroSubtitle, aboutTitle, aboutText, ctaLabel, productIntro, metaTitle, metaDescription, features.',
      'All first eight values must be natural, publication-ready copy in the requested language. features must be an array of exactly 3 concise benefit statements.',
      'Never output the literal words string, text, title, description, placeholder, TODO, or schema as a field value. These are not valid copy.',
      'Write copy specifically for this store and the supplied niche, products, audience, differentiator, tone and style. Avoid generic filler.',
      'Language: ' + brief.language,
      'Store name: ' + brief.storeName,
      'Niche: ' + brief.niche,
      'Target audience: ' + (brief.audience || 'not specified'),
      'Products: ' + brief.products,
      'Differentiator: ' + (brief.advantage || 'not specified'),
      'Tone: ' + brief.tone,
      'Visual layout: ' + brief.style,
      'Palette: ' + brief.palette + ' (' + palette.primary + ')',
      'Create landing-page copy and SEO fields. Avoid generic filler.',
    ].join('\n')
    try {
      const result = await generateCloudflareJson(prompt, 2200, runtimeConfig)
      const config = safeSiteConfig({ ...result.data, palette: brief.palette, designStyle: brief.style })
      if (!hasUsableSiteCopy(config)) {
        console.warn('Cloudflare storefront generation returned placeholder or incomplete copy')
        return res.status(502).json({ error: 'AI вернул шаблонные или неполные тексты. Нажмите «Сгенерировать сайт» ещё раз — пустой шаблон не будет сохранён.' })
      }
      res.json({ siteConfig: config, provider: 'cloudflare-workers-ai', model: result.model })
    } catch (error) {
      if (error.message === 'CLOUDFLARE_RATE_LIMIT') return res.status(429).json({ error: 'Дневная квота Cloudflare Workers AI временно исчерпана. Попробуйте позже.' })
      if (error.message === 'CLOUDFLARE_AUTH_ERROR') return res.status(502).json({ error: 'Cloudflare отклонил токен или не хватает разрешений. Проверьте Account ID и Workers AI API Token.' })
      if (error.message === 'CLOUDFLARE_MODEL_UNAVAILABLE') return res.status(503).json({ error: 'Модель Cloudflare недоступна или удалена. Обновите CLOUDFLARE_AI_MODEL в .env.' })
      if (error.message === 'CLOUDFLARE_EMPTY_RESPONSE' || error.message === 'CLOUDFLARE_INVALID_JSON') return res.status(502).json({ error: 'Cloudflare вернул пустой или некорректный ответ. Попробуйте ещё раз.' })
      console.error('Cloudflare storefront generation failed:', error.message)
      return res.status(502).json({ error: 'Cloudflare Workers AI не смог создать сайт. Подробности смотрите в терминале.' })
    }
  }))

  app.get('/api/orders', requireAuth, (req, res) => {
    const store = requireStore(req, res)
    if (!store) return
    res.json({ orders: db.orders.filter((order) => order.storeId === store.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })
  })

  app.patch('/api/orders/:id', requireAuth, route(async (req, res) => {
    const store = requireStore(req, res)
    if (!store) return
    const order = db.orders.find((item) => item.id === req.params.id && item.storeId === store.id)
    if (!order) return res.status(404).json({ error: 'Заказ не найден.' })
    const status = cleanText(req.body.status, 30)
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Недопустимый статус заказа.' })
    if (order.status === 'Отменён' && status !== 'Отменён') return res.status(409).json({ error: 'Отменённый заказ нельзя вернуть в работу.' })
    if (status === 'Отменён' && order.status !== 'Отменён') {
      for (const item of order.items) {
        const product = db.products.find((entry) => entry.id === item.productId && entry.storeId === store.id)
        if (product) product.stock += item.quantity
      }
    }
    order.status = status
    order.updatedAt = new Date().toISOString()
    await persist()
    res.json({ order })
  }))

  app.get('/api/dashboard', requireAuth, (req, res) => {
    const store = requireStore(req, res)
    if (!store) return
    const products = db.products.filter((product) => product.storeId === store.id)
    const orders = db.orders.filter((order) => order.storeId === store.id)
    const activeOrders = orders.filter((order) => order.status !== 'Отменён')
    res.json({
      productCount: products.length,
      publishedProductCount: products.filter((product) => product.published).length,
      orderCount: orders.length,
      newOrderCount: orders.filter((order) => order.status === 'Новый').length,
      revenue: activeOrders.reduce((sum, order) => sum + order.total, 0),
      recentOrders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    })
  })

  app.get('/api/public/:slug', (req, res) => {
    const store = db.stores.find((item) => item.slug === req.params.slug && item.published)
    if (!store) return res.status(404).json({ error: 'Магазин не найден или ещё не опубликован.' })
    const products = db.products.filter((product) => product.storeId === store.id && product.published && product.stock > 0)
    res.json(publicStore(store, products))
  })

  app.post('/api/public/:slug/orders', route(async (req, res) => {
    const store = db.stores.find((item) => item.slug === req.params.slug && item.published)
    if (!store) return res.status(404).json({ error: 'Магазин не найден или ещё не опубликован.' })
    const customerName = cleanText(req.body.customerName, 120)
    const email = cleanText(req.body.email, 180).toLowerCase()
    const phone = cleanText(req.body.phone, 50)
    const address = cleanText(req.body.address, 300)
    const comment = cleanText(req.body.comment, 500)
    if (customerName.length < 2) return res.status(400).json({ error: 'Укажите имя покупателя.' })
    if (!email && !phone) return res.status(400).json({ error: 'Укажите email или номер телефона для связи.' })
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Проверьте email.' })
    if (!Array.isArray(req.body.items) || !req.body.items.length || req.body.items.length > 30) return res.status(400).json({ error: 'Корзина пуста или содержит слишком много позиций.' })

    const requestedQuantities = new Map()
    for (const requested of req.body.items) {
      const product = db.products.find((item) => item.id === requested.productId && item.storeId === store.id && item.published)
      const quantity = Number(requested.quantity)
      if (!product || !Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ error: 'Один из товаров недоступен.' })
      requestedQuantities.set(product.id, (requestedQuantities.get(product.id) || 0) + quantity)
    }

    const items = []
    for (const [productId, quantity] of requestedQuantities) {
      const product = db.products.find((item) => item.id === productId && item.storeId === store.id)
      if (!product || product.stock < quantity) return res.status(409).json({ error: 'Недостаточно товара «' + (product?.name || 'из корзины') + '» в наличии.' })
      items.push({ productId: product.id, name: product.name, price: product.price, quantity })
    }
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    for (const item of items) {
      const product = db.products.find((entry) => entry.id === item.productId)
      product.stock -= item.quantity
      product.updatedAt = new Date().toISOString()
    }
    const order = {
      id: 'SAI-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
      storeId: store.id, customerName, email, phone, address, comment, items, total,
      status: 'Новый', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    db.orders.push(order)
    await persist()
    res.status(201).json({ order: { id: order.id, total: order.total, status: order.status } })
  }))

  if (!options.assetsServedExternally) {
    const distDir = path.join(projectRoot, 'dist')
    try {
      await fs.access(distDir)
      app.use(express.static(distDir))
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next()
        res.sendFile(path.join(distDir, 'index.html'))
      })
    } catch {
      // In development Vite serves the frontend and proxies /api and /uploads to this server.
    }
  }

  app.use((error, _req, res, _next) => {
    console.error(error)
    if (res.headersSent) return
    if (error.message === 'DB_WRITE_CONFLICT') {
      return res.status(409).json({ error: 'Данные магазина одновременно изменились в другом запросе. Обновите страницу и повторите действие.' })
    }
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({ error: 'Превышено время ожидания внешнего сервиса.' })
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера.' })
  })

  return app
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT) || 3001
  createApp().then((app) => {
    app.listen(port, '0.0.0.0', () => console.log('ShopAI API listening on http://localhost:' + port))
  }).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
