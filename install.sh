#! /bin/bash

release_tag="pre-0.0.8"
cloxp_dir=`pwd`
install_log="install.log"
echo -e "cloxp install started `date`" > $install_log

# -=-=-=-=-=-=-=-=-=-=-=-
# 1. Check dependencies
# -=-=-=-=-=-=-=-=-=-=-=-

echo -e "Checking dependencies..."

function install_error {
  echo -e "Error installing cloxp:"
  echo -e "  $1"
  exit 1
}

res=$(java -version 2>&1 >>"$install_log")
[[ $? -ne 0 ]] && install_error "Java does not seem to be installed."

res=$(lein --version 2>&1 >>"$install_log")
[[ $? -ne 0 ]] && install_error "Leiningen does not seem to be installed."

res=$(node --version 2>&1 >>"$install_log")
[[ $? -ne 0 ]] && install_error "node.js does not seem to be installed."

res=$(npm --version 2>&1 >>"$install_log")
[[ $? -ne 0 ]] && install_error "npm does not seem to be installed."

# -=-=-=-=-=-=-=-=-=-
# 2. Install Lively
# -=-=-=-=-=-=-=-=-=-

echo -e "Installing LivelyKernel..."

res=$(git clone --branch cloxp-$release_tag \
          --single-branch \
          https://github.com/cloxp/LivelyKernel \
      2>&1 >>"$install_log")

# if [[ $? -ne 0 ]]; then
#     log=`cat npm-install.log`;
#     install_error "git cloning LivelyKernel failed! $log"
# fi

if [[ ! -d LivelyKernel ]]; then
    log=`cat npm-install.log`;
    install_error "could not install LivelyKernel into `pwd`! $log"
fi


pushd LivelyKernel

# -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

echo -e "  Installing npm modules..."
rm -rf node_modules
res=$(npm install 2>&1 >>"$install_log")

if [[ $? -ne 0 ]]; then
    echo -e "npm install had errors! In case cloxp doesn't work please try running install.sh again. If it still doesn't work please open an issue at https://github.com/cloxp/cloxp-install/issues/ with the install log: $install_log. Thanks!"
    # log=`cat "$install_log"`;
    # install_error "npm install failed! $log"
fi

forever_installed=$(npm list | grep "forever@" > /dev/null 2>&1)
if [[ -z "$forever_installed" ]]; then
    res=$(npm install forever 2>&1 >>"$install_log")
    if [[ $? -ne 0 ]]; then
        log=`cat "$install_log"`;
        install_error "npm forever install failed! $log"
    fi
fi

# -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

echo -e "  installing PartsBin..."
[[ -d PartsBin ]] && rm -rf PartsBin;
cp -r "$cloxp_dir/PartsBin" PartsBin;

# -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

echo -e "  installing lively customizations..."

cp "$cloxp_dir/lively-customizations/localconfig.js" core/lively/

cp -r "$cloxp_dir/assets" ./cloxp
cp -r "$cloxp_dir/assets/cloxp-logo.jpg" ./core/media
cp -r "$cloxp_dir/assets/cloxp-logo.png" ./core/media

touch core/lively/Base.js # force combined modules to re-generate
test -f combined.js && rm combined.js

popd # LivelyKernel

echo -e "installation done"
