const { Transform } = require('streamx')
const Rabin = require('rabin-native')

module.exports = class RabinStream extends Transform {
  constructor (opts = {}) {
    super()
    this.rabin = new Rabin(opts.min, opts.max, opts.bits)
    this.overflow = null
  }

  _transform (data, cb) {
    const chunks = this.rabin.push(data)

    if (chunks > 0 && this.overflow !== null) {
      data = Buffer.concat([this.overflow, data])
      this.overflow = null
    }

    this.overflow = data

    for (let i = 0; i < chunks; i++) {
      const len = this.rabin.chunks[i]
      const buf = this.overflow.slice(0, len)
      this.overflow = this.overflow.slice(len)
      this.push(buf)
    }

    cb(null)
  }

  _flush (cb) {
    const chunks = this.rabin.finalise()

    for (let i = 0; i < chunks; i++) {
      const len = this.rabin.chunks[i]
      const buf = this.overflow.slice(0, len)
      this.overflow = this.overflow.slice(len)
      this.push(buf)
    }

    if (this.overflow.length) this.push(this.overflow)
    this.overflow = null

    cb(null)
  }
}
