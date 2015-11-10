var check = require("check-more-types");
var Module = require("module");
var _ = require("underscore");

var metacache = {};
var transforms = {};
var active = "";

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

Module.prototype.require = function(name, key, options) {

    options = options||{};

    if (key) {
        active = key;
        if (options.transforms) {
            transforms[key] = options.transforms;
        }
    }

    var nameToLoad;
    var result;

    if (name in transforms[active]) {
        nameToLoad = Module._resolveFilename(transforms[active][name], this);
        if (nameToLoad in metacache[active]) {
            result = metacache[active][nameToLoad];
        }
        else {
            delete require.cache[nameToLoad];
            result = Module._load(nameToLoad, this);
            metacache[active][nameToLoad] = result;
        }
    }
    else {
        try {
            nameToLoad = Module._resolveFilename(name, this);
            result = _require.call(this, nameToLoad);
        }
        catch (e) {
            console.log("Unable to dynamically require "+name);
        }

    }

    if (!result) {
        if (options.default) {
            result = options.default
        }
        else {
            throw "Dependency "+name+" could not be dynamically required.";
        }
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
    register:function(key, transforms) {
        metacache[key] = {};
        transforms[key] = transforms;
    },
    activate:function(key, transforms) {
        active = key;
        if (transforms) {
            module.exports.register(key, transforms);
        }
    }
}
