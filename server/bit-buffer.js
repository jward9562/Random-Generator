// One in-memory, forward-only bit stream shared by all tabs on this server.
export class BitBuffer {
  #fetchBlock;
  #bytes = new Uint8Array();
  #cursor = 0;
  #tail = Promise.resolve();
  #consumed = 0;
  #blocks = 0;

  constructor(fetchBlock) { this.#fetchBlock = fetchBlock; }

  get stats() {
    return { bitsRemaining: this.#bytes.length * 8 - this.#cursor, bitsConsumed: this.#consumed, blocksFetched: this.#blocks };
  }

  nextBits(count) {
    if (!Number.isInteger(count) || count < 1 || count > 32) return Promise.reject(new Error('Bit count must be between 1 and 32.'));
    const operation = this.#tail.then(() => this.#read(count));
    this.#tail = operation.catch(() => {});
    return operation;
  }

  async #read(count) {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      if (this.#cursor === this.#bytes.length * 8) {
        const block = await this.#fetchBlock();
        if (!(block instanceof Uint8Array) || block.length === 0) throw new Error('Invalid random block.');
        this.#bytes = Uint8Array.from(block);
        this.#cursor = 0;
        this.#blocks += 1;
      }
      // Consume bytes in order, most significant bit first. No rewind on failure.
      const bit = (this.#bytes[Math.floor(this.#cursor / 8)] >>> (7 - this.#cursor % 8)) & 1;
      this.#cursor += 1;
      this.#consumed += 1;
      value = value * 2 + bit;
    }
    return value;
  }
}
