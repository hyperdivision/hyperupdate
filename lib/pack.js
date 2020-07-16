const tar = require('tar-fs')

module.exports = function pack (dir) {
  const stream = tar.pack(dir, {
    sort: true,
    map (header) {
      header.mtime = new Date(0)
      return header
    }
  })

  return stream
}
