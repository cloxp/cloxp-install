#! /bin/bash

pushd LivelyKernel

forever_installed=`npm list | grep "forever@" > /dev/null 2>&1`
if [[ -z "$forever_installed" ]]; then
  npm install forever
fi

export CLOJURE_FEATHER=`pwd`/clj-feather

node_modules/forever/bin/forever bin/lk-server.js