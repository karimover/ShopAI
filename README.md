# ShopAI

**AI-assisted commerce workspace for creating and managing online stores.**

ShopAI is a product concept and interactive MVP for entrepreneurs who want to launch a storefront, manage a catalog and orders, and prepare product content with an AI assistant — from one workspace.

> Current status: frontend MVP / demo. The application currently uses local browser storage and mock business data. AI Studio is a deterministic demo generator, not a live LLM integration. Backend, authentication, real checkout, payments and shipping integrations are planned, not implemented.

## Preview

The app is designed around a calm, premium commerce aesthetic: deep ink navigation, warm neutral surfaces, restrained violet accents, precise typography, compact data tables and editorial storefront imagery. The UI is responsive and includes light/dark themes.

## Features in the current MVP

- Overview dashboard with revenue metrics, sales chart and recent orders.
- Product catalog with search, create, edit and delete flows.
- Local persistence of catalog changes using browser localStorage.
- Orders and customer views populated with clearly marked demo data.
- AI Studio with editable product inputs, tone selection, generated copy and copy-to-clipboard.
- Storefront preview with editable store name and product cards.
- Settings view and light/dark theme toggle.
- Responsive sidebar and mobile layout.

## Stack

- React 19 + TypeScript
- Vite
- Recharts
- Lucide React
- CSS design tokens and responsive styles

## Run locally

Requires Node.js 20+.

```bash
git clone https://github.com/karimover/ShopAI.git
cd ShopAI
npm install
npm run dev
```

Open the local URL printed by Vite.

Production build:

```bash
npm run build
npm run preview
```

## Project structure

```text
src/
  App.tsx          # product workspace and page-level flows
  main.tsx         # React entry point
  index.css        # visual system and responsive layouts
docs/
  PRODUCT_ANALYSIS.md
  COMPETITIVE_ANALYSIS.md
  ARCHITECTURE.md
  ROADMAP.md
  AI_USAGE.md
  TESTING.md
  SPEAKER_SCRIPT.md
  CONTROL_POINT_FORM.md
  TEAM_PLAN.md
archive/
  early-html-prototype/
```

## Documentation

- [Product concept and audience](docs/PRODUCT_ANALYSIS.md)
- [Competitor analysis](docs/COMPETITIVE_ANALYSIS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [AI usage and limitations](docs/AI_USAGE.md)
- [Testing checklist](docs/TESTING.md)
- [Control-point slide outline](docs/CONTROL_POINT_PRESENTATION.md)
- [Control-point speaker script](docs/SPEAKER_SCRIPT.md)
- [Control-point form reference](docs/CONTROL_POINT_FORM.md)
- [Proposed team plan](docs/TEAM_PLAN.md)
- [Design inspiration and references](docs/DESIGN_REFERENCES.md)

## Design references

The interface was independently implemented for ShopAI. The following open-source projects were reviewed for information architecture and UI patterns; their code is not copied into this repository:

- [OrbynAdmin](https://github.com/masondevx/orbynadmin) — MIT-licensed dashboard template with commerce views, theme customization, responsive navigation and data tables.
- [shadcn-dashboard-landing-template](https://github.com/shadcnstore/shadcn-dashboard-landing-template) — dashboard and landing page patterns, theming and responsive app structure.
- [ecommerce-template](https://github.com/prinnotech/ecommerce-template) — broader storefront and admin workflows, product catalog, checkout and store theme editing.
- [nextjs-ecommerce-starter](https://github.com/thefrontkit/nextjs-ecommerce-starter) — storefront patterns for product discovery, filters, product pages and cart.

See docs/DESIGN_REFERENCES.md for evaluation notes and attribution.

## Project information

- Project: Разработка платформы по созданию Интернет магазинов с ИИ помощником(16)
- Customer: ООО «НОРМОКОНТРОЛЬ»
- Curator: Шестеров Михаил Андреевич

## Roadmap

The next major step is to replace local mock state with a typed backend API and persistent database, then implement authentication/roles and connect the AI service through a server-side adapter. See docs/ROADMAP.md.