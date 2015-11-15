/**
 * SugarLisp Macro Expander
 */

var isArgsExpr = /^#args-if\b|^#args-shift\b|^#args-second\b|^#args-get\b/,
  sl = require('./types'),
  reader = require('./reader'),
  src = require('./source'),
  utils = require('./utils'),
  debug = require('debug')('sugarlisp:core:macro-expander:info'),
  trace = require('debug')('sugarlisp:core:macro-expander:trace');

exports.expand = function(forms, macrodef) {
  var macroname = forms[0].value,
      ctx = this, // the transpiler context
      replacements = {},
      isrestarg = {},
      argtemplate, expansioncode;

  debug('expanding macro:', macroname);
  if(macrodef && Array.isArray(macrodef) && macrodef[0] === "macro") {
    // the lispy (converted to json) macro definition was passed in
    if(!Array.isArray(macrodef[1])) {
      // a named macro:
      trace('was a *named* macro');
      argtemplate = sl.fromJSON(macrodef[2]);
      expansioncode = sl.fromJSON(macrodef[3]);
    }
    else {
      // an anonymous macro
      trace('was an *anonymous* macro');
      argtemplate = sl.fromJSON(macrodef[1]);
      expansioncode = sl.fromJSON(macrodef[2]);
    }
  }
  else {
    forms.error("invalid arguments to macro expander");
  }

  for (var i = 0; i < argtemplate.length; i++) {
    var argname = argtemplate[i].value;
    // support es6 style "...rest" and original lispy style "...rest"
    var restargs = /^\.\.\.(.+)|(.+)\.\.\.$/.exec(argname);
    if(restargs && restargs.length > 2) {
      argname = restargs[1] || restargs[2];
      var argval = forms.slice(i + 1);
      // within the macro simply "~rest" is preferred
      replacements[argname] = argval;
      isrestarg[argname] = true;
// I SHOULD DELETE THE BELOW (IT ACTUALLY LEADS TO TROUBLE IN evalUnquotedExpression)
// BUT I NEED TO SEARCH ALL THE MACROS EVERYWHERE FOR USES OF ~<x>...
      // but for backwards compatibility we still support "~rest..."
// DELETE      replacements[argname + "..."] = argval;
// DELETE      isrestarg[argname + "..."] = true;
    } else {
      if (forms.length === i + 1) {
        // we are here if any macro arg is not set
        forms.error('invalid number of arguments to "' + macroname + '"');
      }

      replacements[argname] = forms[i + 1]
    }
  }

  var replaced = replaceCode(ctx, forms, expansioncode, replacements, isrestarg);
  trace("macro expanded to:", sl.pprintSEXP(replaced));

  // add an indication that we were a macro expansion
  // so the transpiler knows to handle expressions in what we return)
  replaced.__transpiletype = 'macro';
  return replaced;
}

function replaceCode(ctx, forms, expansioncode, replacements, isrestarg) {
  var macroname = sl.valueOf(forms[0]);
  var source = sl.sourceOf(forms);
  var list = sl.list();
  list.setOpening(source);
  // disable the setting of parents since we don't want the *macro*
  // to be treated as the parent:
  list.disable_parenting();

  var expr_name = expansioncode[0] ? expansioncode[0].value : ""
  if (isArgsExpr.test(expr_name)) {
    return replaceArgsExpr(ctx, forms, expansioncode, replacements, isrestarg);
  }

  for (var i = 0; i < expansioncode.length; i++) {
    var codeform = expansioncode[i];
    if(!Array.isArray(codeform)) {
      // this was not a marker - pass it thru
      list.push(codeform);
    }
    else if(sl.valueOf(codeform[0]) === '~') {
      // it's an unquote
      if(codeform.length === 2 && sl.typeOf(codeform[1]) === 'symbol') {
        // it's a simple marker
        var marker = sl.valueOf(codeform[1]);
        if(replacements[marker]) {
          var replaceWith = replacements[marker];
          if(isrestarg[marker] && Array.isArray(replaceWith)) {
            for (var j = 0; j < replaceWith.length; j++) {
              list.push(replaceWith[j]);
            }
          } else {
            list.push(replaceWith);
          }
        }
        else {
          forms.error('~' + marker + ' does not have a replacement value in macro ' +
                      (macroname ? '"' + macroname + '"': ""));
        }
      }
      else {
        // a more complex unquote expression
        replaceWith = evalUnquotedExpression(ctx, codeform[1], replacements, isrestarg);
        list.push(replaceWith);
      }
    }
    else if(sl.valueOf(codeform[0]) === '~@') {
      // it's a splicing unquote
      if(codeform.length === 2 && sl.typeOf(codeform[1]) === 'symbol') {
        // it's a simple marker (presumably holding an array)
        var marker = sl.valueOf(codeform[1]);
        if(replacements[marker]) {
          var replaceWith = replacements[marker];
          if(Array.isArray(replaceWith)) {
            for (var j = 0; j < replaceWith.length; j++) {
              list.push(replaceWith[j]);
            }
          } else {
            list.push(replaceWith);
          }
        }
        else {
          forms.error('~@' + marker + ' does not have a replacement value in macro ' +
                      (macroname ? '"' + macroname + '"': ""));
        }
      }
      else {
        // a more complex unquote expression
        replaceWith = evalUnquotedExpression(ctx, codeform[1], replacements, isrestarg);
        if(Array.isArray(replaceWith)) {
          for (var j = 0; j < replaceWith.length; j++) {
            list.push(replaceWith[j]);
          }
        } else {
          list.push(replaceWith);
        }
      }
    }
    else {
      // it was an array but not an unquote -
      // recursively replace the markers in sub-expressions:
      var replcode = replaceCode(ctx, forms, codeform, replacements, isrestarg);
      if (typeof replcode !== "undefined") {
        list.push(replcode);
      }

    }
/* DELETE
 else {

      // but the form ~(js "javascript code") can evaluate
      // javascript code at macro expansion time
      else if(sl.valueOf(codeform) === '~') {
        var escResult = escapeToJs(ctx, expansioncode[i+1], replacements);
        if(escResult) {
          list.push(escResult);
          i++; // skip past the ~(js...) form
        }
      }
      else {
        // this was not a marker - pass it thru
        list.push(codeform);
      }
    }
  */
  }
  return list;
}

// Handle homoiconic "#args" expressions in macro
function replaceArgsExpr(ctx, forms, expansioncode, replacements, isrestarg) {
  var macroname = forms[0].value;
  var expr_name = expansioncode[0] ? expansioncode[0].value : ""
  var marker = (expr_name !== "#args-get" ? expansioncode[1].value : expansioncode[2].value);
  if(marker.charAt(0) === "~") {
    marker = marker.substring(1);
  }
  var isSplice = false;
  if(marker.charAt(0) === "@") {
    marker = marker.substring(1);
    isSplice = true;
  }
  var replarray = replacements[marker];
  if (expr_name === "#args-shift") {
    if (!Array.isArray(replarray)) {
      expansioncode[1].error('can\'t #args-shift: invalid argument type in "' + macroname + '"');
    }
    var argshift = replarray.shift()
    if (typeof argshift === "undefined") {
      expansioncode[1].error('can\'t #args-shift: invalid number of arguments to "' + macroname + '"');
    }
    return spliceArgsExprResult(isSplice, argshift);
  }
  if (expr_name === "#args-second") {
    if (!Array.isArray(replarray)) {
      expansioncode[1].error('can\'t #args-second: invalid argument type in "' + macroname + '"');
    }
    // note splice here does *remove* the second element from the array (a side effect!)
    var argsecond = replarray.splice(1, 1)[0]
    if (typeof argsecond === "undefined") {
      expansioncode[1].error('no #args-second: invalid number of arguments to "' + macroname + '"');
    }
    return spliceArgsExprResult(isSplice, argsecond);
  }
  if (expr_name === "#args-get") {
    // we have an extra arg compared to the other #args expressions
    var whichArg = expansioncode[1].value;
    if (!Array.isArray(replarray)) {
      expansioncode[2].error('can\'t #args-get: invalid argument type in "' + macroname + '"');
    }
    if (whichArg < 0 || whichArg >= replarray.length) {
      expansioncode[2].error("can\'t #args-get: no argument at position " + whichArg +
                                ' in "' + macroname + '"');
    }
    var argVal = replarray[whichArg];
    if (typeof argVal === "undefined") {
      expansioncode[2].error("no #args-get: undefined argument at position " + whichArg +
                                ' in "' + macroname + '"');
    }
    return spliceArgsExprResult(isSplice, argVal);

  }
  if (expr_name === "#args-if") {
    var argsif;
    if (!Array.isArray(replarray)) {
      expansioncode[1].error('can\'t #args-if: invalid argument type in "' + macroname + '"');
    }
    if (replarray.length) {
      argsif = replaceCode(ctx, forms, expansioncode[2], replacements, isrestarg);
    } else if (expansioncode[3]) {
      argsif = replaceCode(ctx, forms, expansioncode[3], replacements, isrestarg);
    } else {
      return
    }
    return spliceArgsExprResult(isSplice, argsif);
  }
}

function spliceArgsExprResult(isSplice, result) {
  var ret = result;
  if(isSplice && sl.isList(result)) {
    ret = (result.length > 0 ? result[0] : "");
  }
  return ret;
}

/**
* Escape out and run some javascript at macro expansion time
* You embed the javascript in ~(js "<javascript code here>") in the macro body
* note:  this was added prior to the addition of template strings.  That and/or
*   the addition of quasiquote may make this feature unnecessary in the future.
*/
function evalUnquotedExpression(ctx, expr, replacements, isrestarg) {
  var result;

  // transpile the unquoted expression to javascript:
  var jscodestr = ctx.transpileExpression(expr);
  // but returns in the javascript code cause "Unexpected token ILLEGAL"
  jscodestr = jscodestr.toString().replace(/\\n/g, "");
  if(jscodestr.indexOf("return") === -1) {
    jscodestr = "return (" + jscodestr + ");";
  }
  // allow Function to work without error when CSP e.g. in Atom Preview
  // consider merging or replacing the below with one of the ctx.eval* calls
  if(ctx.options.transpile.csp) {
    require('loophole').allowUnsafeNewFunction(function() {
      replacements['ls'] = ls;
      var replacementNames = Object.keys(replacements);
      replacementValues = replacementNames.map(function(p) { return replacements[p]; });
      var f =  utils.anonymousFunction(replacementNames,
                  "'use strict'; " + jscodestr,
                  replacements);
      result = f.apply(ctx, replacementValues);
    });
  }
  else {
    replacements['sl'] = sl;
    var replacementNames = Object.keys(replacements);
    replacementValues = replacementNames.map(function(p) { return replacements[p]; });
    var f =  utils.anonymousFunction(replacementNames,
                "'use strict'; " + jscodestr,
                replacements);
    result = f.apply(ctx, replacementValues);
  }

  return result;
}

/**
* Escape out and run some javascript at macro expansion time
* You embed the javascript in ~(js "<javascript code here>") in the macro body
* note:  this was added prior to the addition of template strings.  That and/or
*   the addition of quasiquote may make this feature unnecessary in the future.
*/
function escapeToJs(ctx, jsescform, replacements) {
  var result;
  // note:  currently ~(js...) is the only thing supported with ~(...)
  if (Array.isArray(jsescform) && jsescform.length > 1 && jsescform[0].value === "js") {
    var jscodestr = sl.valueOfStr(jsescform[1]);
    // returns in the javascript code cause "Unexpected token ILLEGAL"
    jscodestr = jscodestr.replace(/\\n/g, "");

    // allow Function to work without error when CSP e.g. in Atom Preview
    // consider merging or replacing the below with one of the ctx.eval* calls
    if(ctx.options.transpile.csp) {
      require('loophole').allowUnsafeNewFunction(function() {
        var f = new Function("$args", "ls", "'use strict'; " + jscodestr);
        // note the evaluated javascript can see the replacements as normal variables
        result = f.call(replacements, replacements, ls);
      });
    }
    else {
      var f = new Function("$args", "ls", "'use strict'; " + jscodestr);
      // note the evaluated javascript can see the replacements as normal variables
      result = f.call(replacements, replacements, ls);
    }
  }
  return result;
}
