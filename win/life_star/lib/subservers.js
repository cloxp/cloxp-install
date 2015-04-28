/*global require, module*/

var fs = require('fs'),
    path = require('path'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    domain = require("domain");

// -=-=-=-
// helper
// -=-=-=-

function withRequestDataDo(req, callback) {
  var data = "";
  if (req.streambuffer) {
    req.streambuffer.ondata(function(d) { data += String(d); })
    req.streambuffer.onend(function() { callback(null, data); });
  } else {
    req.on('data', function(d) { data += String(d); })
    req.on('end', function(err) { callback(err, data); });
  }
}

function getFSSubserverModules(subserverHandler) {
  var subserverDir = subserverHandler.config.subserverDirectory;
  if (!subserverDir) return [];
  return fs.readdirSync(subserverDir)
         .filter(function(file) { return (/\.js$/.test(file)) })
         .map(function(file) {
           var name = file.substr(0, file.lastIndexOf('.')),
               path = subserverDir + name,
               route = subserverHandler.baseURL + name + '/';
           return new Subserver({name: name, path: path, route: route, handler: subserverHandler});
         });
}

function getAdditionalSubservers(subserverHandler) {
  var additionalSubservers = subserverHandler.config.additionalSubservers || [],
      baseURL = subserverHandler.baseURL;
    return Object.keys(additionalSubservers).map(function(name) {
        var path = additionalSubservers[name],
            route = baseURL + name + '/';
        return new Subserver({name: name, path: path, route: route, handler: subserverHandler});
    });
}

function runFuncAndRecordNewExpressRoutes(app, func, context) {
  var method, oldRoutes = {};
  for (method in app.routes) { oldRoutes[method] = [].concat(app.routes[method]); }
  // 2) run the function
  func.call(context);
  // 3) find new routes and remember them has belonging to this subserver
  var newRoutes = [];
  for (method in app.routes) {
    app.routes[method].forEach(function(route) {
      if (oldRoutes[method].indexOf(route) === -1) newRoutes.push(route);
    });
  }
  return newRoutes;
}

function removeRouteFromExpressApp(app, route) {
  if (!app) return false;
  var routes = app.routes[route.method],
      idx = routes.indexOf(route);
  if (idx === -1) return false;
  routes.splice(idx, 1);
  return true;
}

// -=-=-=-=-=-=-=-=-=-=-=-
// subserver abastraction
// -=-=-=-=-=-=-=-=-=-=-=-

function Subserver(spec) {
  this.handler = spec.handler;
  this.path = spec.path;
  this.route = spec.route;
  this.myRegisteredRoutes = {};
  var name = this.name = spec.name;
  this.domain = domain.create();
  this.domain.on('error', function(err) {
      console.error('Subserver %s error:', name, err);
  });
}

util.inherits(Subserver, EventEmitter);

Subserver.prototype.start = function(app) {
  var name = this.name, path = this.path, d = this.domain,
      route = this.route, self = this;
  console.log('starting subserver %s on route %s', name, route);
  var newRoutes = runFuncAndRecordNewExpressRoutes(app, function() {
    try {
      var subserverRegisterFunc = d.run(function() { return require(path); });
      if (typeof subserverRegisterFunc !== "function") {
        throw new Error('Subserver module did not return a register function!');
      }
      subserverRegisterFunc(route, app, self);
    } catch(e) { console.error('Error starting subserver: %s\n%s', e, e.stack); }
  }, self);
  self.myRegisteredRoutes = newRoutes;
  // push subserver routes at the start of the route list so they can match
  newRoutes.reverse().forEach(function(route) {
    var routes = app.routes[route.method];
    routes.splice(routes.indexOf(route), 1);
    routes.unshift(route);
  });
};

Subserver.prototype.withSource = function(doFunc) {
  var file = require.resolve(this.path);
  fs.readFile(file, doFunc);
}

Subserver.prototype.setNewSource = function(source, doFunc) {
  var file;
  try {
    file = require.resolve(this.path);
  } catch(e) {
    file = this.path + '.js';
  }
  fs.writeFile(file, source, doFunc);
}

Subserver.prototype.unload = function(app) {
  console.log('unloading subserver %s with route %s', this.name, this.route);
  this.myRegisteredRoutes.forEach(function(route) {
    removeRouteFromExpressApp(app, route);
  });
  var id = require.resolve(this.path);
  delete require.cache[id];
  this.emit('close');
}

Subserver.prototype.del = function(app) {
  var file = require.resolve(this.path);
  fs.unlinkSync(file);
  this.unload(app);
}

// -=-=-=-=-=-=-
// handler class
// -=-=-=-=-=-=-

function SubserverHandler(config) {
  this.config = config || {};
  this.baseURL = config.baseURL || '/nodejs/';
  this.registeredSubservers = {};
}

util.inherits(SubserverHandler, EventEmitter);

SubserverHandler.prototype.getSubserver = function(name) {
  return this.registeredSubservers[name];
}

SubserverHandler.prototype.withSubserver = function(req, res, func, createIfNonExisiting) {
  var name = req.params.name, subserver = this.getSubserver(name), wasCreated = false;
  if (!subserver) {
    if (!createIfNonExisiting) {
      res.status(404).end(JSON.stringify({error: 'subserver not found'}));
      return;
    }
    var lkDir =  process.env.WORKSPACE_LK,
        subserversPath = lkDir && path.join(lkDir, 'core/servers');
    if (!fs.existsSync(subserversPath)) {
      subserversPath = path.join(__dirname, "../subservers/");
    }
    subserver = new Subserver({
      name: name,
      path: path.join(subserversPath, name),
      route: this.baseURL + name + "/",
      handler: this
    });
    wasCreated = true;
  }
  try {
    func.call(this, subserver, wasCreated);
  } catch(e) {
    console.error(e);
    res.status(500).end(String(e));
  }
}

SubserverHandler.prototype.listSubservers = function(req, res) {
  try {
    res.json(Object.keys(this.registeredSubservers));
    res.end();
  } catch(e) {
    res.status(500).end(String(e));
  }
}

SubserverHandler.prototype.unload = function(req, res) {
  this.withSubserver(req, res, function(subserver) {
    if (!this.app) { res.status(500).end({error: 'SubserverHandler has no app'}); return }
    subserver.unload(this.app);
    res.end();
  });
}

SubserverHandler.prototype.deleteSubserver = function(req, res) {
  this.withSubserver(req, res, function(subserver) {
    if (!this.app) { res.status(500).end({error: 'SubserverHandler has no app'}); return }
    subserver.del(this.app);
    delete this.registeredSubservers[subserver.name];
    res.end();
  });
}

SubserverHandler.prototype.getSubserverSource = function(req, res) {
  this.withSubserver(req, res, function(subserver) {
    subserver.withSource(function(err, source) {
      if (err) { res.status(404).end(String(err)); return; }
      res.end(source);
    });
  });
}

SubserverHandler.prototype.setSubserverSource = function(req, res) {
  var handler = this;
  this.withSubserver(req, res, function(subserver, wasCreated) {
    withRequestDataDo(req, function(err, data) {
      if (err) { res.status(500).end(String(err)); console.error(err.stack); return; }
      subserver.setNewSource(data, function(err) {
        if (err) { res.status(500).end(String(err)); console.error(err.stack); return; }
        try {
          if (!wasCreated) subserver.unload(handler.app);
          else handler.registeredSubservers[subserver.name] = subserver;
          subserver.start(handler.app);
          res.status(wasCreated ? 201 : 200).end();
        } catch(e) {
          res.status(500).end(String(e));
        }
      });
    });
  }, true);
}

SubserverHandler.prototype.notSupported = function(req, res) {
  var err = {error: '"' + req.method + ' ' + req.path + '" not supported'};
  res.status(404).end(JSON.stringify(err));
}

SubserverHandler.prototype.registerWith = function(app, server) {
  this.server = server;
  this.app = app;
  // subscribe to server close for cleanup
  var self = this;
  server.on('close', function() { self.close(); })

  // install a controlling interface
  var metaURL = this.baseURL + 'subservers';
  app.post(metaURL + '/:name/unload', this.unload.bind(this));
  app.get(metaURL + '/:name', this.getSubserverSource.bind(this));
  app.put(metaURL + '/:name', this.setSubserverSource.bind(this));
  app.del(metaURL + '/:name', this.deleteSubserver.bind(this));
  app.get(metaURL, this.listSubservers.bind(this));

  // load and start the subservers
  getFSSubserverModules(this).concat(getAdditionalSubservers(this)).forEach(function(subserver) {
    subserver = this.registeredSubservers[subserver.name] || subserver;
    this.registeredSubservers[subserver.name] = subserver;
    subserver.start(app);
  }, this);

  // 404 for all other routes
  app.all(this.baseURL + '*', this.notSupported.bind(this));
}

SubserverHandler.prototype.close = function() {
  for (var name in this.registeredSubservers) {
    this.registeredSubservers[name].unload();
  }
  this.emit('close');
}

// -=-=-=-
// exports
// -=-=-=-

exports.SubserverHandler = SubserverHandler;
