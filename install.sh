#! /bin/bash

# git submodule update --init --recursive

pushd LivelyKernel

# -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

echo -e "INSTALLING NPM MODULES"
rm -rf node_modules
npm install

forever_installed=`npm list | grep "forever@" > /dev/null 2>&1`
if [[ -z "$forever_installed" ]]; then
  npm install forever
fi

# -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

echo -e "DOWNLOADING PARTSBIN"
export WORKSPACE_LK=`pwd`
node -e "require('./bin/helper/download-partsbin.js')()";

touch core/lively/Base.js # force combined modules to re-generate

pushd PartsBin/

pushd Clojure/;
rm *;
wget http://lively-web.org/PartsBin/Clojure/ClojureBrowser.{html,json,metainfo};
wget http://lively-web.org/PartsBin/Clojure/ClojureController.{html,json,metainfo};
wget http://lively-web.org/PartsBin/Clojure/ClojarsBrowser.{html,json,metainfo};
wget http://lively-web.org/PartsBin/Clojure/ProjectController.{html,json,metainfo};
popd # Clojure

pushd Basic
rm SVGPathMorph*
rm PolygonMaker*
rm PathMaker*
popd # Basic

find . -type d -maxdepth 1 \
  | egrep -v "Clojure|Basic|Dialogs|Documentation|DroppableBehaviors|ElProfesor|Fun|Inputs|Tools|Widgets|Wiki|Debugging" \
  | xargs rm -rf

popd # PartsBin

popd # LivelyKernel

# -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

echo -e "MOVING LIVELY CUSTOMIZATIONS IN PLACE"

cp cloxp/localconfig.js LivelyKernel/core/lively/
cp cloxp/EmacsConfig.js LivelyKernel/core/lively/ide/codeeditor/

echo -e "INSTALLATION DONE"
