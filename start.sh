#! /bin/bash


export CLOJURE_FEATHER=`pwd`/clj-feather
export PATH=$CLOJURE_FEATHER:$PATH

pushd LivelyKernel
node_modules/forever/bin/forever bin/lk-server.js
popd
