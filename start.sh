#! /bin/bash

if [[ `uname` == "Darwin" ]]; then
    echo "__________________________________"
    bash -c "sleep 3; open http://localhost:9001/cloxp.html" &
fi

pushd LivelyKernel
node_modules/forever/bin/forever bin/lk-server.js \
  --db-config "{\"enableRewriting\":false}"
popd
