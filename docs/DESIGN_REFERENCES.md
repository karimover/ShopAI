# Design references and implementation notes

Reviewed on 27 November 2026. These repositories informed the evaluation of dashboard information architecture, e-commerce workflows and modern React UI patterns.

## 1. OrbynAdmin

Repository: https://github.com/masondevx/orbynadmin

- License stated by repository: MIT.
- Stack: Next.js, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts, TanStack Table.
- Useful patterns: compact workspace sidebar, multiple dashboards, reusable tables, theme customizer, dark mode, responsive layout.
- ShopAI adaptation: clear information hierarchy, restrained accent color, reusable metric cards, responsive navigation and readable data tables.

## 2. shadcn-dashboard-landing-template

Repository: https://github.com/shadcnstore/shadcn-dashboard-landing-template

- Repository describes React + TypeScript + Vite and Next.js variants, shadcn/ui and Tailwind CSS v4.
- Useful patterns: consistent spacing, theme customization, dashboard/marketing split, responsive layout and feature-oriented application structure.
- ShopAI adaptation: compact component rhythm, visual consistency between admin workspace and storefront preview.

## 3. prinnotech/ecommerce-template

Repository: https://github.com/prinnotech/ecommerce-template

- Repository describes a full storefront and admin, product variants, checkout, orders, themes, and multiple backend options.
- Useful patterns: separating storefront and admin concepts, treating theme editing as a first-class workflow, order lifecycle and product management.
- ShopAI adaptation: storefront preview, future theme editor and explicit roadmap for backend/payment integration.

## 4. thefrontkit/nextjs-ecommerce-starter

Repository: https://github.com/thefrontkit/nextjs-ecommerce-starter

- Repository describes a Next.js storefront with product discovery, filters, product pages and cart.
- Useful patterns: editorial product presentation, product imagery, category/filter navigation and responsive product grids.
- ShopAI adaptation: spacious product cards, visual merchandising and a preview-oriented storefront.

## Original implementation

ShopAI's current UI was authored specifically for this repository using React, TypeScript, CSS and Lucide React. The reference repositories were reviewed for patterns; no source files from these repositories were copied into ShopAI. Their trademarks, names and assets remain the property of their respective owners.

Before reusing any code or assets from an external repository in a future implementation, review its current LICENSE file and preserve required notices. Repository descriptions and licenses may change.