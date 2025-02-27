# Decimal Serialization for Next.js Server Components

## The Problem

When using Prisma with Next.js Server Components, you may encounter the following warning:

```
Warning: Only plain objects can be passed to Client Components from Server Components. Decimal objects are not supported.
```

This happens because:

1. Prisma uses a custom `Decimal` class type for decimal fields in your database schema
2. Next.js Server Components can only serialize regular JavaScript objects during the React Server Component hydration process
3. These Decimal objects need to be converted to plain numbers before being passed to client components

In Documenso, this affects the following Prisma fields:
- `positionX` (Decimal)  
- `positionY` (Decimal)
- `width` (Decimal)
- `height` (Decimal)

## The Solution

We've created a serialization utility at `packages/lib/utils/serialize-prisma-fields.ts` with functions to convert Decimal objects to plain numbers:

```typescript
// Main function to recursively convert any Decimal objects to numbers
serializeForClientComponents<T>(data: T): T

// Specifically for field arrays
serializeFieldsForClient<T>(fields: T[]): T[]

// For a single field
serializeFieldForClient<T>(field: T): T
```

## How to Use

Whenever you need to pass data from a Server Component to a Client Component that might contain Decimal objects:

1. Import the utility:

```typescript
import { serializeForClientComponents, serializeFieldsForClient } from '@documenso/lib/utils/serialize-prisma-fields';
```

2. Serialize your data before passing it:

```typescript
// For a document or recipient
const serializedDocument = serializeForClientComponents(document);

// For field arrays
const serializedFields = serializeFieldsForClient(fields);
```

3. Pass the serialized data to your client components:

```typescript
<ClientComponent 
  document={serializedDocument}
  fields={serializedFields}
/>
```

## Example Implementation

See `apps/web/src/app/(signing)/sign/[token]/page.tsx` for a complete example of serializing all data before passing it to client components.

## Benefits

- Eliminates the "Decimal objects are not supported" warning
- Prevents potential hydration mismatches
- Ensures consistent behavior across the application
- Maintains type safety with generics

## When to Apply

Apply this serialization in Server Components (files without `'use client'` directive) when:

1. You're loading data directly from Prisma
2. The data includes fields that use the `Decimal` type in the schema
3. You're passing that data to a client component

This pattern can be gradually applied throughout the codebase as needed. 