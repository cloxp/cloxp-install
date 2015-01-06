#! /bin/bash

pushd clj-feather/; git reset --hard HEAD; popd;
 git pull --rebase && git submodule update --init -f

./install.sh
