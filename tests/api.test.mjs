import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../server/index.mjs'

test('complete MVP journey: register, create product, publish store and receive order', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shopai-test-'))
  const app = await createApp({ dataFile: path.join(directory, 'db.json'), uploadsDir: path.join(directory, 'uploads') })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const baseUrl = 'http://127.0.0.1:' + server.address().port
  let cookie = ''

  const request = async (url, options = {}) => {
    const response = await fetch(baseUrl + url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) },
    })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    const body = await response.json()
    return { response, body }
  }

  try {
    const anonymousAi = await request('/api/ai/storefront', {
      method: 'POST',
      body: JSON.stringify({ products: 'Керамические вазы' }),
    })
    assert.equal(anonymousAi.response.status, 401)

    const registration = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Owner', email: 'owner@example.com', password: 'password-123', storeName: 'Demo Shop', category: 'Home' }),
    })
    assert.equal(registration.response.status, 201)
    assert.ok(cookie)
    const slug = registration.body.store.slug

    const emptyPublish = await request('/api/store', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Demo Shop', description: 'A test shop', category: 'Home', published: true }),
    })
    assert.equal(emptyPublish.response.status, 409)

    const productResponse = await request('/api/products', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ceramic vase', category: 'Decor', price: 1200, stock: 5, description: 'Handmade ceramic vase', seoTitle: 'Ceramic vase' }),
    })
    assert.equal(productResponse.response.status, 201)
    const productId = productResponse.body.product.id

    const siteConfig = {
      heroTitle: 'Керамика для уютного дома',
      heroSubtitle: 'Предметы ручной работы для повседневных ритуалов.',
      aboutTitle: 'Небольшая мастерская',
      aboutText: 'Создаём керамические предметы для дома.',
      ctaLabel: 'Смотреть коллекцию',
      productIntro: 'Выберите свою вещь',
      metaTitle: 'Demo Shop — керамика',
      metaDescription: 'Керамические предметы для дома.',
      features: ['Ручная работа', 'Небольшие серии'],
      palette: 'forest',
      designStyle: 'editorial',
    }
    const saveSite = await request('/api/store', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Demo Shop', description: siteConfig.heroSubtitle, category: 'Home', siteConfig }),
    })
    assert.equal(saveSite.response.status, 200)
    assert.equal(saveSite.body.store.siteConfig.primaryColor, '#315f4b')

    const generated = await request('/api/ai/product-copy', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ceramic vase', category: 'Decor', details: 'Handmade ceramic vase', tone: 'Friendly' }),
    })
    assert.equal(generated.response.status, 200)
    assert.equal(generated.body.provider, 'demo')
    assert.ok(generated.body.description.length > 10)

    const publish = await request('/api/store', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Demo Shop', description: 'A test shop', category: 'Home', published: true }),
    })
    assert.equal(publish.response.status, 200)

    const storefront = await request('/api/public/' + slug)
    assert.equal(storefront.response.status, 200)
    assert.equal(storefront.body.products.length, 1)
    assert.equal(storefront.body.products[0].id, productId)
    assert.equal(storefront.body.store.siteConfig.heroTitle, 'Керамика для уютного дома')
    assert.equal(storefront.body.store.siteConfig.aboutTitle, 'Небольшая мастерская')
    assert.equal(storefront.body.store.siteConfig.designStyle, 'editorial')
    assert.deepEqual(storefront.body.store.siteConfig.features, ['Ручная работа', 'Небольшие серии'])

    const orderResponse = await request('/api/public/' + slug + '/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Test Customer', email: 'customer@example.com', phone: '',
        address: 'Test street 1', items: [{ productId, quantity: 2 }],
      }),
    })
    assert.equal(orderResponse.response.status, 201)
    assert.equal(orderResponse.body.order.status, 'Новый')

    const orders = await request('/api/orders')
    assert.equal(orders.body.orders.length, 1)
    assert.equal(orders.body.orders[0].total, 2400)

    const products = await request('/api/products')
    assert.equal(products.body.products[0].stock, 3)

    const duplicateOverstock = await request('/api/public/' + slug + '/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Another Customer', email: 'another@example.com', phone: '',
        items: [{ productId, quantity: 2 }, { productId, quantity: 2 }],
      }),
    })
    assert.equal(duplicateOverstock.response.status, 409)

    const statusUpdate = await request('/api/orders/' + orders.body.orders[0].id, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Отменён' }),
    })
    assert.equal(statusUpdate.response.status, 200)

    const restoredProducts = await request('/api/products')
    assert.equal(restoredProducts.body.products[0].stock, 5)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('private endpoints reject requests without a session', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shopai-auth-test-'))
  const app = await createApp({ dataFile: path.join(directory, 'db.json'), uploadsDir: path.join(directory, 'uploads') })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/products')
    assert.equal(response.status, 401)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  }
})


test('AI storefront rejects literal schema placeholders instead of treating them as generated copy', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shopai-ai-placeholder-test-'))
  const app = await createApp({ dataFile: path.join(directory, 'db.json'), uploadsDir: path.join(directory, 'uploads') })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const baseUrl = 'http://127.0.0.1:' + server.address().port
  let cookie = ''
  const originalFetch = globalThis.fetch
  const originalAccount = process.env.CLOUDFLARE_ACCOUNT_ID
  const originalToken = process.env.CLOUDFLARE_API_TOKEN
  const originalModel = process.env.CLOUDFLARE_AI_MODEL

  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account'
  process.env.CLOUDFLARE_API_TOKEN = 'test-token'
  process.env.CLOUDFLARE_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it'
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('api.cloudflare.com')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              heroTitle: 'string',
              heroSubtitle: 'string',
              aboutTitle: 'string',
              aboutText: 'string',
              ctaLabel: 'string',
              productIntro: 'string',
              metaTitle: 'string',
              metaDescription: 'string',
              features: ['string', 'string', 'string'],
            }),
          },
          finish_reason: 'stop',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return originalFetch(url, options)
  }

  try {
    const request = async (url, options = {}) => {
      const response = await originalFetch(baseUrl + url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) },
      })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      return { response, body: await response.json() }
    }

    const registration = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'AI Test Owner', email: 'ai-owner@example.com', password: 'password-123', storeName: 'AI Test Shop', category: 'Decor' }),
    })
    assert.equal(registration.response.status, 201)

    const generation = await request('/api/ai/storefront', {
      method: 'POST',
      body: JSON.stringify({ products: 'Керамические вазы', storeName: 'AI Test Shop', niche: 'Декор' }),
    })
    assert.equal(generation.response.status, 502)
    assert.match(generation.body.error, /шаблонные или неполные тексты/i)
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries({
      CLOUDFLARE_ACCOUNT_ID: originalAccount,
      CLOUDFLARE_API_TOKEN: originalToken,
      CLOUDFLARE_AI_MODEL: originalModel,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})


test('external persistence adapter keeps accounts across app instances', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shopai-persistence-test-'))
  const state = {
    data: { users: [], sessions: [], stores: [], products: [], orders: [] },
    revision: 0,
  }
  const persistence = {
    async load() {
      return structuredClone(state)
    },
    async save(payload, expectedRevision) {
      if (expectedRevision !== state.revision) throw new Error('DB_WRITE_CONFLICT')
      state.data = JSON.parse(payload)
      state.revision += 1
      return state.revision
    },
  }

  const start = async () => {
    const app = await createApp({
      persistence,
      uploadsDir: path.join(directory, 'uploads'),
      assetsServedExternally: true,
    })
    const server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    return { server, baseUrl: 'http://127.0.0.1:' + server.address().port }
  }

  let first
  let second
  try {
    first = await start()
    const registration = await fetch(first.baseUrl + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Persistent Owner',
        email: 'persistent@example.com',
        password: 'password-123',
        storeName: 'Persistent Shop',
        category: 'Decor',
      }),
    })
    assert.equal(registration.status, 201)
    const cookie = registration.headers.get('set-cookie').split(';')[0]
    assert.equal(state.revision, 1)

    await new Promise((resolve) => first.server.close(resolve))
    first = null

    second = await start()
    const me = await fetch(second.baseUrl + '/api/me', {
      headers: { Cookie: cookie },
    })
    assert.equal(me.status, 200)
    const payload = await me.json()
    assert.equal(payload.user.email, 'persistent@example.com')
    assert.equal(payload.store.name, 'Persistent Shop')
  } finally {
    if (first?.server) await new Promise((resolve) => first.server.close(resolve))
    if (second?.server) await new Promise((resolve) => second.server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
