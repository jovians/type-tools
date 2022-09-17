/* Jovian (c) 2020, License: MIT */

// from https://gist.github.com/diafygi/90a3e80ca1c2793220e5/
const charSet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const to_b58 = function(B,A){var d=[],s="",i,j,c,n;for(i in B){j=0,c=B[i];s+=c||s.length^i?"":1;while(j in d||c){n=d[j];n=n?n*256+c:c;c=n/58|0;d[j]=n%58;j++}}while(j--)s+=A[d[j]];return s};
const from_b58 = function(S,A){var d=[],b=[],i,j,c,n;for(i in S){j=0,c=A.indexOf(S[i]);if(c<0)return undefined;c||b.length^i?i:b.push(0);while(j in d||c){n=d[j];n=n?n*58+c:c;c=n>>8;d[j]=n%256;j++}}while(j--)b.push(d[j]);return new Uint8Array(b)};

/**
 * Encodes Uint8Array data to base58 string 
 * @param data Uint8Array data to encode
 * @returns string base58 representation of the supplied data
 */
export function base58Encode(data: Uint8Array): string {
  return to_b58(data, charSet);
}

/**
 * Decodes base58 string into Uint8Array
 * @param data string base58 data to decode
 * @returns decoded Uint8Array of the encoded data
 */
export function base58Decode(data: string): Uint8Array {
  return from_b58(data, charSet);
}
