lively.Config.set('maxStatusMessages', 10);
lively.Config.add('modulesOnWorldLoad', "lively.ide.codeeditor.EmacsConfig");
lively.Config.set('isPublicServer', true);

// -=-=-=-=-=-=-
// code editor
// -=-=-=-=-=-=-
if (typeof process === "undefined") { // FIXME!
    lively.whenLoaded(function() { lively.Config.set('defaultTabSize', 2); });
    if (lively.LocalStorage.get("useEmacsyKeys") === null)
        lively.Config.set("useEmacsyKeys", true);
}

// -=-=-=-
// cloxp
// -=-=-=-
cloxpConnect();

window.cloxpConnect = lively.cloxpConnect = cloxpConnect;

function cloxpConnect(thenDo) {
  var port = lively.Config.cookie && Number(lively.Config.cookie["cloxp-assignment"]);
  if (!port) return thenDo && thenDo();

  lively.Config.set("nodeJSWebSocketURL", 'http://lively-web.org:' + port + '/nodejs');
  if (typeof $world !== "undefined") $world.setCurrentUser("cloxp-user-" + port);
  else lively.Config.set("UserName", "cloxp-user-" + port);

  if (!lively.lang.Path("lively.morphic.World.currentWorld").get(window)) {
    lively.require("lively.net.SessionTracker").toRun(function() {
      lively.net.SessionTracker.start(thenDo); });
  } else {
    lively.net.SessionTracker.resetSession();
    var s = lively.net.SessionTracker.getSession();
    s.whenOnline(thenDo);
  }
}
