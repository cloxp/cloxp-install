#! /bin/bash


pushd LivelyKernel/PartsBin/Clojure

echo -e "Updating clojure tools..."
rm *;
wget http://lively-web.org/PartsBin/Clojure/ClojureBrowser.{html,json,metainfo};
wget http://lively-web.org/PartsBin/Clojure/ClojureController.{html,json,metainfo};
wget http://lively-web.org/PartsBin/Clojure/ClojarsBrowser.{html,json,metainfo};
wget http://lively-web.org/PartsBin/Clojure/ProjectController.{html,json,metainfo};
