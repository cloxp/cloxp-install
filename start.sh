#! /bin/bash

pushd LivelyKernel
node_modules/forever/bin/forever bin/lk-server.js \
  --db-config "{\"enableRewriting\":false}"
popd
