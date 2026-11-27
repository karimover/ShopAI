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

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', 'shopai_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000) + secure)
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
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
      primaryColor: store.primaryColor,
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
  const dataFile = options.dataFile || process.env.SHOPAI_DATA_FILE || path.join(projectRoot, 'data', 'shopai.json')
  const uploadsDir = options.uploadsDir || path.join(projectRoot, 'uploads')
  await fs.mkdir(path.dirname(dataFile), { recursive: true })
  await fs.mkdir(uploadsDir, { recursive: true })

  let db
  try {
    db = JSON.parse(await fs.readFile(dataFile, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    db = emptyDatabase()
    await fs.writeFile(dataFile, JSON.stringify(db, null, 2))
  }
  for (const key of Object.keys(emptyDatabase())) {
    if (!Array.isArray(db[key])) db[key] = []
  }

  let writeQueue = Promise.resolve()
  const persist = () => {
    const snapshot = JSON.stringify(db, null, 2)
    writeQueue = writeQueue.then(async () => {
      const temporaryFile = dataFile + '.tmp'
      await fs.writeFile(temporaryFile, snapshot, 'utf8')
      await fs.rename(temporaryFile, dataFile)
    })
    return writeQueue
  }

  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '8mb' }))
  app.use('/uploads', express.static(uploadsDir, { fallthrough: false, maxAge: '1d' }))

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
    setSessionCookie(res, token)
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
    setSessionCookie(res, token)
    res.json({ user: safeUser(user), store: getOwnedStore(user.id) || null })
  }))

  app.post('/api/auth/logout', requireAuth, route(async (req, res) => {
    db.sessions = db.sessions.filter((session) => session.tokenHash !== req.sessionHash)
    await persist()
    clearSessionCookie(res)
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
    await fs.writeFile(path.join(uploadsDir, filename), buffer, { flag: 'wx' })
    res.status(201).json({ imageUrl: '/uploads/' + filename })
  }))

  app.post('/api/ai/product-copy', requireAuth, route(async (req, res) => {
    const name = cleanText(req.body.name, 140)
    const category = cleanText(req.body.category, 80)
    const details = cleanText(req.body.details, 1200)
    const tone = cleanText(req.body.tone, 40) || 'Дружелюбный'
    if (!name || !details) return res.status(400).json({ error: 'Укажите название и характеристики товара.' })

    const apiKey = process.env.SHOPAI_AI_API_KEY
    const apiUrl = process.env.SHOPAI_AI_API_URL
    const model = process.env.SHOPAI_AI_MODEL
    if (!apiKey || !apiUrl || !model) {
      return res.json({ ...makeDemoCopy({ name, category, details, tone }), message: 'Демонстрационный режим. Для реальной генерации настройте серверные переменные SHOPAI_AI_API_KEY, SHOPAI_AI_API_URL и SHOPAI_AI_MODEL.' })
    }

    const prompt = [
      'Ты помощник владельца интернет-магазина. Подготовь карточку товара на русском языке.',
      'Используй только факты из исходных данных. Не выдумывай материалы, размеры, гарантию, сертификаты, страну производства и свойства.',
      'Стиль: ' + tone + '. Категория: ' + category + '. Название: ' + name + '. Характеристики: ' + details + '.',
      'Верни только JSON с двумя строковыми полями: description и seoTitle.',
    ].join('\n')
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, temperature: 0.4, messages: [{ role: 'system', content: 'Отвечай строго JSON без Markdown.' }, { role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error('AI provider error:', response.status, detail.slice(0, 300))
      return res.status(502).json({ error: 'Сервис генерации временно недоступен. Проверьте настройки AI-провайдера и попробуйте позже.' })
    }
    const payload = await response.json()
    const raw = payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content
    if (typeof raw !== 'string') return res.status(502).json({ error: 'AI-провайдер вернул ответ в неподдерживаемом формате.' })
    let parsed
    try {
      parsed = JSON.parse(raw.replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, ''))
    } catch {
      return res.status(502).json({ error: 'Не удалось разобрать ответ AI. Попробуйте повторить запрос.' })
    }
    const description = cleanText(parsed.description, 3000)
    const seoTitle = cleanText(parsed.seoTitle, 180)
    if (!description || !seoTitle) return res.status(502).json({ error: 'AI-провайдер не вернул описание и SEO-заголовок.' })
    res.json({ description, seoTitle, provider: 'live' })
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

  const distDir = path.join(projectRoot, 'dist')
  try {
    await fs.access(distDir)
    app.use(express.static(distDir))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next()
      res.sendFile(path.join(distDir, 'index.html'))
    })
  } catch {
    // In development Vite serves the frontend and proxies /api and /uploads to this server.
  }

  app.use((error, _req, res, _next) => {
    console.error(error)
    if (res.headersSent) return
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
