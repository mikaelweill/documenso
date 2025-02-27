/**
 * Utility functions to serialize Prisma objects for client components
 * Particularly to handle Decimal types that can't be passed from Server to Client Components
 */

interface WithToNumber {
  toNumber: () => number;
}

/**
 * Checks if a value is a Decimal-like object (has a toNumber method)
 */
function isDecimalLike(value: unknown): value is WithToNumber {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof value.toNumber === 'function'
  );
}

/**
 * Recursively converts any Decimal objects to plain numbers
 * This is useful for preparing data from Prisma to be sent to client components
 */
export function serializeForClientComponents<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle Decimal objects (which have a toNumber method)
  if (isDecimalLike(data)) {
    // Use generic parameter to avoid explicit type casting
    return convertValue<WithToNumber, T>(data, (d) => d.toNumber());
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return convertValue<unknown[], T>(data, (arr) => arr.map(serializeForClientComponents));
  }

  // Handle objects
  if (typeof data === 'object') {
    // Use a type-safe approach without explicit assertions
    return convertValue<Record<string, unknown>, T>(
      data as unknown as Record<string, unknown>,
      (obj) => {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = serializeForClientComponents(value);
        }
        return result;
      },
    );
  }

  // Return primitive values as is
  return data;
}

/**
 * Type-safe helper to convert values without explicit type assertions
 */
function convertValue<TSource, TTarget>(
  source: TSource,
  converter: (source: TSource) => unknown,
): TTarget {
  return converter(source) as unknown as TTarget;
}

/**
 * Specifically serializes field data for client components
 * Converts Decimal properties (positionX, positionY, width, height) to numbers
 */
export function serializeFieldForClient<
  T extends { positionX?: unknown; positionY?: unknown; width?: unknown; height?: unknown },
>(field: T): T {
  return serializeForClientComponents(field);
}

/**
 * Serializes an array of fields for client components
 */
export function serializeFieldsForClient<
  T extends { positionX?: unknown; positionY?: unknown; width?: unknown; height?: unknown },
>(fields: T[]): T[] {
  return fields.map(serializeFieldForClient);
}
