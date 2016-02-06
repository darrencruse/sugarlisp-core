var slinfo = require('debug')('sugarlisp:core:utils:info');

if (!String.prototype.repeat) {
    String.prototype.repeat = function(num) {
        num = (num >= 0 ? num : 0);
        return new Array(num + 1).join(this)
    }
}

if (!String.prototype.trim) {
  String.prototype.trim = function () {
    return this.replace(/^\s+|\s+$/g, '');
  };
}

// borrowed from https://github.com/paulmillr/Array.prototype.find
if (!Array.prototype.find) {

  function find(predicate) {
    var list = Object(this);
    var length = list.length < 0 ? 0 : list.length >>> 0; // ES.ToUint32;
    if (length === 0) return undefined;
    if (typeof predicate !== 'function' || Object.prototype.toString.call(predicate) !== '[object Function]') {
      throw new TypeError('Array#find: predicate must be a function');
    }
    var thisArg = arguments[1];
    for (var i = 0, value; i < length; i++) {
      value = list[i];
      if (predicate.call(thisArg, value, i, list)) return value;
    }
    return undefined;
  };

  if (Object.defineProperty) {
    try {
      Object.defineProperty(Array.prototype, 'find', {
        value: find, configurable: true, enumerable: false, writable: true
      });
    } catch(e) {}
  }

  if (!Array.prototype.find) {
    Array.prototype.find = find;
  }
}

if (!Array.prototype.contains) {

  function contains(val) {
    return this.indexOf(val) !== -1;
  };

  if (Object.defineProperty) {
    try {
      Object.defineProperty(Array.prototype, 'contains', {
        value: contains, configurable: true, enumerable: false, writable: true
      });
    } catch(e) {}
  }

  if (!Array.prototype.contains) {
    Array.prototype.contains = contains;
  }
}

if (!Array.prototype.findIndex) {

  function findIndex(predicate) {
    var list = Object(this);
    var length = list.length < 0 ? 0 : list.length >>> 0; // ES.ToUint32;
    if (length === 0) return -1;
    if (typeof predicate !== 'function' || Object.prototype.toString.call(predicate) !== '[object Function]') {
      throw new TypeError('Array#findIndex: predicate must be a function');
    }
    var thisArg = arguments[1];
    for (var i = 0, value; i < length; i++) {
      value = list[i];
      if (predicate.call(thisArg, value, i, list)) return i;
    }
    return -1;
  };

  if (Object.defineProperty) {
    try {
      Object.defineProperty(Array.prototype, 'findIndex', {
        value: findIndex, configurable: true, enumerable: false, writable: true
      });
    } catch(e) {}
  }

  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = findIndex;
  }
}

if (!Array.prototype.contains) {

  function contains(val) {
    return this.indexOf(val) !== -1;
  };

  if (Object.defineProperty) {
    try {
      Object.defineProperty(Array.prototype, 'contains', {
        value: contains, configurable: true, enumerable: false, writable: true
      });
    } catch(e) {}
  }

  if (!Array.prototype.contains) {
    Array.prototype.contains = contains;
  }
}


// THIS MERGE STUFF NEEDS TO BE MERGED - ALL THREE SHOULD BE SHORT AND USE
// A COMMON HELPER

/**
* Takes any number of objects and returns one (new) merged object
* note: later properties with the same name as earlier ones
* do *not* replace them (a warning is logged when such
* conflicts are found).
*/
exports.merge = function(){
  var out = {};
  if(!arguments.length)
    return out;
  for(var i=0; i<arguments.length; i++) {
    for(var key in arguments[i]) {
      if (arguments[i].hasOwnProperty(key)) {
        if(typeof out[key] === 'undefined') {
          out[key] = arguments[i][key];
        }
        else {
          slinfo("Not merging already existing key \"" + key + "\"");
        }
      }
    }
  }
  return out;
}

// merge is also a convenient way to clone an object:
exports.clone = exports.merge;

/**
* Takes any number of objects and merges the properties from later
* ones into the first.
* (otherwise identical to merge above)
*/
exports.mergeInto = function(){
  if(!arguments.length || arguments.length === 0)
    return {};
  var out = arguments[0];
  for(var i=1; i<arguments.length; i++) {
    for(var key in arguments[i]) {
      if (arguments[i].hasOwnProperty(key)) {
        if(typeof out[key] === 'undefined') {
          out[key] = arguments[i][key];
        }
        else {
          slinfo("Not merging already existing key \"" + key + "\"");
        }
      }
    }
  }
  return out;
}

/**
* Set properties in the first argument from the other arguments
* (in the order of the arguments, later properties win)
*/
exports.mergeOnto = function(){
  if(!arguments.length || arguments.length === 0)
    return {};
  var out = arguments[0];
  for(var i=1; i<arguments.length; i++) {
    for(var key in arguments[i]) {
      if (arguments[i].hasOwnProperty(key)) {
        out[key] = arguments[i][key];
      }
    }
  }
  return out;
}

/**
* Fill undefined properties in the first argument from the other arguments
* (in the order of the arguments, earlier properties win)
*/
exports.mergeUndefined = function(){
  if(!arguments.length || arguments.length === 0)
    return {};
  var out = arguments[0];
  for(var i=1; i<arguments.length; i++) {
    for(var key in arguments[i]) {
      if (arguments[i].hasOwnProperty(key) && typeof out[key] === 'undefined') {
        out[key] = arguments[i][key];
      }
    }
  }
  return out;
}

// the below is based on the answer from Bergi here:
// http://stackoverflow.com/questions/9479046/is-there-any-non-eval-way-to-create-a-function-with-a-runtime-determined-name
exports.anonymousFunction = function(args, body, scope, values) {
  // args is optional (shift *our* args if none given)
  if (typeof args == "string")
    values = scope, scope = body, body = args, args = [];
  if (!Array.isArray(scope) || !Array.isArray(values)) {
    if (typeof scope == "object") {
      // place the object keys in scope
      var keys = Object.keys(scope);
      values = keys.map(function(p) { return scope[p]; });
      scope = keys;
    } else {
      values = [];
      scope = [];
    }
  }
  return Function(scope, "return function(" + args.join(", ") + ") {\n" +
                            body +
                          "\n};").apply(null, values);
}

// Get the file extension (without the ".") otherwise defaultExt
exports.getFileExt = function(filename, defaultExt) {
  var fileext;
  if(filename.indexOf(".") !== -1) {
    fileext = filename.split('.').pop();
  }
  else {
    fileext = defaultExt;
  }
  return fileext
}
