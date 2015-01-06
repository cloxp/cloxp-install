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
export WORKSPACE_LK=`pwd`
node -e "require('./bin/helper/download-partsbin.js')()";
popd

cp cloxp/cloxp.html LivelyKernel/
cp cloxp/localconfig.js LivelyKernel/core/lively/
cp cloxp/BetterConfig.js LivelyKernel/core/lively/ide/codeeditor/

echo -e "INSTALLED"
