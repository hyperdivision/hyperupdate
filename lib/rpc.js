const messages = require('./messages')
const HRPC = require('hrpc-runtime')
const RPC = require('hrpc-runtime/rpc')

const errorEncoding = {
  encode: messages.RPCError.encode,
  encodingLength: messages.RPCError.encodingLength,
  decode (buf, offset) {
    const { message, code, errno, details } = messages.RPCError.decode(buf, offset)
    errorEncoding.decode.bytes = messages.RPCError.decode.bytes
    const err = new Error(message)
    err.code = code
    err.errno = errno
    err.details = details
    return err
  }
}

class HRPCServiceUpdater {
  constructor (rpc) {
    const service = rpc.defineService({ id: 1 })

    this._status = service.defineMethod({
      id: 1,
      requestEncoding: RPC.NULL,
      responseEncoding: messages.StatusResponse
    })

    this._onUpdateStatus = service.defineMethod({
      id: 2,
      requestEncoding: messages.StatusResponse,
      responseEncoding: RPC.NULL
    })

    this._updateAndRelaunch = service.defineMethod({
      id: 3,
      requestEncoding: RPC.NULL,
      responseEncoding: RPC.NULL
    })
  }

  onRequest (context, handlers = context) {
    if (handlers.status) this._status.onrequest = handlers.status.bind(context)
    if (handlers.onUpdateStatus) this._onUpdateStatus.onrequest = handlers.onUpdateStatus.bind(context)
    if (handlers.updateAndRelaunch) this._updateAndRelaunch.onrequest = handlers.updateAndRelaunch.bind(context)
  }

  status () {
    return this._status.request()
  }

  statusNoReply () {
    return this._status.requestNoReply()
  }

  onUpdateStatus (data) {
    return this._onUpdateStatus.request(data)
  }

  onUpdateStatusNoReply (data) {
    return this._onUpdateStatus.requestNoReply(data)
  }

  updateAndRelaunch () {
    return this._updateAndRelaunch.request()
  }

  updateAndRelaunchNoReply () {
    return this._updateAndRelaunch.requestNoReply()
  }
}

module.exports = class HRPCSession extends HRPC {
  constructor (rawSocket, { maxSize = 2 * 1024 * 1024 * 1024 } = {}) {
    super()

    this.rawSocket = rawSocket
    this.rawSocketError = null
    rawSocket.on('error', (err) => {
      this.rawSocketError = err
    })

    const rpc = new RPC({ errorEncoding, maxSize })
    rpc.pipe(this.rawSocket).pipe(rpc)
    rpc.on('close', () => this.emit('close'))
    rpc.on('error', (err) => {
      if ((err !== this.rawSocketError && !isStreamError(err)) || this.listenerCount('error')) this.emit('error', err)
    })

    this.updater = new HRPCServiceUpdater(rpc)
  }

  destroy (err) {
    this.rawSocket.destroy(err)
  }
}

function isStreamError (err) {
  return err.message === 'Writable stream closed prematurely' || err.message === 'Readable stream closed prematurely'
}
