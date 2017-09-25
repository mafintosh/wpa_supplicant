# wpa_supplicant

Node.js module to interact with wpa_supplicant using dbus

```
npm install wpa_supplicant
```

[![Build Status](https://travis-ci.org/mafintosh/wpa_supplicant.svg?branch=master)](https://travis-ci.org/mafintosh/wpa_supplicant)

## Usage

``` js
var wpa = require('wpa_supplicant')

// if you do not pass an interface name it'll will try and guess it
var wifi = wpa('wlan0')

wifi.on('ready', function () {
  wifi.scan() // scan once
})

wifi.on('update', function () {
  var cur = wifi.currentNetwork
  console.log('Current network:', cur && cur.ssid)
  console.log('Available networks:')

  wifi.networks.forEach(function (n) {
    console.log(n.ssid + ', ' + n.frequency + ', ' + n.signal)
  })
})
```

## API

#### `var wifi = wpa(interfaceName)`

Create a new instance.
Will connect over dbus to wpa_supplicant, so make sure that, that is running.

If you not specify `interfaceName`, it will try and guess it for you by picking
the first interface that starts with `w`.

#### `wifi.name`

The interface name of the wifi.

#### `wifi.state`

The current state of the wifi.

#### `wifi.driver`

The wifi driver name.

#### `wifi.scanning`

Boolean indicating if the wifi is scanning.

#### `wifi.scan()`

Scan for available wifis.

#### `wifi.on('update')`

Emitted every time state is updated.

#### `wifi.on('ready')`

Emitted when the initial setup has completed and the instance
is ready to use.

#### `wifi.on('error')`

Emitted when there was an critical error.

#### `wifi.on('warning')`

Emitted when there was an non-critical error.

#### `wifi.networks`

List of available wifis. Each item is a network object (see below).

#### `wifi.currentNetwork`

Currently selected network. Also a network object.

#### `network.ssid`

The ssid of the network.

#### `network.frequency`

The frequency of the network in mHz.

#### `network.signal`

The current signal strength of the network.

#### `network.rsn`

The RSN info on the network. Has information about what kind of authentication
the wifi requires.

#### `network.connect([options])`

Connect to the network. Options include

``` js
{
  psk: 'wifi password'
}
```

#### `network.disconnect()`

Disconnect from the network.

## Note

If you get an error on when trying to find the wifi you might
need to run your script as sudo, ymmv.

## License

MIT
