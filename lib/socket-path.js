const getSocketPath = require('unix-socket-path')
const electron = require('./electron')
const sodium = require('sodium-native')

module.exports = function (name) {
  return getSocketPath(name || hash(Buffer.from(electron.appPath)).toString('hex'))
}

function hash (data) {
  const out = Buffer.alloc(32)
  sodium.crypto_generichash(out, data)
  return out
}
