import type { SourceKind } from './types';

export type FieldValue = string | number | string[];

export interface ResolvedField {
  /** Source that produced the value. */
  id: string;
  property: string;
  kind: SourceKind;
  value: FieldValue;
}

export interface ResolveOptions {
  /** Only these properties are considered; usually the template's keys. */
  allowedProperties: string[];
  sanitizeLists?: boolean;
  /** Keep rows whose value is empty (the comparison view wants them). */
  keepEmpty?: boolean;
}
