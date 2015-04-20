# cloxp-install
Install script for cloxp -- a Clojure IDE for explorative and interactive development.

## Installation

Prerequisites are: [java](http://www.oracle.com/technetwork/java/javase/downloads/jdk8-downloads-2133151.html), [leiningen](http://leiningen.org/), [node.js + npm](http://nodejs.org/).

1. Download the latest release: https://github.com/cloxp/cloxp-install/releases
2. Open a terminal.
2. Uncompress: `$ unzip cloxp-install-0.0.7.zip; cd cloxp-install-0.0.7`
3. Install: `$ ./install.sh`
4. Start: `$ ./start.sh`

Cloxp should now be running at [http://localhost:9001/cloxp.html](http://localhost:9001/cloxp.html).

To stop the server press `Ctrl-c`.

### Install notes

On Arch Linux you might have to set the python path for installing when your default python isn't of version 2: `$ PYTHON=python2.7 ./install.sh`

## LICENSE

All code is published under the [MIT license](https://github.com/cloxp/cloxp-install/blob/master/LICENSE).
