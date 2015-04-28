/*global require, module*/
var lang             = require('lively.lang'),
    express          = require('express'),
    morgan           = require('morgan'),
    LivelyFsHandler  = require('lively-davfs/request-handler'),
    log4js           = require('log4js'),
    proxy            = require('./lib/proxy'),
    testing          = require('./lib/testing'),
    auth             = require('./lib/auth'),
    SubserverHandler = require('./lib/subservers').SubserverHandler,
    ManifestHandler  = require('./lib/manifest').ManifestHandler,
    lfUtil           = require('./lib/util'),
    util             = require('util'),
    fs               = require('fs'),
    path             = require('path'),
    EventEmitter     = require('events').EventEmitter

var serverSetup = module.exports = function(config, thenDo) {

  config.host                = config.host || "localhost";
  config.port                = config.port || 9001;
  config.srvOptions          = config.srvOptions || {node: config.fsNode || "../LivelyKernel/"};
  config.logLevel            = config.logLevel || "debug";
  config.enableTesting       = config.enableTesting;
  config.sslServerKey        = config.sslServerKey;
  config.sslServerCert       = config.sslServerCert;
  config.sslCACert           = config.sslCACert;
  config.enableSSL           = config.enableSSL && config.sslServerKey && config.sslServerCert && config.sslCACert;
  config.enableSSLClientAuth = config.enableSSL && config.enableSSLClientAuth;
  config.behindProxy         = config.behindProxy || false;
  config.subservers          = config.subservers || {};
  config.subserverDirectory  = config.subserverDirectory || __dirname  + "/subservers/";
  config.useManifestCaching  = config.useManifestCaching || false;
  config.cors                = config.hasOwnProperty("cors") ? config.cors : true;
  config.authConf            = config.hasOwnProperty("authConf") ? config.authConf : {};

  var app = express(), server, logger;

  thenDo = lang.fun.once(thenDo || function() {});

  lang.fun.composeAsync(
    extendServerSetupFunction,
    createServer,
    createNodejsLivelyInterface,
    setupBehindProxy,
    setupCORS,
    setupStreamBuffers,
    setupBodyParser,
    setupCookies,
    setupHTTPLogger,
    setupSSLCertHandler,
    setupAuthHandler,
    setupProxyServer,
    setupTestServer,
    setupSubserverHandler,
    setupManifestCacheHandler,
    setupResourceDatabaseAndFileSystemHandler,
    startHTTPListener
  )(function(err) {
    if (err) {
      console.error("Error starting life_star: %s", err);
      thenDo(err);
    } else {
      server.once('listening', function() { thenDo(err, server); });
    }
  });

  return server;

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // server setup steps below

  function extendServerSetupFunction(next) {
    // make it an event emitter so that life_star users can receive server
    // related events. Events are emitted in startHTTPListener()
    util._extend(serverSetup, EventEmitter.prototype);
    EventEmitter.call(serverSetup);
    
    serverSetup.getServer = function() { return server; };
    serverSetup.getApp = function() { return app; };
    next();
  }

  function createNodejsLivelyInterface(next) {
    // some helpers, mainly for interactive usage
    if (typeof global.lively === "undefined") global.lively = {};
    var lv = global.lv = global.lively;
    util._extend(lv, {
      server: {
        dir: __dirname,
        get lifeStar() { return server; },
        get app() { return app; }
      }
     });
    next();
  }

  function createServer(next) {
    if (config.enableSSL) {
      var https = require('https'),
          options = {
            // Specify the key and certificate file
            key: fs.readFileSync(config.sslServerKey),
            cert: fs.readFileSync(config.sslServerCert),
            // Specify the Certificate Authority certificate
            ca: fs.readFileSync(config.sslCACert),
  
            // This is where the magic happens in Node. All previous steps simply
            // setup SSL (except the CA). By requesting the client provide a
            // certificate, we are essentially authenticating the user.
            requestCert: config.enableSSLClientAuth,
  
            // If specified as "true", no unauthenticated traffic will make it to
            // the route specified.
            rejectUnauthorized: config.enableSSLClientAuth
          };
      server = require('https').createServer(options, app);
    } else {
      server = require('http').createServer(app);
    }
    server.config = config;
    next();
  }

  function setupBehindProxy(next) {
    // express specifically handles the case of sitting behind a proxy, see
    // http://expressjs.com/guide.html#proxies
    if (config.behindProxy) app.enable('trust proxy');
    next();
  }

  function setupCORS(next) {
    if (config.cors) {
      console.log('Lively server started with cross origin resource sharing (CORS) enabled.');
      app.use(function cors(req, res, next) {
        var allowedHeaders = req.header("Access-Control-Request-Headers"), // allow all headers by default
            allowedMethods = "POST,OPTIONS,GET,HEAD,DELETE,PROPFIND,PUT,PROPPATCH,COPY,MOVE,REPORT";
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', allowedMethods);
        allowedHeaders && res.header('Access-Control-Expose-Headers', allowedHeaders);
        allowedHeaders && res.header('Access-Control-Allow-Headers', allowedHeaders);
        res.header('Access-Control-Allow-Credentials', 'true');
        next();
      });
    }
    next();
  }

  function setupStreamBuffers(next) {
    
    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=
    // dealing with request content
    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=
    function installStreambuffer(req) {
      // to learn about the rationale of this funny hack see
      // https://github.com/LivelyKernel/node-lively-davfs/blob/7f8082bceaf7851b5152d672a98ca55c399b944d/jsDAV-plugin.js#L31
  
      function invokeCb(cb, arg) {
        try { cb.call(null, arg); } catch (e) {
          console.log("life_star streambuffer callback error: ", e);
        }
      }
  
      function dataHandler(d) {
        if (data) data = Buffer.concat([data, d]);
        else data = d;
        streamBufferDataHandlers.forEach(function(ea) { invokeCb(ea, d) });
      }
  
      function endHandler() {
        done = true;
        streamBufferEndHandlers.forEach(function(ea) { invokeCb(ea) });
        streamBufferDataHandlers = [];
        streamBufferEndHandlers = [];
      }
  
      var done = false, data = null,
        streamBufferDataHandlers = [],
        streamBufferEndHandlers = [];
  
      if (req.streambuffer) {
        var origStreambuffer = req.streambuffer;
        origStreambuffer.ondata(dataHandler);
        origStreambuffer.onend(endHandler);
      } else {
        req.on("data", dataHandler);
        req.on('end', endHandler);
      }
  
      req.streambuffer = {
        ondata: function(cb) {
          if (done) invokeCb(cb, data);
          else {
            if (data) invokeCb(cb, data);
            streamBufferDataHandlers.push(cb);
          }
        },
        onend: function(cb) {
          if (done) invokeCb(cb);
          else streamBufferEndHandlers.push(cb);
        }
      }
    }
    app.use(function(req,res,next) {
      if (req.method === 'PUT') installStreambuffer(req);
      next();
    });

    next();
  }

  function setupBodyParser(next) {
    app.use(express.bodyParser({limit: '150mb'}));
    next();
  }
  
  function setupCookies(next) {
    app.use(express.cookieParser());
  
    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // store auth information into a cookie
    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    app.use(express.cookieSession({
      key: 'livelykernel-sign-on',
      secret: 'foo',
      proxy: config.behindProxy,
      cookie: {path: '/', httpOnly: false, maxAge: null}
    }));
    next();
  }

  function setupHTTPLogger(next) {
    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // set up logger, proxy and testing routes
    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    logger = log4js.getLogger();
    logger.setLevel((config.logLevel || 'OFF').toUpperCase());
    morgan.token('user', function(req, res) { return (req.session && req.session["lvUserData_2013-10-12"] && req.session["lvUserData_2013-10-12"].username) || 'unknown user'; });
    morgan.token('email', function(req, res) { return (req.session && req.session["lvUserData_2013-10-12"] && req.session["lvUserData_2013-10-12"].email) || ''; });
    // default format:
    // ':remote-addr - :remote-user [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"',
    morgan.lkFormat = morgan.combined.replace('":method', '":user <:email>" ":method');
    app.use(morgan('lkFormat',{
      skip: function (req, res) {
        return req.url.indexOf("/nodejs/LogServer") === 0
            || req.url.indexOf("/nodejs/ObjectRepositoryServer/?getRecords") === 0
            || req.url.indexOf("/uvic-login?redirect=") === 0;
      }
    }));
    next();
  }

  function setupSSLCertHandler(next) {
    // -=-=-=-=-=-=-=-=-=-=-=-=-
    // deal with authentication
    // -=-=-=-=-=-=-=-=-=-=-=-=-
    if (config.behindProxy) {
      app.use(auth.extractApacheClientCertHeadersIntoSession);
    }
    next();
  }

  function setupAuthHandler(next) {
    // -=-=-=-=-=-=-=-=-=-=-
    // auth handler
    // -=-=-=-=-=-=-=-=-=-=-
    if (typeof config.authConf === 'string')
      config.authConf = JSON.parse(config.authConf);
    if (!config.authConf || !config.authConf.enabled) next();
    else {
      lfUtil.npmInstall("life_star-auth", __dirname, function(err) {
        if (err) next(err);
        else {
          var AuthHandler = require('life_star-auth').HTTPHandler;
          server.authHandler = new AuthHandler(config.authConf).registerWith(app, server);
          next();
        }
      });
    }
  }

  function setupProxyServer(next) {
    // -=-=-=-=-=-=-
    // Proxy routes
    // -=-=-=-=-=-=-
    var proxyHandler = proxy(logger);
    function extractURLFromProxyRequest(req) {
      // example: /proxy/localhost:5984/test/_all_docs?limit=3
      //       => http://localhost:5984/test/_all_docs?limit=3
      return req.protocol + '://' + req.url.slice('/proxy/'.length);
    }
    app.all(/\/proxy\/(.*)/, function(req, res) {
      var url = extractURLFromProxyRequest(req);
      proxyHandler[req.method.toLowerCase()](url, req, res);
    });
    next();
  }

  function setupTestServer(next) {
    // -=-=-=-=-=-
    // test server
    // -=-=-=-=-=-
    if (config.enableTesting) testing(app, logger);
    next();
  }

  function setupSubserverHandler(next) {
    // -=-=-=-=-=-=-=-
    // setup subserver
    // -=-=-=-=-=-=-=-
    new SubserverHandler({
      baseURL: '/nodejs/',
      subserverDirectory: config.subserverDirectory,
      additionalSubservers: config.subservers
    }).registerWith(app, server);
    next();
  }

  function setupManifestCacheHandler(next) {
    // -=-=-=-=-=-=-=-=-=-=-
    // manifest file related
    // -=-=-=-=-=-=-=-=-=-=-
    if (config.useManifestCaching) {
      var manifestHandler = new ManifestHandler(config);
      manifestHandler.registerWith(app, server);
      app.all(/.*/, function fileHandler(req, res, next) {
        if (req.url.match(/\?\d+/)) {
          req.url = req.url.replace(/\?.*/, ''); // only the bare file name
        }
        manifestHandler.addManifestRef(req, res);
        next();
      });
    }
    next();
  }

  function setupResourceDatabaseAndFileSystemHandler(next) {
    // -=-=-=-=-=--=-=-=-=-=--=-=-=-
    // set up file system connection
    // -=-=-=-=-=--=-=-=-=-=--=-=-=-
    var dbConf = { // defaults
        enableVersioning: true,
        enableRewriting: true,
        // Modules necessary modules for world load, the rest is rewritten onLoad
        bootstrapRewriteFiles: [ // 'core/lively/bootstrap.js', 'core/lib/lively-libs-debug.js', 'core/lib/escodegen.browser.js',
          'core/lively/Migration.js', 'core/lively/JSON.js', 'core/lively/lang/Object.js', 'core/lively/lang/Function.js', 'core/lively/lang/String.js',
          'core/lively/lang/Array.js', 'core/lively/lang/Number.js', 'core/lively/lang/Date.js', 'core/lively/lang/Worker.js', 'core/lively/lang/LocalStorage.js',
          'core/lively/defaultconfig.js', 'core/lively/Base.js', 'core/lively/ModuleSystem.js', 'core/lively/Traits.js', 'core/lively/DOMAbstraction.js',
          'core/lively/IPad.js', 'core/lively/LogHelper.js', 'core/lively/localconfig.js', // FIXME: + user configs ?
          // bootstrap.js
          'core/lively/lang/Closure.js',
          'core/lively/bindings.js', 'core/lively/bindings/Core.js',
          'core/lively/Main.js', 'core/lively/persistence/Serializer.js'
          // directly neccessary for debugging BUT excluded for now:
          // 'core/lively/ast/Debugging.js', 'core/lively/ast/AcornInterpreter.js', 'core/lively/ast/Rewriting.js', 'core/lively/ast/AstHelper.js',
          // 'core/lively/ast/acorn.js', 'core/lively/ast/StackReification.js'
        ],
        fs: config.srvOptions.node,
        excludedDirectories: ['.svn', '.git', 'node_modules'],
        excludedFiles: [/.*\.sqlite/, /.*\.gz/, '.DS_Store', 'combined.js'],
        includedFiles: [/\.(cmd|conf|css|diff|el|html|ini|js|json|md|mdown|metainfo|patch|r|snippets|st|txt|xhtml|xml|yml)$/i],
        dbFile: path.join(config.fsNode || '', "objects.sqlite"),
        resetDatabase: false
    };
    if (config.dbConf) {
        if (typeof config.dbConf === 'string')
            config.dbConf = JSON.parse(config.dbConf);
        util._extend(dbConf, config.dbConf);
    }
    var fsHandler = new LivelyFsHandler(dbConf).registerWith(app, server);
    global.lively.server.repository = fsHandler.repository;
    app.all(/.*/, fsHandler.handleRequest.bind(fsHandler));
    next();
  }

  function startHTTPListener(next) {
    // -=-=-=-=-
    // GO GO GO
    // -=-=-=-=-
    server.on('listening', function() {
      console.log("life_star running");
      serverSetup.emit('start', server);
    });
    server.on('close', function() { serverSetup.emit('close'); });
  
    server.listen(config.port);
    next();
  }

};
