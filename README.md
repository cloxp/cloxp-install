# cloxp-install

[cloxp -- a Clojure IDE for explorative and interactive development](http://cloxp.github.io/).

Run the live web version without install: [cloxp.lively-next.org]()

Or use this install script for setting cloxp up locally.

## Installation

### Mac OS and Linux

Prerequisites are: [git](http://git-scm.com/download), [java](http://www.oracle.com/technetwork/java/javase/downloads/), [leiningen](http://leiningen.org/), [node.js version >=4](http://nodejs.org/).

1. Download the latest release: https://github.com/cloxp/cloxp-install/releases/
2. Open a terminal.
2. Uncompress: `$ unzip cloxp-0.2.0.zip; cd cloxp-0.2.1`
3. Install: `$ ./install.sh`
4. Start: `$ ./start.sh`

Cloxp should now be running at [http://localhost:9001/cloxp.html](http://localhost:9001/cloxp.html).

To stop the server press `Ctrl-c`.

### Windows

Prerequisites are: [git](http://git-scm.com//download), [java](http://www.oracle.com/technetwork/java/javase/downloads/jdk8-downloads-2133151.html), [leiningen](http://leiningen.org/).

1. Download the latest release: https://github.com/cloxp/cloxp-install/releases/
2. Uncompress the zip file, e.g. cloxp-pre-0.0.8.zip
2. Open a command line on the uncompressed folder.
3. Install: `$ install.cmd`
4. Start: `$ start.cmd`

### Docker

A docker setup is available:
[cloxp/cloxp-docker](https://github.com/cloxp/cloxp-docker). Prerequisites: [docker](https://docs.docker.com/), a docker supported VM like [virtualbox](https://www.virtualbox.org/wiki/Downloads). It should work on all platforms that support docker.


#### Install notes

On Arch Linux you might have to set the python path for installing when your default python isn't of version 2: `$ PYTHON=python2.7 ./install.sh`.

## LICENSE

All code is published under the [MIT license](https://github.com/cloxp/cloxp-install/blob/master/LICENSE).
