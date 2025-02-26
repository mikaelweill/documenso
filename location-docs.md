# Documenso Codebase Structure

This document provides an overview of the Documenso repository structure and maps features to their locations in the codebase.

## Repository Structure

```
Documenso Repository Structure
==============================

📁 apps/                       # Main applications
│
├── 📁 web/                    # Main web application (Next.js)
│   └── 📁 src/
│       ├── 📁 app/            # Next.js App Router
│       │   ├── 📁 (dashboard)/   # User dashboard
│       │   │   ├── 📁 documents/ # Document management
│       │   │   ├── 📁 templates/ # Document templates
│       │   │   └── 📁 settings/  # User settings
│       │   │
│       │   ├── 📁 (signing)/     # Document signing features
│       │   │   └── 📁 sign/      # Signing interface
│       │   │
│       │   ├── 📁 (teams)/       # Team management features
│       │   ├── 📁 (recipient)/   # Recipient-related features
│       │   ├── 📁 (share)/       # Document sharing
│       │   ├── 📁 (profile)/     # User profile
│       │   ├── 📁 (unauthenticated)/ # Auth pages (login, signup)
│       │   └── 📁 api/           # API routes
│       │
│       ├── 📁 components/        # Shared UI components
│       └── 📁 helpers/           # Utility functions
│
├── 📁 documentation/          # Documentation site
└── 📁 openpage-api/           # API for embeddable signing pages

📁 packages/                   # Shared libraries and utilities
│
├── 📁 prisma/                 # Database schema and ORM
│   ├── schema.prisma          # Database schema definition
│   └── 📁 migrations/         # Database migrations
│
├── 📁 ui/                     # Shared UI components library
│
├── 📁 signing/                # Document signing implementation
│   ├── 📁 transports/         # Signing transport methods
│   └── 📁 helpers/            # Signing utility functions
│
├── 📁 email/                  # Email functionality
│   ├── 📁 templates/          # Email templates
│   ├── 📁 transports/         # Email transport methods
│   └── mailer.ts              # Main email sending functionality
│
├── 📁 trpc/                   # tRPC API implementation
│
├── 📁 lib/                    # Shared utilities
│
└── 📁 ee/                     # Enterprise Edition features
```

## Feature to Code Mapping

### 1. Authentication & User Management
- `apps/web/src/app/(unauthenticated)/` - Login, signup, password reset
- `apps/web/src/app/(profile)/` - User profile management
- `packages/prisma/` - User data models (in schema.prisma)

### 2. Document Management
- `apps/web/src/app/(dashboard)/documents/` - Document listing, creation, management
- `packages/prisma/` - Document data models

### 3. Document Signing
- `apps/web/src/app/(signing)/sign/` - Signing interface
- `packages/signing/` - Core signing implementation
- `packages/prisma/` - Signature data models

### 4. Templates
- `apps/web/src/app/(dashboard)/templates/` - Template management
- `packages/prisma/` - Template data models

### 5. Team Collaboration
- `apps/web/src/app/(teams)/` - Team management
- `packages/prisma/` - Team data models

### 6. Email Notifications
- `packages/email/` - Email sending implementation
- `packages/email/templates/` - Email templates

### 7. API
- `apps/web/src/app/api/` - API endpoints
- `packages/trpc/` - tRPC API implementation
- `apps/openpage-api/` - API for embeddable signing pages

### 8. Enterprise Features
- `packages/ee/` - Enterprise Edition specific features

### 9. Database
- `packages/prisma/` - Database schema, migrations, and utilities

### 10. UI Components
- `packages/ui/` - Shared UI components
- `apps/web/src/components/` - Web app specific components

## Development Setup

### Getting Started
1. Clone the repository
2. Copy `.env.example` to `.env`
3. Run `npm run dx` to install dependencies and set up the database
4. Run `npm run dev` to start the development server

### Key Scripts
- `npm run dx` - Developer setup (install dependencies, start Docker containers, run migrations)
- `npm run dev` - Start development server
- `npm run prisma:studio` - Open Prisma Studio to view database
- `npm run prisma:migrate-dev` - Run database migrations

## Notes on Monorepo Structure

This project uses a monorepo structure with Turborepo. The main applications are in the `apps` directory, while shared libraries and utilities are in the `packages` directory. This separation allows for better code organization and reuse across different parts of the application.

The Next.js application uses the App Router pattern, organizing routes in the `apps/web/src/app` directory, with different sections of the application separated into their own directories. 