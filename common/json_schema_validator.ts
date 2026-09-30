// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
// Portions derived from pboettch/json-schema-validator (thirdparty/json_schema_validator), MIT.
/**
 * `JSON_SCHEMA_VALIDATOR` (common/json_schema_validator.cpp): validate a JSON
 * document against a JSON schema and report each failure to an error handler,
 * over KiCad's bundled `thirdparty/json_schema_validator` (draft 2020-12).
 *
 * The keywords here are the ones KiCad's shipped schemas use — `type`,
 * `enum`, `const`, `allOf`, `if` / `then` / `else`, `required`,
 * `properties`, `additionalProperties`, `items`, `minItems`, `maxItems`,
 * `minLength`, `maxLength`, `pattern`, `minimum`, `maximum` — each checked in
 * the library's order and reported with the library's messages
 * (json-validator.cpp). `$ref`, `anyOf`/`oneOf`/`not`, `patternProperties`,
 * `dependencies` and `format` are not needed by any schema that is loaded.
 *
 * One difference from nlohmann: JSON numbers here are JavaScript doubles, so
 * `1.0` in a document is an integer, where nlohmann keeps it a float.
 *
 * The schema arrives as the parsed object (KiCad reads it from the stock data
 * path; a page has no such directory, so the schema ships as a module).
 */

/** What `Validate` reports to: `nlohmann::json_schema::error_handler`. */
export interface JSON_ERROR_HANDLER {
  error(aPointer: string, aInstance: unknown, aMessage: string): void;
}

type Json = unknown;
type Schema = Record<string, unknown> | boolean;

/** `json_pointer / key`, RFC 6901 escaped. */
const child = (aPtr: string, aKey: string | number): string =>
  `${aPtr}/${String(aKey).replaceAll('~', '~0').replaceAll('/', '~1')}`;

/** nlohmann's `json::value_t` as a JSON-schema type name. */
function instanceType(aInstance: Json): string {
  if (aInstance === null) return 'null';
  if (Array.isArray(aInstance)) return 'array';
  if (typeof aInstance === 'boolean') return 'boolean';
  if (typeof aInstance === 'number') return Number.isInteger(aInstance) ? 'integer' : 'number';
  if (typeof aInstance === 'string') return 'string';
  return 'object';
}

/** JSON equality, as `json::operator==`. */
function jsonEquals(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as Json[];
    return a.length === bb.length && a.every((v, i) => jsonEquals(v, bb[i]));
  }
  const ao = a as Record<string, Json>;
  const bo = b as Record<string, Json>;
  const ak = Object.keys(ao);
  return (
    ak.length === Object.keys(bo).length && ak.every((k) => k in bo && jsonEquals(ao[k], bo[k]))
  );
}

/** The number of Unicode code points, as the library's `utf8_length`. */
const utf8Length = (s: string): number => [...s].length;

/** `logical_combination_error_handler` / `first_error_handler`: errors kept, not reported. */
class COLLECTING_HANDLER implements JSON_ERROR_HANDLER {
  readonly entries: { ptr: string; instance: Json; message: string }[] = [];

  error(aPointer: string, aInstance: Json, aMessage: string): void {
    this.entries.push({ ptr: aPointer, instance: aInstance, message: aMessage });
  }

  propagate(e: JSON_ERROR_HANDLER, aPrefix: string): void {
    for (const entry of this.entries) e.error(entry.ptr, entry.instance, aPrefix + entry.message);
  }
}

function validate(aSchema: Schema, aPtr: string, aInstance: Json, e: JSON_ERROR_HANDLER): void {
  // boolean schemas: `true` admits everything, `false` nothing
  if (aSchema === true) return;

  if (aSchema === false) {
    e.error(aPtr, aInstance, 'instance invalid as per false-schema');
    return;
  }

  const s = aSchema;
  const type = instanceType(aInstance);

  // type_schema::validate: the type-specific validator, or "unexpected instance type"
  let typeAllowed = true;

  if ('type' in s) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    // a "number" schema also takes integers (json-validator.cpp: float reused for integer)
    typeAllowed = types.includes(type) || (type === 'integer' && types.includes('number'));
  }

  if (!typeAllowed) e.error(aPtr, aInstance, 'unexpected instance type');
  else validateForType(s, type, aPtr, aInstance, e);

  if ('enum' in s && !(s.enum as Json[]).some((v) => jsonEquals(aInstance, v)))
    e.error(aPtr, aInstance, 'instance not found in required enum');

  if ('const' in s && !jsonEquals(s.const, aInstance))
    e.error(aPtr, aInstance, 'instance not const');

  if (Array.isArray(s.allOf)) {
    (s.allOf as Schema[]).forEach((sub, index) => {
      const esub = new COLLECTING_HANDLER();
      validate(sub, aPtr, aInstance, esub);

      if (esub.entries.length > 0) {
        const first = esub.entries[0]!;
        e.error(
          first.ptr,
          first.instance,
          `at least one subschema has failed, but all of them are required to validate - ${first.message}`,
        );
        esub.propagate(e, `[combination: allOf / case#${index}] `);
      }
    });
  }

  if ('if' in s) {
    const err = new COLLECTING_HANDLER();
    validate(s.if as Schema, aPtr, aInstance, err);

    if (err.entries.length === 0) {
      if ('then' in s) validate(s.then as Schema, aPtr, aInstance, e);
    } else if ('else' in s) {
      validate(s.else as Schema, aPtr, aInstance, e);
    }
  }
}

function validateForType(
  s: Record<string, unknown>,
  aType: string,
  aPtr: string,
  aInstance: Json,
  e: JSON_ERROR_HANDLER,
): void {
  if (aType === 'object') {
    const obj = aInstance as Record<string, Json>;

    for (const r of (s.required as string[] | undefined) ?? [])
      if (!(r in obj)) e.error(aPtr, aInstance, `required property '${r}' not found in object`);

    const properties = (s.properties as Record<string, Schema> | undefined) ?? {};

    for (const [key, value] of Object.entries(obj)) {
      if (key in properties) {
        validate(properties[key]!, child(aPtr, key), value, e);
      } else if ('additionalProperties' in s) {
        const additional = new COLLECTING_HANDLER();
        validate(s.additionalProperties as Schema, child(aPtr, key), value, additional);

        if (additional.entries.length > 0)
          e.error(
            aPtr,
            aInstance,
            `validation failed for additional property '${key}': ${additional.entries[0]!.message}`,
          );
      }
    }
  } else if (aType === 'array') {
    const arr = aInstance as Json[];

    if (typeof s.maxItems === 'number' && arr.length > s.maxItems)
      e.error(aPtr, aInstance, 'array has too many items');

    if (typeof s.minItems === 'number' && arr.length < s.minItems)
      e.error(aPtr, aInstance, 'array has too few items');

    if ('items' in s)
      arr.forEach((item, i) => validate(s.items as Schema, child(aPtr, i), item, e));
  } else if (aType === 'string') {
    const str = aInstance as string;

    if (typeof s.minLength === 'number' && utf8Length(str) < s.minLength)
      e.error(aPtr, aInstance, `instance is too short as per minLength:${s.minLength}`);

    if (typeof s.maxLength === 'number' && utf8Length(str) > s.maxLength)
      e.error(aPtr, aInstance, `instance is too long as per maxLength: ${s.maxLength}`);

    if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(str))
      e.error(aPtr, aInstance, `instance does not match regex pattern: ${s.pattern}`);
  } else if (aType === 'integer' || aType === 'number') {
    const n = aInstance as number;

    if (typeof s.maximum === 'number' && n > s.maximum)
      e.error(aPtr, aInstance, `instance exceeds maximum of ${s.maximum}`);

    if (typeof s.minimum === 'number' && n < s.minimum)
      e.error(aPtr, aInstance, `instance is below minimum of ${s.minimum}`);
  }
}

export class JSON_SCHEMA_VALIDATOR {
  private readonly m_schema: Schema;

  constructor(aSchema: Schema) {
    this.m_schema = aSchema;
  }

  /** `Validate( aJson, aErrorHandler )`, from the document's root pointer. */
  Validate(aJson: unknown, aErrorHandler: JSON_ERROR_HANDLER): void {
    validate(this.m_schema, '', aJson, aErrorHandler);
  }
}
