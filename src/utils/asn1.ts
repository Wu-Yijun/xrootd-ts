/**
 * ASN.1 DER parsing utilities.
 */

/** Result of parsing an ASN.1 length field. */
export interface Asn1LengthResult {
  offset: number;
  length: number;
}

/**
 * Parse an ASN.1 DER length field.
 *
 * Short form: first byte < 0x80 → that byte is the length.
 * Long form:  first byte >= 0x80 → low 7 bits = number of subsequent bytes
 *             that encode the length as a big-endian integer.
 */
export function parseAsn1Length(
  data: Uint8Array,
  offset: number,
): Asn1LengthResult | null {
  if (offset >= data.length) return null;

  const firstByte = data[offset]!;
  if (firstByte < 0x80) {
    return { offset: offset + 1, length: firstByte };
  }

  const numBytes = firstByte & 0x7f;
  if (numBytes === 0 || offset + 1 + numBytes > data.length) return null;

  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    length = (length << 8) | data[offset + 1 + i]!;
  }
  return { offset: offset + 1 + numBytes, length };
}

/**
 * Extract a raw Kerberos AP-REQ from a GSS-API InitialContextToken.
 *
 * The `kerberos` npm package calls gss_init_sec_context() which wraps the
 * AP-REQ inside a GSS-API InitialContextToken (ASN.1 tag 0x60). The XRootD
 * server's krb5_rd_req() expects a raw AP-REQ (ASN.1 tag 0x6e), so we
 * must strip the GSS-API framing.
 *
 * GSS-API token layout:
 *   60 [len]                  ← APPLICATION 0 (InitialContextToken)
 *     06 09 [OID bytes]       ← Kerberos 5 OID (1.2.840.113554.1.2.2)
 *     [inner token]           ← contains raw AP-REQ (tag 0x6e)
 */
export function extractApReq(token: Uint8Array): Uint8Array {
  // If not a GSS-API token, return as-is (already a raw AP-REQ)
  if (token.length === 0 || token[0] !== 0x60) {
    return token;
  }

  // Search for the AP-REQ tag (0x6e = APPLICATION 14) after the GSS-API header
  for (let i = 1; i < token.length; i++) {
    if (token[i] === 0x6e) {
      const lenResult = parseAsn1Length(token, i + 1);
      if (lenResult) {
        const apReqEnd = lenResult.offset + lenResult.length;
        return token.slice(i, apReqEnd);
      }
    }
  }

  // Fallback: return the original token
  return token;
}
