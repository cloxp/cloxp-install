#! /bin/bash

cloxp_dir=`pwd`
# -=-=-=-=-=-=-=-=-=-=-=-
# 1. Check dependencies
# -=-=-=-=-=-=-=-=-=-=-=-

echo -e "Checking dependencies..."

function install_error {
  echo -e "Error installing cloxp:"
  echo -e "  $1"
  exit 1
}

res=$(java -version 2>&1 $> /dev/null)
[[ $? -ne 0 ]] && install_error "Java does not seem to be installed."

res=$(lein --version)
[[ $? -ne 0 ]] && install_error "Leiningen does not seem to be installed."

res=$(node --version)
[[ $? -ne 0 ]] && install_error "node.js does not seem to be installed."

res=$(npm --version)
[[ $? -ne 0 ]] && install_error "npm does not seem to be installed."


# -=-=-=-=-=-=-=-=-=-
# 2. Install Lively
# -=-=-=-=-=-=-=-=-=-

echo -e "Installing LivelyKernel..."

git clone --branch clojure-support \
  --single-branch \
  https://github.com/LivelyKernel/LivelyKernel

pushd LivelyKernel

# -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

echo -e "  Installing npm modules..."
rm -rf node_modules
res=$(npm install 2>&1 >npm-install.log)

if [[ $? -ne 0 ]]; then
    log=`cat npm-install.log`;
    install_error "npm install failed! $log"
fi



forever_installed=$(npm list | grep "forever@" > /dev/null 2>&1)
if [[ -z "$forever_installed" ]]; then
    npm install forever
    res=$(npm install forever 2>&1 >npm-install.log)
    if [[ $? -ne 0 ]]; then
        log=`cat npm-install.log`;
        install_error "npm forever install failed! $log"
    fi
fi

# -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

echo -e "  installing PartsBin..."
[[ -d PartsBin ]] && rm -rf PartsBin;
cp -r "$cloxp_dir/PartsBin" PartsBin;

# -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

echo -e "  installing lively customizations..."

cp $cloxp_dir/lively-customizations/localconfig.js core/lively/

cp -r $cloxp_dir/assets ./cloxp

touch core/lively/Base.js # force combined modules to re-generate

popd # LivelyKernel

echo -e "installation done"
