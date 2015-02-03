#! /bin/bash

if [[ ! -d $WORKSPACE_LK ]]; then
  echo -e "This script needs to be run from within Lively!"
  exit 1;
fi

# if [[ ! -d LivelyKernel ]]; then
#   echo -e "No directory `pwd`/LivelyKernel! cloxp not installed?"
#   exit 1;
# fi

cloxp_dir=`pwd`
path="PartsBin/Clojure"

pushd "$WORKSPACE_LK/$path"

names=$(find . -iname "*.metainfo" | sed -E 's/^\.\/(.*)(\.metainfo)/  \1/g')
echo -e "Updating Clojure PartsBin tools: \n$names"
cp * $cloxp_dir/$path/
