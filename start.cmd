set PATH=%cd%;%cd%\gnuwin32\bin;%PATH%
cd LivelyKernel
node bin\lk-server.js --lk-dir %cd% --db-config "{\"enableRewriting\":false}"
