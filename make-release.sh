#! /bin/bash

release="0.2.0";

lein do clean, uberjar;
cp target/cloxp-installer-0.1.0-standalone.jar cloxp-installer.jar;

test -f install.log && rm install.log;
test -d target && rm -rf target;

zip -r "cloxp-$release.zip" *
