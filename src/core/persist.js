// localStorage with a namespace, for whatever a game wants to remember between
// sessions (grid density, chosen seed, a save slot).
//
// localStorage does work from file://, but EVERY local page on the machine
// shares one bucket: an unnamespaced key collides with any other artifact the
// user opens, so the namespace is mandatory, and so is tolerating a full or
// blocked store (Safari in private mode throws on write) without breaking boot.

function createStore(namespace) {
  var prefix = String(namespace) + ".";

  function keyOf(name) { return prefix + name; }

  return {
    namespace: namespace,
    keyOf: keyOf,
    available: function () {
      try {
        var probe = prefix + "__probe";
        localStorage.setItem(probe, "1");
        localStorage.removeItem(probe);
        return true;
      } catch (error) {
        return false;
      }
    },
    get: function (name, fallback) {
      try {
        var raw = localStorage.getItem(keyOf(name));
        if (raw === null) return fallback;
        var parsed = JSON.parse(raw);
        return parsed === undefined || parsed === null ? fallback : parsed;
      } catch (error) {
        return fallback;
      }
    },
    set: function (name, value) {
      try {
        localStorage.setItem(keyOf(name), JSON.stringify(value));
        return true;
      } catch (error) {
        return false;
      }
    },
    remove: function (name) {
      try { localStorage.removeItem(keyOf(name)); return true; } catch (error) { return false; }
    },
    keys: function () {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf(prefix) === 0) out.push(key.slice(prefix.length));
        }
      } catch (error) { /* blocked store: no keys */ }
      return out;
    }
  };
}
