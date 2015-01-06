#! /bin/bash

git submodule update --init --recursive

pushd LivelyKernel

echo -e "INSTALLING NPM MODULES"
npm install

forever_installed=`npm list | grep "forever@" > /dev/null 2>&1`
if [[ -z "$forever_installed" ]]; then
  npm install forever
fi

echo -e "DOWNLOADING PARTSBIN"
node -e "require('./bin/helper/download-partsbin.js')()";

popd
