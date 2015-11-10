var check = require("check-more-types");
var Module = require("module");
var _ = require("underscore");

var tenantCache = {};
var transforms = {};
var activeTenant = "";

// Require hijacking is based on https://github.com/bahmutov/really-need

// these variables are needed inside eval _compile
/* jshint -W098 */
var runInNewContext = require('vm').runInNewContext;
var runInThisContext = require('vm').runInThisContext;
var path = require('path');

var _require = Module.prototype.require;
var _compile = Module.prototype._compile;

function noop() {}

function logger(options) {
    return check.object(options) &&
    (options.debug || options.verbose) ? console.log : noop;
}

function argsToDeclaration(args) {
    var names = Object.keys(args);
    return names.map(function (name) {
            var val = args[name];
            var value = check.fn(val) ? val.toString() : JSON.stringify(val);
            return 'var ' + name + ' = ' + value + ';';
        }).join('\n') + '\n';
}

function load(transform, module, filename) {
    var fs = require('fs');
    var source = fs.readFileSync(filename, 'utf8');
    var transformed = transform(source, filename);
    if (check.string(transformed)) {
        module._compile(transformed, filename);
    } else {
        console.error('transforming source from', filename, 'has not returned a string');
        module._compile(source, filename);
    }
}

Module.prototype.require = function(name, tenantArg, options) {

    options = options||{};

    var tenantLocal = false;

    if (_.isString(tenantArg)) {
        tenantLocal = true;
        activeTenant = tenantArg;
    }
    else if (tenantArg===true) {
        tenantLocal = true;
    }

    var nameToLoad;
    var result;

    try {
        if (transforms[activeTenant] && name in transforms[activeTenant]) {
            nameToLoad = Module._resolveFilename(transforms[activeTenant][name], this);
        }
        else {
            nameToLoad = Module._resolveFilename(name, this);
        }
    }
    catch (e) {
        throw "Unable to resolve dependency "+name+" in dynamic require.";
    }

    try {
        if (tenantLocal) {
            if (nameToLoad in tenantCache[activeTenant]) {
                result = tenantCache[activeTenant][nameToLoad];
            }
            else {
                result = Module._load(nameToLoad, this);
                tenantCache[activeTenant][nameToLoad] = result;
                delete require.cache[nameToLoad];
            }
        }
        else {
            result = _require.call(this, nameToLoad);
        }
    }
    catch (e) {
        console.log("Unable to load dependency "+name+" in dynamic require, resolved name was "+nameToLoad);
        throw e;
    }

    return result;
};

var resolvedArgv;

// see Module.prototype._compile in
// https://github.com/joyent/node/blob/master/lib/module.js
var _compileStr = _compile.toString();
_compileStr = _compileStr.replace('self.require(path);', 'self.require.apply(self, arguments);');

/* jshint -W061 */
var patchedCompile = eval('(' + _compileStr + ')');

Module.prototype._compile = function (content, filename) {
    var result = patchedCompile.call(this, content, filename);
    return result;
};

var dynamicRequire = Module.prototype.require.bind(module.parent);
dynamicRequire.cache = require.cache;

module.exports = {
    require:dynamicRequire,
    register:function(key, transform) {
        tenantCache[key] = {};
        transforms[key] = transform;
    },
    activate:function(key) {
        activeTenant = key;
    }
}
