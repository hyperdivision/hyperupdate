const lock = require('fd-lock')
const fs = require('fs')
const { spawn } = require('child_process')

const unpacking = process.argv[2]
const unpacked = process.argv[3]
const appPath = process.argv[4]
const execPath = process.argv[5]
const argv = process.argv.slice(6)

const fd = fs.openSync(unpacking, 'w+')

aquireLock(function () {
  fs.renameSync(unpacked, appPath + '.tmp')
  fs.renameSync(appPath, unpacked)
  fs.renameSync(appPath + '.tmp', appPath)

  spawn(execPath, argv, { stdio: 'ignore', detached: true })
  setTimeout(() => process.exit(0), 100)
})

function aquireLock (cb) {
  if (lock(fd)) return cb()
  setTimeout(aquireLock, 500, cb)
}
