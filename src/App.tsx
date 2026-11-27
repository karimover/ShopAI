import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight, ArrowUpRight, BadgeCheck, Check, ChevronDown, CircleAlert, ExternalLink,
  ImagePlus, LayoutDashboard, LogOut, Package, Pencil, Plus, Search, Settings,
  ShoppingBag, ShoppingCart, Sparkles, Store, Trash2, Upload, WandSparkles, X,
} from 'lucide-react'

type View = 'overview' | 'products' | 'orders' | 'settings'
type User = { id: string; name: string; email: string }
type StoreData = {
  id: string; name: string; slug: string; description: string; category: string;
  primaryColor: string; published: boolean
}
type Product = {
  id: string; storeId: string; name: string; category: string; description: string;
  seoTitle: string; price: number; stock: number; imageUrl: string; published: boolean;
  createdAt: string; updatedAt: string
}
type PublicProduct = Pick<Product, 'id' | 'name' | 'category' | 'description' | 'seoTitle' | 'price' | 'stock' | 'imageUrl'>
type PublicStoreData = Pick<StoreData, 'id' | 'name' | 'slug' | 'description' | 'category' | 'primaryColor'>
type ProductDraft = Pick<Product, 'name' | 'category' | 'description' | 'seoTitle' | 'price' | 'stock' | 'imageUrl' | 'published'>
type OrderItem = { productId: string; name: string; price: number; quantity: number }
type Order = {
  id: string; customerName: string; email: string; phone: string; address: string;
  comment: string; items: OrderItem[]; total: number; status: string; createdAt: string
}
type ApiError = { error?: string }
type AuthResult = { user: User; store: StoreData | null }

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((payload as ApiError).error || 'Не удалось выполнить запрос.')
  return payload as T
}

const money = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽'
const dateTime = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const statusClass = (status: string) => status === 'Выполнен' ? 'done' : status === 'Отменён' ? 'cancelled' : status === 'В работе' ? 'progress' : 'new'
const emptyDraft: ProductDraft = { name: '', category: 'Одежда', description: '', seoTitle: '', price: 0, stock: 1, imageUrl: '', published: true }

export default function App() {
  const match = window.location.pathname.match(/^\/shop\/([^/]+)/)
  if (match) return <PublicStore slug={decodeURIComponent(match[1])} />
  return <DashboardApp />
}

function DashboardApp() {
  const [user, setUser] = useState<User | null>(null)
  const [store, setStore] = useState<StoreData | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [view, setView] = useState<View>('overview')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [query, setQuery] = useState('')

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }

  const loadWorkspace = async () => {
    const [storeResult, productResult, orderResult] = await Promise.all([
      api<{ store: StoreData }>('/api/store'),
      api<{ products: Product[] }>('/api/products'),
      api<{ orders: Order[] }>('/api/orders'),
    ])
    setStore(storeResult.store)
    setProducts(productResult.products)
    setOrders(orderResult.orders)
  }

  useEffect(() => {
    api<AuthResult>('/api/me').then(async (result) => {
      setUser(result.user)
      if (result.store) await loadWorkspace()
    }).catch(() => {
      setUser(null)
    }).finally(() => setLoading(false))
  }, [])

  const handleAuthenticated = async (result: AuthResult) => {
    setUser(result.user)
    if (result.store) {
      await loadWorkspace()
    } else {
      notify('Аккаунт создан, но магазин не найден.')
    }
  }

  const refresh = async () => {
    await loadWorkspace()
  }

  const filteredProducts = useMemo(() => products.filter((product) =>
    (product.name + ' ' + product.category + ' ' + product.seoTitle).toLowerCase().includes(query.toLowerCase())
  ), [products, query])

  const saveProduct = async (draft: ProductDraft) => {
    setBusy(true)
    try {
      if (editing) {
        await api('/api/products/' + editing.id, { method: 'PATCH', body: JSON.stringify(draft) })
        notify('Изменения товара сохранены')
      } else {
        await api('/api/products', { method: 'POST', body: JSON.stringify(draft) })
        notify('Товар добавлен в каталог')
      }
      setModalOpen(false)
      setEditing(null)
      await refresh()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось сохранить товар.')
    } finally {
      setBusy(false)
    }
  }

  const deleteProduct = async (product: Product) => {
    if (!window.confirm('Удалить товар «' + product.name + '»?')) return
    try {
      await api('/api/products/' + product.id, { method: 'DELETE' })
      notify('Товар удалён')
      await refresh()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось удалить товар.')
    }
  }

  const updateOrder = async (orderId: string, status: string) => {
    try {
      await api('/api/orders/' + orderId, { method: 'PATCH', body: JSON.stringify({ status }) })
      notify('Статус заказа обновлён')
      await refresh()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось обновить заказ.')
    }
  }

  const updateStore = async (patch: Partial<StoreData>) => {
    if (!store) return
    setBusy(true)
    try {
      const result = await api<{ store: StoreData }>('/api/store', {
        method: 'PATCH',
        body: JSON.stringify({ ...store, ...patch }),
      })
      setStore(result.store)
      notify(result.store.published ? 'Магазин опубликован' : 'Настройки сохранены')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось сохранить настройки.')
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* Session may already be expired. */ }
    setUser(null)
    setStore(null)
    setProducts([])
    setOrders([])
  }

  if (loading) return <div className="screen-loader"><div className="loader-mark">s.</div><span>Загружаем ShopAI</span></div>
  if (!user) return <AuthScreen onAuthenticated={handleAuthenticated} />
  if (!store) return <div className="screen-loader">Не удалось загрузить магазин. Обновите страницу.</div>

  const publicUrl = window.location.origin + '/shop/' + store.slug
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="ShopAI">
          <span className="brand-mark">s.</span><span>shop<span>ai</span></span><i>WORKSPACE</i>
        </a>
        <div className="workspace-card">
          <div className="workspace-avatar">{store.name.slice(0, 1).toUpperCase()}</div>
          <div className="workspace-name"><small>Ваш магазин</small><strong>{store.name}</strong></div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav className="side-nav">
          <NavButton active={view === 'overview'} onClick={() => setView('overview')} icon={<LayoutDashboard size={18} />}>Создание магазина</NavButton>
          <NavButton active={view === 'products'} onClick={() => setView('products')} icon={<Package size={18} />}>Товары <span className="nav-count">{products.length}</span></NavButton>
          <NavButton active={view === 'orders'} onClick={() => setView('orders')} icon={<ShoppingBag size={18} />}>Заказы {orders.filter((order) => order.status === 'Новый').length > 0 ? <span className="nav-count accent">{orders.filter((order) => order.status === 'Новый').length}</span> : null}</NavButton>
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={<Settings size={18} />}>Настройки магазина</NavButton>
        </nav>
        <div className="sidebar-bottom">
          <div className="ai-note"><Sparkles size={16} /><div><strong>AI-помощник</strong><span>Подготовка контента для товаров</span></div></div>
          <div className="profile-row"><div className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</div><div className="profile-text"><strong>{user.name}</strong><span>{user.email}</span></div><button className="icon-button subtle" onClick={logout} title="Выйти"><LogOut size={16} /></button></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>ShopAI</span><span className="crumb-divider">/</span><strong>{view === 'overview' ? 'Создание магазина' : view === 'products' ? 'Товары' : view === 'orders' ? 'Заказы' : 'Настройки'}</strong></div>
          <div className="topbar-actions">
            <span className={'store-state ' + (store.published ? 'is-live' : '')}><i />{store.published ? 'Магазин опубликован' : 'Черновик'}</span>
            {store.published && <a className="button button-light button-small" href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Открыть витрину</a>}
          </div>
        </header>

        <div className="content-wrap">
          {view === 'overview' && <Overview store={store} products={products} onAdd={() => { setEditing(null); setModalOpen(true) }} onEdit={(product) => { setEditing(product); setModalOpen(true) }} onViewProducts={() => setView('products')} onViewSettings={() => setView('settings')} />}
          {view === 'products' && <ProductsView products={filteredProducts} query={query} setQuery={setQuery} onAdd={() => { setEditing(null); setModalOpen(true) }} onEdit={(product) => { setEditing(product); setModalOpen(true) }} onDelete={deleteProduct} />}
          {view === 'orders' && <OrdersView orders={orders} onChangeStatus={updateOrder} />}
          {view === 'settings' && <SettingsView store={store} busy={busy} onSave={updateStore} onPublish={() => updateStore({ published: !store.published })} />}
        </div>
      </main>

      {modalOpen && <ProductModal product={editing} busy={busy} onClose={() => { setModalOpen(false); setEditing(null) }} onSave={saveProduct} />}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>
  )
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return <button className={'nav-button ' + (active ? 'active' : '')} onClick={onClick}>{icon}<span>{children}</span></button>
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (result: AuthResult) => Promise<void> }) {
  const [mode, setMode] = useState<'register' | 'login'>('register')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [storeName, setStoreName] = useState('')
  const [category, setCategory] = useState('Товары для дома')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await api<AuthResult>(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(mode === 'register'
          ? { name, email, password, storeName, category }
          : { email, password }),
      })
      await onAuthenticated(result)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось войти.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-brand-panel">
        <a className="brand brand-light" href="/"><span className="brand-mark">s.</span><span>shop<span>ai</span></span></a>
        <div className="auth-message"><span className="eyebrow light">COMMERCE, MADE SIMPLE</span><h1>Ваш магазин.<br /><em>Ваши правила.</em></h1><p>Создайте витрину, подготовьте карточки товаров с AI и управляйте заказами в одном рабочем пространстве.</p></div>
        <div className="auth-footnote">SHOPAI · ПЛАТФОРМА ДЛЯ СОЗДАНИЯ ИНТЕРНЕТ-МАГАЗИНОВ</div>
      </div>
      <div className="auth-form-panel">
        <form className="auth-form" onSubmit={submit}>
          <span className="eyebrow">{mode === 'register' ? 'НАЧАТЬ РАБОТУ' : 'С ВОЗВРАЩЕНИЕМ'}</span>
          <h2>{mode === 'register' ? 'Создайте свой магазин' : 'Войдите в ShopAI'}</h2>
          <p className="muted">{mode === 'register' ? 'Аккаунт и рабочее пространство появятся за минуту.' : 'Продолжите работу с вашим магазином.'}</p>
          {mode === 'register' && <>
            <label>Ваше имя<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Анна" minLength={2} required /></label>
            <label>Название магазина<input value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="Например, Atelier Home" required /></label>
            <label>Категория магазина<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Товары для дома</option><option>Одежда и аксессуары</option><option>Красота и уход</option><option>Электроника</option><option>Продукты</option><option>Другое</option></select></label>
          </>}
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>
          <label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Не менее 8 символов" minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required /></label>
          {error && <div className="inline-error"><CircleAlert size={16} />{error}</div>}
          <button className="button button-primary button-full" disabled={busy}>{busy ? 'Подождите…' : mode === 'register' ? 'Создать магазин' : 'Войти'}<ArrowRight size={16} /></button>
          <p className="auth-switch">{mode === 'register' ? 'Уже есть аккаунт?' : 'Впервые в ShopAI?'} <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError('') }}>{mode === 'register' ? 'Войти' : 'Создать аккаунт'}</button></p>
        </form>
      </div>
    </div>
  )
}

function Overview({ store, products, onAdd, onEdit, onViewProducts, onViewSettings }: {
  store: StoreData; products: Product[];
  onAdd: () => void; onEdit: (product: Product) => void; onViewProducts: () => void; onViewSettings: () => void
}) {
  const hasProducts = products.length > 0
  const hasAiContent = products.some((product) => product.description.trim() && product.seoTitle.trim())
  const completed = 1 + Number(hasProducts) + Number(hasAiContent) + Number(store.published)
  const progress = Math.round(completed / 4 * 100)
  const firstProduct = products[0]
  const publicUrl = window.location.origin + '/shop/' + store.slug

  return (
    <div className="page-stack builder-page">
      <section className="builder-hero">
        <div className="builder-hero-copy">
          <span className="eyebrow">SHOPAI · СОЗДАНИЕ МАГАЗИНА</span>
          <h1>Запустите свой интернет-магазин</h1>
          <p>Пройдите несколько простых шагов: настройте магазин, добавьте товары, подготовьте описания с AI и опубликуйте витрину.</p>
          <div className="builder-hero-actions">
            <button className="button button-primary" onClick={hasProducts ? onViewProducts : onAdd}>
              {hasProducts ? 'Перейти к каталогу' : 'Добавить первый товар'} <ArrowRight size={16} />
            </button>
            <span className="builder-no-code">Без программирования</span>
          </div>
        </div>
        <div className="builder-visual" aria-hidden="true">
          <div className="builder-orbit orbit-one" />
          <div className="builder-orbit orbit-two" />
          <div className="builder-store-card">
            <div className="builder-store-top"><span>{store.name.slice(0,1).toUpperCase()}</span><i /><i /><i /></div>
            <div className="builder-store-cover"><Store size={28} /></div>
            <div className="builder-store-lines"><i /><i /><i /></div>
            <div className="builder-store-products"><span /><span /><span /></div>
          </div>
          <div className="builder-ai-chip"><Sparkles size={14} /> AI-помощник</div>
          <div className="builder-live-chip"><span /> Ваша витрина</div>
        </div>
      </section>

      <section className="builder-progress panel">
        <div className="builder-progress-head">
          <div><span className="eyebrow">ПРОГРЕСС ЗАПУСКА</span><h2>{store.published ? 'Ваш магазин опубликован' : 'Подготовка магазина'}</h2></div>
          <strong>{completed} из 4 шагов</strong>
        </div>
        <div className="progress-track"><span style={{ width: progress + '%' }} /></div>
        <div className="builder-steps">
          <div className="builder-step is-complete">
            <span className="builder-step-index"><Check size={15} /></span>
            <div><strong>Основная информация</strong><small>{store.name} · {store.category}</small></div>
            <button onClick={onViewSettings}>Изменить</button>
          </div>
          <div className={`builder-step ${hasProducts ? 'is-complete' : 'is-current'}`}>
            <span className="builder-step-index">{hasProducts ? <Check size={15} /> : '02'}</span>
            <div><strong>Добавьте товары</strong><small>{hasProducts ? products.length + ' товаров в каталоге' : 'Название, фотография, цена и характеристики'}</small></div>
            <button onClick={hasProducts ? onViewProducts : onAdd}>{hasProducts ? 'Открыть каталог' : 'Добавить товар'}</button>
          </div>
          <div className={`builder-step ${hasAiContent ? 'is-complete' : hasProducts ? 'is-current' : ''}`}>
            <span className="builder-step-index">{hasAiContent ? <Check size={15} /> : '03'}</span>
            <div><strong>Подготовьте контент с AI</strong><small>{hasAiContent ? 'Есть карточки с описанием и SEO' : 'Сгенерируйте описание и SEO-заголовок в карточке товара'}</small></div>
            <button disabled={!hasProducts} onClick={() => firstProduct && onEdit(firstProduct)}>{hasAiContent ? 'Редактировать' : 'Открыть AI'}</button>
          </div>
          <div className={`builder-step ${store.published ? 'is-complete' : hasAiContent ? 'is-current' : ''}`}>
            <span className="builder-step-index">{store.published ? <Check size={15} /> : '04'}</span>
            <div><strong>Настройте и опубликуйте витрину</strong><small>{store.published ? 'Магазин доступен покупателям' : 'Проверьте оформление и откройте магазин по ссылке'}</small></div>
            <button onClick={onViewSettings}>{store.published ? 'Настройки' : 'Настроить'}</button>
          </div>
        </div>
      </section>

      <div className="builder-bottom-grid">
        <section className="panel builder-catalog-panel">
          <div className="panel-heading"><div><span className="eyebrow">ВАШ АССОРТИМЕНТ</span><h2>{hasProducts ? 'Товары магазина' : 'Начните с первого товара'}</h2></div><button className="text-button" onClick={onViewProducts}>Каталог <ArrowRight size={14} /></button></div>
          {hasProducts ? <div className="product-preview-grid">{products.slice(0, 3).map((product) => <ProductMini key={product.id} product={product} />)}</div> : <EmptyState icon={<Package size={22} />} title="Каталог пока пуст" text="Добавьте первый товар. В карточке сможете сразу подготовить описание и SEO с помощью AI." />}
        </section>
        <section className="panel builder-publish-panel">
          <span className="eyebrow">ПУБЛИЧНАЯ ВИТРИНА</span>
          <div className="builder-publish-icon"><Store size={22} /></div>
          <h2>{store.published ? 'Магазин уже доступен' : 'Ваша витрина ждёт запуска'}</h2>
          <p>{store.published ? 'Поделитесь ссылкой на магазин с покупателями.' : 'Сначала добавьте товары и проверьте настройки. Затем опубликуйте магазин.'}</p>
          {store.published ? <a className="button button-light button-full" href={publicUrl} target="_blank" rel="noreferrer">Открыть витрину <ArrowUpRight size={15} /></a> : <button className="button button-primary button-full" onClick={onViewSettings}>Настроить витрину <ArrowRight size={15} /></button>}
          <small className="muted">Без онлайн-оплаты: покупатель отправляет заявку, а владелец связывается с ним отдельно.</small>
        </section>
      </div>
    </div>
  )
}

function ProductsView({ products, query, setQuery, onAdd, onEdit, onDelete }: {
  products: Product[]; query: string; setQuery: (value: string) => void;
  onAdd: () => void; onEdit: (product: Product) => void; onDelete: (product: Product) => void
}) {
  return (
    <div className="page-stack">
      <div className="page-heading"><div><span className="eyebrow">УПРАВЛЕНИЕ АССОРТИМЕНТОМ</span><h1>Товары</h1><p>Создавайте карточки товаров и готовьте контент с помощью AI.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={16} /> Добавить товар</button></div>
      <div className="toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию и категории" /></div><span className="result-count">{products.length} товаров</span></div>
      {products.length === 0 ? <div className="panel"><EmptyState icon={<Package size={24} />} title="Ничего не найдено" text={query ? 'Измените поисковый запрос или очистите поле.' : 'Создайте первую карточку товара.'} /></div> : <div className="table-panel"><table className="data-table"><thead><tr><th>ТОВАР</th><th>КАТЕГОРИЯ</th><th>ЦЕНА</th><th>ОСТАТОК</th><th>ВИТРИНА</th><th></th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><div className="table-product">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <div className="image-placeholder"><Package size={17} /></div>}<div><strong>{product.name}</strong><span>{product.seoTitle || 'SEO-заголовок не задан'}</span></div></div></td><td>{product.category}</td><td className="table-price">{money(product.price)}</td><td>{product.stock} шт.</td><td><span className={'status ' + (product.published ? 'done' : 'muted-status')}>{product.published ? 'Опубликован' : 'Скрыт'}</span></td><td><div className="table-actions"><button className="icon-button" onClick={() => onEdit(product)} aria-label="Редактировать"><Pencil size={15} /></button><button className="icon-button danger" onClick={() => onDelete(product)} aria-label="Удалить"><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>}
      <p className="helper-note"><BadgeCheck size={15} /> Товары с остатком больше нуля и включённой публикацией будут показаны в публичной витрине.</p>
    </div>
  )
}

function ProductMini({ product }: { product: Product }) {
  return <div className="product-mini"><div className="mini-image">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <Package size={20} />}</div><div className="mini-copy"><strong>{product.name}</strong><span>{money(product.price)} · {product.stock} шт.</span></div></div>
}

function ProductModal({ product, busy, onClose, onSave }: {
  product: Product | null; busy: boolean; onClose: () => void; onSave: (draft: ProductDraft) => Promise<void>
}) {
  return <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><ProductForm product={product} busy={busy} onClose={onClose} onSave={onSave} /></div>
}

function ProductForm({ product, busy, onClose, onSave }: {
  product: Product | null; busy: boolean; onClose: () => void; onSave: (draft: ProductDraft) => Promise<void>
}) {
  const [draft, setDraft] = useState<ProductDraft>(product ? {
    name: product.name, category: product.category, description: product.description,
    seoTitle: product.seoTitle, price: product.price, stock: product.stock,
    imageUrl: product.imageUrl, published: product.published,
  } : emptyDraft)
  const [details, setDetails] = useState(product?.description ?? '')
  const [tone, setTone] = useState('Дружелюбный')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMode, setAiMode] = useState<'live' | 'demo' | null>(null)
  const [error, setError] = useState('')

  const generate = async () => {
    setError('')
    setAiBusy(true)
    try {
      const result = await api<{ description: string; seoTitle: string; provider: 'live' | 'demo'; message?: string }>('/api/ai/product-copy', {
        method: 'POST',
        body: JSON.stringify({ name: draft.name, category: draft.category, details, tone }),
      })
      setDraft((current) => ({ ...current, description: result.description, seoTitle: result.seoTitle }))
      setAiMode(result.provider)
      if (result.message) setError(result.message)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось подготовить описание.')
    } finally {
      setAiBusy(false)
    }
  }

  const uploadImage = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Выберите изображение PNG, JPEG или WebP.')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('Размер изображения не должен превышать 4 МБ.')
      return
    }
    setError('')
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const result = await api<{ imageUrl: string }>('/api/uploads', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result }) })
        setDraft((current) => ({ ...current, imageUrl: result.imageUrl }))
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить изображение.')
      }
    }
    reader.readAsDataURL(file)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.name.trim() || draft.price <= 0 || draft.stock < 0) {
      setError('Проверьте название, цену и остаток товара.')
      return
    }
    void onSave(draft)
  }

  return (
    <form className="product-form modal-card" onSubmit={submit}>
      <div className="modal-heading"><div><span className="eyebrow">КАРТОЧКА ТОВАРА</span><h2>{product ? 'Редактировать товар' : 'Новый товар'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div>
      <div className="form-columns">
        <div className="form-main">
          <label>Название товара<input required maxLength={140} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Например, Керамическая ваза" /></label>
          <div className="form-row"><label>Категория<input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="Декор" /></label><label>Цена, ₽<input type="number" min="1" step="1" required value={draft.price || ''} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })} /></label><label>Остаток, шт.<input type="number" min="0" step="1" required value={draft.stock} onChange={(event) => setDraft({ ...draft, stock: Number(event.target.value) })} /></label></div>
          <label>Описание товара<textarea rows={5} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Описание можно написать самостоятельно или подготовить с AI." /></label>
          <label>SEO-заголовок<input maxLength={180} value={draft.seoTitle} onChange={(event) => setDraft({ ...draft, seoTitle: event.target.value })} placeholder="Заголовок для поисковых систем" /></label>
          <label className="image-upload"><span className="upload-preview">{draft.imageUrl ? <img src={draft.imageUrl} alt="Предпросмотр товара" /> : <ImagePlus size={22} />}</span><span><strong>Фотография товара</strong><small>PNG, JPEG или WebP · до 4 МБ</small></span><span className="button button-light button-small"><Upload size={14} /> Выбрать</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadImage(event.target.files?.[0])} /></label>
          <label className="switch-row"><input type="checkbox" checked={draft.published} onChange={(event) => setDraft({ ...draft, published: event.target.checked })} /><span><strong>Показывать товар в витрине</strong><small>Товар будет виден покупателям, если магазин опубликован.</small></span></label>
        </div>
        <aside className="ai-panel">
          <div className="ai-panel-title"><span className="ai-icon"><WandSparkles size={17} /></span><div><strong>AI-помощник</strong><small>Описание и SEO для товара</small></div></div>
          <p>Укажите фактические характеристики. AI подготовит черновик, который можно отредактировать перед сохранением.</p>
          <label>Характеристики<textarea rows={5} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Материал, размеры, цвет, особенности..." /></label>
          <label>Стиль текста<select value={tone} onChange={(event) => setTone(event.target.value)}><option>Дружелюбный</option><option>Премиальный</option><option>Краткий</option></select></label>
          <button className="button button-ai button-full" type="button" disabled={aiBusy || !draft.name.trim() || !details.trim()} onClick={() => void generate()}><Sparkles size={15} />{aiBusy ? 'Готовим черновик…' : 'Сгенерировать с AI'}</button>
          {aiMode && <span className="ai-mode">{aiMode === 'live' ? 'Подключённая AI-модель' : 'Демо-режим генерации'}</span>}
          {error && <div className="inline-error small-error"><CircleAlert size={15} />{error}</div>}
        </aside>
      </div>
      <div className="modal-footer"><button className="button button-ghost" type="button" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить товар'}<Check size={15} /></button></div>
    </form>
  )
}

function OrdersView({ orders, onChangeStatus }: { orders: Order[]; onChangeStatus: (id: string, status: string) => void }) {
  return (
    <div className="page-stack">
      <div className="page-heading"><div><span className="eyebrow">ПРОДАЖИ</span><h1>Заказы</h1><p>Заявки покупателей, оформленные через публичную витрину.</p></div><div className="small-stat"><strong>{orders.length}</strong><span>всего заказов</span></div></div>
      {orders.length === 0 ? <div className="panel"><EmptyState icon={<ShoppingBag size={24} />} title="Пока нет заказов" text="Опубликуйте магазин и поделитесь ссылкой на витрину с покупателями." /></div> : <div className="orders-grid">{orders.map((order) => <article className="order-card" key={order.id}><div className="order-card-head"><div><span className="eyebrow">{order.id}</span><h3>{order.customerName}</h3><small>{dateTime(order.createdAt)}</small></div><strong>{money(order.total)}</strong></div><div className="order-contact">{order.email || 'Email не указан'}{order.phone ? ' · ' + order.phone : ''}{order.address ? <span>{order.address}</span> : null}</div><div className="order-items">{order.items.map((item) => <div key={item.productId}><span>{item.name} × {item.quantity}</span><strong>{money(item.price * item.quantity)}</strong></div>)}</div>{order.comment && <p className="order-comment">Комментарий: {order.comment}</p>}<div className="order-card-footer"><span className={'status ' + statusClass(order.status)}>{order.status}</span><select value={order.status} disabled={order.status === 'Отменён'} onChange={(event) => onChangeStatus(order.id, event.target.value)} aria-label="Статус заказа"><option>Новый</option><option>В работе</option><option>Выполнен</option><option>Отменён</option></select></div></article>)}</div>}
    </div>
  )
}

function SettingsView({ store, busy, onSave, onPublish }: {
  store: StoreData; busy: boolean; onSave: (patch: Partial<StoreData>) => Promise<void>; onPublish: () => void
}) {
  const [name, setName] = useState(store.name)
  const [description, setDescription] = useState(store.description)
  const [category, setCategory] = useState(store.category)
  const [primaryColor, setPrimaryColor] = useState(store.primaryColor)
  useEffect(() => {
    setName(store.name)
    setDescription(store.description)
    setCategory(store.category)
    setPrimaryColor(store.primaryColor)
  }, [store])
  const publicUrl = window.location.origin + '/shop/' + store.slug
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(publicUrl) } catch { /* Clipboard may be unavailable in an insecure context. */ }
  }
  return (
    <div className="page-stack">
      <div className="page-heading"><div><span className="eyebrow">НАСТРОЙКИ</span><h1>Ваш магазин</h1><p>Информация, которая будет отображаться на публичной витрине.</p></div></div>
      <div className="settings-layout">
        <form className="panel settings-form" onSubmit={(event) => { event.preventDefault(); void onSave({ name, description, category, primaryColor }) }}>
          <div className="panel-heading"><div><h2>Основная информация</h2><p>Эти данные видят покупатели.</p></div></div>
          <label>Название магазина<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} /></label>
          <label>Описание<textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Расскажите о магазине" /></label>
          <label>Категория<input value={category} onChange={(event) => setCategory(event.target.value)} /></label>
          <label>Основной цвет витрины<div className="color-input"><input type="color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} /><span>{primaryColor.toUpperCase()}</span></div></label>
          <button className="button button-primary" disabled={busy}>Сохранить настройки <Check size={15} /></button>
        </form>
        <aside className="panel publish-panel">
          <span className="eyebrow">ПУБЛИКАЦИЯ</span><div className="publish-icon"><Store size={22} /></div><h2>{store.published ? 'Витрина опубликована' : 'Ваш магазин готов к запуску?'}</h2><p>{store.published ? 'Покупатели могут открыть магазин по публичной ссылке.' : 'Проверьте товары и опубликуйте витрину, чтобы покупатели могли оформить заказ.'}</p>
          <div className="public-url"><span>{publicUrl}</span><button type="button" onClick={() => void copyLink()} title="Скопировать ссылку"><ExternalLink size={15} /></button></div>
          <button className={'button button-full ' + (store.published ? 'button-ghost' : 'button-primary')} disabled={busy} onClick={onPublish}>{store.published ? 'Снять с публикации' : 'Опубликовать магазин'}<ArrowUpRight size={16} /></button>
          <small className="muted">Публикация доступна по адресу /shop/{store.slug}. Платежи и доставка в MVP не подключены.</small>
        </aside>
      </div>
    </div>
  )
}

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="empty-state"><div>{icon}</div><strong>{title}</strong><p>{text}</p></div>
}

function PublicStore({ slug }: { slug: string }) {
  const [data, setData] = useState<{ store: PublicStoreData; products: PublicProduct[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')

  useEffect(() => {
    api<{ store: PublicStoreData; products: PublicProduct[] }>('/api/public/' + encodeURIComponent(slug)).then(setData).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось открыть магазин.')
    }).finally(() => setLoading(false))
  }, [slug])

  const cartItems = useMemo(() => data?.products.filter((product) => cart[product.id]) ?? [], [data, cart])
  const totalQuantity = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0)
  const total = cartItems.reduce((sum, product) => sum + product.price * cart[product.id], 0)
  const setQuantity = (id: string, quantity: number) => setCart((current) => {
    const next = { ...current }
    if (quantity <= 0) delete next[id]
    else next[id] = quantity
    return next
  })

  const placeOrder = async (event: FormEvent) => {
    event.preventDefault()
    if (!data || totalQuantity === 0) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api<{ order: { id: string; total: number } }>('/api/public/' + encodeURIComponent(slug) + '/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerName, email, phone, address, comment,
          items: cartItems.map((product) => ({ productId: product.id, quantity: cart[product.id] })),
        }),
      })
      setSuccess('Заказ ' + result.order.id + ' оформлен. Магазин свяжется с вами для подтверждения.')
      setCart({})
      setCheckoutOpen(false)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось оформить заказ.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="store-loading">Открываем витрину…</div>
  if (!data) return <div className="store-loading"><CircleAlert size={22} /><strong>Магазин недоступен</strong><span>{error}</span><a href="/">Перейти в ShopAI</a></div>

  return (
    <div className="public-store" style={{ '--store-accent': data.store.primaryColor } as CSSProperties}>
      <header className="public-header"><a className="public-brand" href="#top">{data.store.name}</a><span>{data.store.category}</span><button className="button button-light" onClick={() => setCheckoutOpen(true)} disabled={!totalQuantity}><ShoppingCart size={16} /> Корзина <b>{totalQuantity}</b></button></header>
      <section className="store-hero" id="top"><span className="eyebrow">ИНТЕРНЕТ-МАГАЗИН</span><h1>{data.store.name}</h1><p>{data.store.description}</p><a href="#catalog" className="button button-dark">Перейти к товарам <ArrowRight size={16} /></a></section>
      <main className="store-catalog" id="catalog"><div className="store-section-heading"><div><span className="eyebrow">КАТАЛОГ</span><h2>Выберите то, что вам нравится</h2></div><span>{data.products.length} товаров</span></div>
        {data.products.length === 0 ? <EmptyState icon={<Package size={24} />} title="Каталог скоро появится" text="Владелец магазина пока не добавил доступные товары." /> : <div className="store-product-grid">{data.products.map((product) => <article className="store-product" key={product.id}><div className="store-product-image">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <Package size={30} />}</div><div className="store-product-info"><span className="eyebrow">{product.category}</span><h3>{product.name}</h3><p>{product.description}</p><div className="store-product-bottom"><strong>{money(product.price)}</strong><button onClick={() => setQuantity(product.id, (cart[product.id] || 0) + 1)} disabled={cart[product.id] >= product.stock}>{cart[product.id] ? 'Добавить ещё' : 'В корзину'} <Plus size={14} /></button></div></div></article>)}</div>}
      </main>
      <footer className="public-footer"><span>{data.store.name}</span><span>Создано с помощью ShopAI</span></footer>
      {success && <div className="success-banner"><Check size={18} />{success}<button onClick={() => setSuccess('')}><X size={16} /></button></div>}
      {checkoutOpen && <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCheckoutOpen(false) }}><form className="checkout-card" onSubmit={placeOrder}><div className="modal-heading"><div><span className="eyebrow">ОФОРМЛЕНИЕ</span><h2>Ваш заказ</h2></div><button className="icon-button" type="button" onClick={() => setCheckoutOpen(false)}><X size={18} /></button></div><div className="checkout-items">{cartItems.map((product) => <div key={product.id}><span>{product.name} × {cart[product.id]}</span><strong>{money(product.price * cart[product.id])}</strong><div className="quantity-control"><button type="button" onClick={() => setQuantity(product.id, cart[product.id] - 1)}>−</button><span>{cart[product.id]}</span><button type="button" onClick={() => setQuantity(product.id, cart[product.id] + 1)} disabled={cart[product.id] >= product.stock}>+</button></div></div>)}</div><div className="checkout-total"><span>Итого</span><strong>{money(total)}</strong></div><label>Ваше имя<input required minLength={2} value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label><div className="form-row"><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><label>Телефон<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7…" /></label></div><label>Адрес или способ связи<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Необязательно" /></label><label>Комментарий<textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} /></label>{error && <div className="inline-error"><CircleAlert size={15} />{error}</div>}<p className="checkout-note">Это заявка на заказ. Оплата и доставка будут согласованы с магазином отдельно.</p><button className="button button-primary button-full" disabled={submitting || !totalQuantity}>{submitting ? 'Отправляем…' : 'Подтвердить заказ'}<ArrowRight size={16} /></button></form></div>}
    </div>
  )
}
