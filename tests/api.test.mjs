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
    const registration = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Owner', email: 'owner@example.com', password: 'password-123', storeName: 'Demo Shop', category: 'Home' }),
    })
    assert.equal(registration.response.status, 201)
    assert.ok(cookie)
    const slug = registration.body.store.slug

    const productResponse = await request('/api/products', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ceramic vase', category: 'Decor', price: 1200, stock: 5, description: 'Handmade ceramic vase', seoTitle: 'Ceramic vase' }),
    })
    assert.equal(productResponse.response.status, 201)
    const productId = productResponse.body.product.id

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
