/**
 * A tiny JSON-Schema checker for the exact subset the tools declare.
 *
 * The MCP `inputSchema` is the contract a client reads; if nothing enforced it,
 * the schema would be documentation that can drift from the code. This walks
 * the same schema object `tools/list` publishes, so a declared `maximum` or
 * `enum` is a real rejection and not a comment.
 *
 * Supported keywords: type, properties, required, additionalProperties, items,
 * enum, const, minimum, maximum, minItems, maxItems, minLength. Anything else
 * in a schema is ignored on purpose — the tools never declare it.
 *
 * `type` accepts a string or an array of strings (a union such as
 * `['string', 'object']` for a patch, which is either a share code or a
 * payload).
 */
import { ERRORS, fail } from './errors.mjs';

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

const matchesType = (value, type) => {
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return typeOf(value) === type;
  }
};

/**
 * Validate `value` against `schema`. Throws a structured `E_SCHEMA` / `E_RANGE`
 * rejection naming the offending path; returns the value untouched on success.
 */
export function validate(schema, value, path = '$') {
  if (!schema || typeof schema !== 'object') return value;

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      throw fail(ERRORS.SCHEMA, `${path}: expected ${types.join(' | ')}, got ${typeOf(value)}`, {
        path,
        expected: types,
        got: typeOf(value),
      });
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    throw fail(ERRORS.SCHEMA, `${path}: must be ${JSON.stringify(schema.const)}`, { path });
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw fail(ERRORS.SCHEMA, `${path}: must be one of ${schema.enum.join(', ')}`, {
      path,
      enum: schema.enum,
    });
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw fail(ERRORS.RANGE, `${path}: ${value} is below the minimum ${schema.minimum}`, {
        path,
        minimum: schema.minimum,
        value,
      });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw fail(ERRORS.RANGE, `${path}: ${value} is above the maximum ${schema.maximum}`, {
        path,
        maximum: schema.maximum,
        value,
      });
    }
  }

  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    throw fail(ERRORS.SCHEMA, `${path}: shorter than ${schema.minLength} characters`, { path });
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw fail(ERRORS.SCHEMA, `${path}: needs at least ${schema.minItems} item(s)`, { path });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw fail(ERRORS.RANGE, `${path}: ${value.length} items exceeds the maximum ${schema.maxItems}`, {
        path,
        maximum: schema.maxItems,
        length: value.length,
      });
    }
    if (schema.items) {
      value.forEach((entry, index) => validate(schema.items, entry, `${path}[${index}]`));
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        throw fail(ERRORS.SCHEMA, `${path}: missing required field "${key}"`, { path, field: key });
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) validate(child, value[key], `${path}.${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties ?? {}))) {
          throw fail(ERRORS.SCHEMA, `${path}: unknown field "${key}"`, { path, field: key });
        }
      }
    }
  }

  return value;
}
