var dbus = require('dbus')
var events = require('events')
var util = require('util')
var os = require('os')
var thunky = require('thunky')

var SERVICE = 'fi.w1.wpa_supplicant1'

module.exports = WiFi

function WiFi (name) {
  if (!(this instanceof WiFi)) return new WiFi(name)
  events.EventEmitter.call(this)

  this.bus = dbus.getBus('system')
  this.interface = name || getWlanName()
  this.networks = []
  this.currentNetwork = null
  this.state = null
  this.scanning = false
  this.driver = null
  this.ready = thunky(open)

  this._inited = false
  this._networksByPath = {}

  var self = this

  this.ready()

  function open (cb) {
    self._ready(function (err) {
      if (err) {
        self.emit('error', err)
        return cb(err)
      }

      self.emit('ready')
      self.emit('update')

      cb(null)
    })
  }
}

util.inherits(WiFi, events.EventEmitter)

WiFi.prototype.clear = function (cb) {
  if (!cb) cb = noop

  var self = this

  this.ready(function (err) {
    if (err) return cb(err)
    self._obj.RemoveAllNetworks(cb)
  })
}

WiFi.prototype.scan = function (opts, cb) {
  if (typeof opts === 'function') return this.scan(null, opts)
  if (!opts) opts = {}
  if (!cb) cb = noop

  var self = this
  var type = opts.type || 'active'

  this.ready(function (err) {
    if (err) return cb(err)
    self._obj.getProperty('Scanning', function (err, scanning) {
      if (err) return cb(err)
      if (scanning) return cb()

      self._obj.Scan({Type: type}, function (err) {
        if (err) return cb(err)
        cb()
      })
    })
  })
}

WiFi.prototype._ready = function (cb) {
  if (!cb) cb = noop

  var self = this
  getInterface(this.bus, this.interface, function (err, obj) {
    if (err) return cb(err)
    self._obj = obj
    self._init(cb)
  })
}

WiFi.prototype._init = function (cb) {
  var self = this

  this._getResults(function (err) {
    if (err) return cb(err)

    self._obj.getProperty('CurrentBSS', function (err, path) {
      if (err) return cb(err)

      var c = self._networksByPath[path]
      if (c) self.currentNetwork = c

      self._obj.getProperty('Scanning', function (err, scanning) {
        if (err) return cb(err)

        self.scanning = scanning
        self._obj.getProperty('Driver', function (err, driver) {
          if (err) return cb(err)

          self.driver = driver
          self._obj.getProperty('State', function (err, state) {
            if (err) return cb(err)

            self.state = state
            self._inited = true
            cb(null)
          })
        })
      })
    })
  })

  this._obj.on('PropertiesChanged', function (props) {
    if (typeof props.Scanning === 'boolean') self.scanning = props.Scanning
    if (props.State) self.state = props.State

    if (props.CurrentBSS) {
      var c = self._networksByPath[props.CurrentBSS]
      if (c) self.currentNetwork = c
    }

    self.emit('update')
  })

  this._obj.on('ScanDone', function () {
    self._getResults(onscan)
  })

  function onscan (err) {
    if (err) return onupdate(err)
    emit('scan-done')
    onupdate(null)
  }

  function onupdate (err) {
    if (err) return emit('warning', err)
    emit('update')
  }

  function emit (name, val) {
    if (self._inited) self.emit(name, val)
  }
}

WiFi.prototype._getNetwork = function (o) {
  for (var i = 0; i < this.networks.length; i++) {
    var n = this.networks[i]
    if (n.objectPath === o) return n
  }

  return new Network(this.bus, this._obj, o)
}

WiFi.prototype._getResults = function (cb) {
  var self = this

  this._obj.getProperty('BSSs', function (err, list) {
    if (err) return cb(err)

    var networks = []
    var networksByPath = {}

    loop(null, null)

    function done () {
      for (var i = 0; i < networks.length; i++) {
        networksByPath[networks[i].objectPath] = networks[i]
      }

      self.networks = networks.sort(bySsid)
      self._networksByPath = networksByPath
      cb()
    }

    function loop (err, network) {
      if (err) return cb(err)

      if (network) networks.push(network)
      if (!list.length) return done()

      updateNetwork(list.shift(), loop)
    }

    function updateNetwork (o, cb) {
      var n = self._getNetwork(o)
      n._update(function (err) {
        if (err) return cb(err)
        cb(null, n)
      })
    }
  })
}

function Network (bus, iface, objectPath) {
  this.objectPath = objectPath
  this.ssid = null
  this.bssid = null
  this.rsn = null
  this.frequency = 0
  this.signal = 0
  this.age = 0
  this.added = false

  this._bus = bus
  this._bss = null
  this._iface = iface
  this._networkPath = null
}

Network.prototype.add = function (opts, cb) {
  if (typeof opts === 'function') return this.add(null, opts)
  if (!cb) cb = noop
  if (!opts) opts = {}

  var self = this

  opts.ssid = this.ssid
  opts.frequency = this.frequency
  if (!opts.psk) opts.key_mgmt = 'NONE'

  this._iface.AddNetwork(opts, function (err, o) {
    if (o) self._networkPath = o
    cb(err)
  })
}

Network.prototype.select = function (opts, cb) {
  if (typeof opts === 'function') return this.select(null, opts)
  if (!opts) opts = {}

  var self = this

  if (this._networkPath) onadd(null)
  else this.add(opts, onadd)

  function onadd (err) {
    if (err) return cb(err)
    self._iface.SelectNetwork(self._networkPath, cb)
  }
}

Network.prototype.remove = function (cb) {
  if (!cb) cb = noop

  this._iface.RemoveNetwork(function (err) {
    cb(err)
  })
}

Network.prototype.connect = function (opts, cb) {
  if (typeof opts === 'function') return this.connect(null, opts)
  if (!cb) cb = noop
  if (!opts) opts = {}
  if (typeof opts === 'string') opts = {psk: opts}

  var self = this

  this.select(opts, function (err) {
    if (err) return cb(err)
    self._iface.Reconnect(cb)
  })
}

Network.prototype.disconnect = function (cb) {
  var self = this

  this.select(function (err) {
    if (err) return cb(err)
    self._iface.Disconnect(cb)
  })
}

Network.prototype._update = function (cb) {
  var self = this
  var iface = 'fi.w1.wpa_supplicant1.BSS'

  this._bus.getInterface(SERVICE, this.objectPath, iface, function (err, bss) {
    if (err) return cb(err)
    self._bss = bss
    populateNetworkInfo(bss, self, cb)
  })
}

function getWlanName () {
  var names = Object.keys(os.networkInterfaces())
  for (var i = 0; i < names.length; i++) {
    if (names[i][0] === 'w') return names[i]
  }
  return 'wlan0'
}

function noop () {}

function populateNetworkInfo (s, result, cb) {
  var missing = 0
  var error = null

  s.getProperty('SSID', set('ssid', toString))
  s.getProperty('BSSID', set('bssid', toBuffer))
  s.getProperty('RSN', set('rsn', mapRSN))
  s.getProperty('Frequency', set('frequency'))
  s.getProperty('Signal', set('signal'))
  s.getProperty('Age', set('age'))

  function set (key, parse) {
    missing++
    return function (err, val) {
      if (error) error = err
      result[key] = parse ? parse(val) : val
      if (--missing) return
      cb(error)
    }
  }
}

function mapRSN (obj) {
  return {
    keyManagement: obj.KeyMgmt,
    pairwise: obj.Pairwise,
    group: obj.Group,
    managementGroup: obj.MgmtGroup
  }
}

function toString (arr) {
  return trimBuffer(Buffer.from(arr)).toString('utf-8')
}

function toBuffer (arr) {
  return Buffer.from(arr)
}

function bySsid (a, b) {
  var cmp = a.ssid.localeCompare(b.ssid)
  if (!cmp) return a.frequency - b.frequency
  return cmp
}

function trimBuffer (buf) {
  var ptr
  for (ptr = 0; ptr < buf.length; ptr++) {
    if (buf[ptr]) break
  }
  if (ptr) buf = buf.slice(ptr)
  for (ptr = buf.length - 1; ptr >= 0; ptr--) {
    if (buf[ptr]) break
  }
  if (buf.length - 1 !== ptr) buf = buf.slice(0, ptr)
  return buf
}

function getInterface (bus, name, cb) {
  var s = 'fi.w1.wpa_supplicant1'
  var o = '/fi/w1/wpa_supplicant1'
  var i = 'fi.w1.wpa_supplicant1'

  bus.getInterface(s, o, i, oniface)

  function oniface (err, s) {
    if (err) return cb(err)

    s.CreateInterface({Ifname: name}, function (_, res) {
      if (res) return onpath(null, res)
      s.GetInterface(name, onpath)
    })
  }

  function onpath (err, p) {
    if (err) return cb(err)
    bus.getInterface(s, p, 'fi.w1.wpa_supplicant1.Interface', cb)
  }
}
