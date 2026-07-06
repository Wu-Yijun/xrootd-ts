/**
 * Boolean conversion utilities.
 */

/**
 * Check if a string value is "truthy" (defined, non-empty, not "0").
 * Used for parsing environment variable flags.
 */
export function truthy(val: string | undefined): boolean {
  return val !== undefined && val !== "0" && val !== "";
}
