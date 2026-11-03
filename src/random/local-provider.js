// OS/browser randomness for the prototype. No RANDOM.ORG calls or credentials.
export class LocalRandomProvider {
  label = 'Local browser randomness · not RANDOM.ORG';

  async nextUint32() {
    if (!globalThis.crypto?.getRandomValues) throw new Error('Local browser randomness is unavailable.');
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
}
