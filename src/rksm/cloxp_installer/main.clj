(ns rksm.cloxp-installer.main
  (:require [clojure.java.io :as io]
            [clojure.string :refer [split]]
            [clojure.java.shell :as shell]
            [clojure.repl :as repl])
  (:import (java.io File)
           (java.util.zip ZipInputStream)))


; -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
; settings
; -=-=-=-=-

(def os {:name (System/getProperty "os.name")
         :version (System/getProperty "os.version")
         :arch (System/getProperty "os.arch")})

(defn- os-dispatch
  [{os-name :name :or {os-name ""}}]
  (re-find #"Windows|Mac OS" os-name))

(def ^:dynamic *release-tag* nil)
(def cloxp-dir (-> "." io/file .getCanonicalPath))
(def install-log "install.log")

; -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
; file system helpers
; -=-=-=-=-=-=-=-=-=-=-

(defn copy-file [source-path dest-path]
  (let [source (.getCanonicalFile (io/file source-path))
        dest (.getCanonicalFile (io/file dest-path))]
    (if (.isDirectory source)
      (do
        (-> dest .mkdirs)
        (doseq [child-source (.listFiles source)]
          (let [child-target (io/file dest (.getName child-source))]
            (copy-file child-source child-target))))
      (do
        (-> dest .getParentFile .mkdirs)
        (io/copy source dest)))
    dest))

(defn download [uri file]
  "downloads a file"
  (let [file (.getCanonicalFile (io/file file))]
    (io/copy (io/input-stream uri) file)))

(defn unzip
  "takes a path to a zip file and a target dir. Will unzip all contents of the
  zip to the target"
  [zip-file target-dir]
  (let [target-dir (.getCanonicalFile (io/file target-dir))]
    (.mkdirs target-dir)
    (with-open [stream (ZipInputStream. (io/input-stream zip-file))]
      (loop [entry (.getNextEntry stream)]
        (when entry
          (if-not (.isDirectory entry)
            (let [size (.getSize entry)
                  bytes (byte-array size)
                  data (.read stream bytes 0 size)
                  content (String. bytes "UTF-8")
                  target (io/file (str target-dir File/separator (.getName entry)))]
              (.mkdirs (.getParentFile target))
              (spit target content)))
          (recur (.getNextEntry stream)))))
    target-dir))

; -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
; logging
; -=-=-=-=-

(defn log
  [& msgs]
  (spit install-log (str (apply str msgs) "\n") :append true))

(defn install-error
  [& msgs]
  (let [msgs (conj msgs "error installing cloxp:\n")]
    (apply log msgs)
    (println msgs))
  (future (Thread/sleep 1) (System/exit 1)))

; -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
; system shell
; -=-=-=-=-=-=-

(defn cmd
  [command-string]
  (case (os-dispatch os)
    "Windows" (let [command-string (str "cmd /C " command-string)]
                (apply shell/sh (split command-string #" ")))
    (apply shell/sh (split command-string #" "))))

(defn match-version
  [version-string]
  (if-let [[parsed major minor patch] (re-find #"([0-9]+)\.([0-9]+)\.([0-9]+)" version-string)]
    {:major (read-string major)
      :minor (read-string minor)
      :patch (read-string patch)}))

(defn assert-bin
  [name command & [version-check required-version]]
  (let [{:keys [exit out err]} (cmd command)]
    (when-not (zero? exit)
      (install-error name " does not seem to be installed"))
    (when (and version-check (not (version-check out)))
      (install-error name " does not seem to be installed in the required version " required-version))))

(defn assert-command-succeeds
  ([command]
   (assert-command-succeeds command command))
  ([descr command]
   (let [{:keys [exit out err]} (cmd command)]
     (if-not (zero? exit)
       (install-error "Failure while " descr ": " (or err out))))))

; -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
; install steps
; -=-=-=-=-=-=-=-

(defmulti check-deps os-dispatch)

(defmethod check-deps "Windows"
  [_]
  (println "1. Checking dependencies...")
  (assert-bin "Leiningen" "lein --version")
  (assert-bin "git" "git --version"))

(defmethod check-deps :default
  [_]
  (println "1. Checking dependencies...")
  (assert-bin "Leiningen" "lein --version")
  (assert-bin "node.js" "node --version" (fn [v] (let [{:keys [major]} (match-version v)] (>= major 4))) "v4.x")
  (assert-bin "npm" "npm --version")
  (assert-bin "git" "git --version"))

; -=-=-=-=-

(defmulti install-lively os-dispatch)

(defmethod install-lively "Windows"
  [_]
  (install-lively :default)

  (println "2.1 Installing windows specific files...")
  (copy-file
   (io/file "win" "life_star")
   (io/file "LivelyKernel" "node_modules" "life_star")))

(defmethod install-lively :default
  [_]
  (println "2. Installing LivelyKernel...")

  (-> "./LivelyKernel" io/file .delete)

  (assert-command-succeeds
   "cloning https://github.com/cloxp/LivelyKernel"
   (format
    "git clone --branch cloxp-%s --single-branch https://github.com/cloxp/LivelyKernel"
    *release-tag*))

  (if-not (-> "./LivelyKernel" io/file .isDirectory)
    (install-error "could not install LivelyKernel into " cloxp-dir)))

; -=-=-=-=-

(defmulti install-npm-modules os-dispatch)

(defmethod install-npm-modules "Windows"
  [_]
  (println "3. Installing npm / modules...")

  (println "3.1 Installing nodejs + npm...")

  (case (:arch os)    
    "amd64" (copy-file (io/file "win" "node.x64.exe") (io/file "node.exe"))
    (copy-file (io/file "win" "node.x86.exe") (io/file "node.exe"))
    ;"amd64" (cmd (str "COPY /B " node-exe-64 " node.exe"))
    ;(cmd (str "COPY /B " node-exe " node.exe"))
    )

  (copy-file (io/file "win" "gnuwin32") (io/file "gnuwin32"))
  (copy-file (io/file "win" "node_modules") (io/file "node_modules"))
  (copy-file (io/file "win" "npm.cmd") (io/file "npm.cmd")))

(defmethod install-npm-modules :default
  [_]
  (println "3. Installing npm / modules...")

  (-> "./LivelyKernel/node_modules" io/file .delete)

  (shell/with-sh-dir "./LivelyKernel/"
    (let [{:keys [exit out err]} (cmd "npm install")]
      (when-not (zero? exit)
        (spit install-log (str "npm install stdout:\n" out "\n\nnpm install stderr:\n" err))
        (println "npm install errored!"
                 "In case cloxp doesn't work please try running the installer again."
                 "If it still doesn't work please open an issue at https://github.com/cloxp/cloxp-install/issues/."
                 "The install log can be found in " (.getCanonicalPath (io/file install-log))
                 "Thanks!")))
    (assert-command-succeeds "npm install forever")))

(defn install-partsbin
  []
  (println "4. Installing PartsBin...")
  (-> "./LivelyKernel/PartsBin" io/file .delete)
  (copy-file
   (io/file cloxp-dir "PartsBin")
   (io/file "./LivelyKernel/PartsBin")))

(defn install-assets
  []
  (copy-file
   (io/file cloxp-dir "lively-customizations/localconfig.js")
   (io/file "./LivelyKernel/core/lively/localconfig.js"))
  (copy-file
   (io/file cloxp-dir "assets")
   (io/file "./LivelyKernel/cloxp"))
  (copy-file
   (io/file cloxp-dir "assets/cloxp-logo.jpg")
   (io/file "./LivelyKernel/core/media/cloxp-logo.jpg"))
  (copy-file
   (io/file cloxp-dir "assets/cloxp-logo.png")
   (io/file "./LivelyKernel/core/media/cloxp-logo.png")))

(defn cleanup
  []
  (-> "./LivelyKernel/combined.js" io/file .delete))

; -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

(defn -main
  [release & args]
  (assert release)
  (binding [*release-tag* release]
    (try
      (println "installing cloxp" *release-tag*)
      (spit install-log (str "cloxp installer for " *release-tag* " started " (java.util.Date.)))
      (check-deps os)
      (install-lively os)
      (install-npm-modules os)
      (install-partsbin)
      (install-assets)
      (println "cloxp installation done!")
      (future (Thread/sleep 1) (System/exit 0))
      (catch Exception e
        (do
          (repl/pst *e)
          (install-error (with-out-str (binding [*err* *out*] (repl/pst *e))))))
      (finally (cleanup)))))
