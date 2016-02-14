/**
* Basic Lispyscript data types.
*
* The Lispyscript data types ("forms") are lists of "atoms"
* and/or other lists.
*/
var utils = require('./utils'),
    ctx = require('./transpiler-context'),
    debug = require('debug')('sugarlisp:core:types');

//// Atoms

/**
* Atoms
*
* Atom can be symbols, strings, numbers, booleans, null.
*
* Note that undefined is not an atom - it is the absence of an atom.
* Note this follows the same rules as JSON - you cannot use
* undefined in JSON.  To represent the symbol undefined existing
* in input source it can be a *symbol* atom whose value is "undefined".
*
* Likewise comments are not atoms (they are passed through separately
* as "preludes" of the forms that they precede).
*
* The atoms come from either:
*  a.  the tokens parsed from the input source file
*  b.  sugarlisp code (functions and macros) generating
*      the output code.
*
* Both types of atoms have a value, retrievable as ls.valueOf(atom)
*
* But for the atoms created from the tokens of the input we
* preserve the token with line and column numbers in order
* to give good error messages and to enable use of source
* maps.
*
* For other atoms created by sugarlisp code and/or macros we
* support "json style" i.e. you can use simple primitives to
* simplify the code.
*
* Note:  this means a single list may hold both primitives
*   and "wrapped" atoms.  Such "heterogeneity" is expected.
*
* Lastly a special note about symbols.  We have currently
* chosen *not* to use the es6 Symbol type for Symbols
* though that could change in the future.
*
* Symbol atoms are represented with javascript strings, and
* are distinguished from symbols by the presence or absence
* of quotes.
*
* i.e. in an expression like:
*
*  (str "a" "b")
*
* The tokenized text is "str", '"a"', and '"b"' where yes the
* token text for a and b *includes* the quotes.
*
* The value of this scheme shows itself when working with
* primitives or serializing expressions to json, since no
* type information is lost when all you have is the "text".
*
* Note:  more elaborate schemes were tried but the other
*  approaches seemed to add complexity without adding any value.
*/

//// factory method

/**
* Convert a value to an atom
* value is a primitive value.
* options are:
*   token - the parsed token that led to this value (if there was one)
*   parent - the parent form to this one.
*/
function atom(value, options) {

  // is this a list or already wrapped atom?
  if(isList(value) || (!isPrimitive(value) && value.__isatom)) {
    // nothing to be done!
    return value;
  }

  // also they can pass just a token if they want
  // (though it better be a string or symbol - we don't type convert)
  if(!options && value && isToken(value)) {
    options = {token: value};
    value = value.text;
  }

  options = options || {};
  var atomized = {};

  // if they gave the token
  if(options.token) {
    // they can override the token category if they choose:
    options.token.category = options.category || options.token.category;

    // just pull the token info right into us:
    utils.mergeInto(atomized, options.token);

    // An end token... (e.g. the end of a list such as (), [], {})
    if(options.tokenType === "end") {
      // gets it's line/col from the "end" versions:
      atomized.line = options.token.endLine;
      atomized.col = options.token.endCol;
      delete atomized.endLine;
      delete atomized.endCol;
    }
  }

  atomized.value = value;
  atomized.parent = options.parent;
  atomized.toString = function() { return toString(atomized); };
  atomized.toQuotedString = function() { return addQuotes(toString(atomized)); };
  atomized.toUnquotedString = function() { return stripQuotes(toString(atomized)); };
  atomized.toJSON = function() { return toJSON(atomized); };
  atomized.error = function(msg, locator) {
      lexerOf(atomized).error(msg, locator || atomized);
  };
  atomized.transform = options.transform;
  atomized.__isatom = true;
  return atomized;
}

/**
* Alternative to "atom" when needing create a string atom.
* This will ensure your string follows our convention of having
* quotes at the beginning and end of the string (without which
* it will be seen as a symbol not a string)
* Can also be used to "promote" e.g. a symbol atom to a string
* atom.
*/
function str(str, options) {
  var strAtom;
  if(typeof str === 'string') {
    if(!isQuotedString(str)) {
      str = '"' + str + '"';
    }
    strAtom = atom(str, options);
  }
  else if(isAtom(str, true)) {
    // already an atom - but ensure that it's a *string* atom
    strAtom = str;
    if(!isQuotedString(strAtom.value)) {
      strAtom.value = '"' + strAtom.value + '"';
      strAtom.text = strAtom.value;
    }
  }
  else {
    throw Error("Attempt to convert unsupported type " + typeof str + " to a string atom");
  }
  return strAtom;
}

//// Important utility methods
//// With atoms, use these instead of "typeof", ".toString", ".valueOf".
//// This is so we have uniform access whether atoms are primitives or
//// "atomized" (wrapped) using the atoms.atom() function.

/**
* Get the primitive value of an atom
*/
function valueOf(atom) {
  return (typeof atom === 'function' || typeof atom === 'object' ) &&
          atom.__isatom ? atom.value : atom;
}

/**
* Get the primitive value of a string *without the surrounding quotes*.
*/
function valueOfStr(atom) {
  return stripQuotes(valueOf(atom));
}

/**
* Get the atom (whether wrapped or primitive) as a string.
*/
function toString(atom) {
  // note: this is intentionally *not* new String(atom)
  //   see e.g. http://www.2ality.com/2012/03/converting-to-string.html
  return String(valueOf(atom));
}

//// Lists

/**
* Create a sugarlisp list.
* the arguments become the list members.
*
* note:  enhanced array approach based Ben Nadel's excellent blog:
*  http://www.bennadel.com/blog/2292-extending-javascript-arrays-while-keeping-native-bracket-notation-functionality.htm
*/
function list() {
  return listFromArray(Array.prototype.slice.call(arguments));
}

/**
* Create a sugarlisp list from a javascript array.
* Optionally, specify the opening and/or closing tokens for the list.
*/
function listFromArray(arr) {

  // note the below inadvertantly connected the input forms to the
  // output generated code forms and caused a problem if anonymous
  // "reactor functions" were used.  But without it - compile times
  // went thru the roof!!
  if(isList(arr)) { return arr; }

  var thelist = [];

  function _wrap(form) {
    var wrapped;
    if(!Array.isArray(form)) {
      wrapped = atom(form);
    }
    else {
//      wrapped = (isList(form) ? arr : listFromArray(form));
      wrapped = listFromArray(form);
    }
    if(!thelist.noparenting) {
      wrapped.parent = thelist;
    }
    return wrapped;
  }

  /**
  * Add the given form to the end of the list.
  * note: this also wraps the form and sets the list as the parent of the item
  */
  thelist.push = function(form) {
    Array.prototype.push.call(this, _wrap(form));
    return this;
  };

  /**
  * Add each element of the array to the end of the list.
  * note: this also wraps the forms and sets the list as the parent of the item
  */
  thelist.pushFromArray = function(arr) {
    arr.forEach(function(elem) {
      thelist.push(elem);
    });
    return this;
  };

  /**
  * Add the given form to the beginning of the list.
  * note: this also wraps the form and sets the list as the parent of the item
  */
  thelist.unshift = function(form) {
    Array.prototype.unshift.call(this, _wrap(form));
    return this;
  };

  /**
  * Add each element of the array to the beginning of the list.
  * note: this also wraps the forms and sets the list as the parent of the item
  */
  thelist.unshiftArray = function(arr) {
    for(var i = arr.length-1; i >= 0; i--) {
      thelist.unshift(arr[i]);
    };
    return this;
  };

  /**
  * Disable the auto-setting of parents as forms are added to the list.
  * This is useful for macros because even though they rearrange forms
  * we don't want the macros themselves winding up in the parent/child
  * relationships that are used for finding locally scoped dialects.
  */
  thelist.disable_parenting = function() {
    thelist.noparenting = true;
  };

  /**
  * Remove the given item from its parent list.
  */
  thelist.remove = function(form) {
    var parent = parentOf(form);
    if(!parent) {
      parent = thelist;
    }
    else {
      if(parent !== thelist) {
        throw Error("Attempt to remove form from a list that was not it's parent");
      }
    }

    var pos = parent.indexOf(form);
    if(pos !== -1) {
      form.parent = undefined;
      delete parent[pos];
    }
    else {
      throw Error("Attempt to remove form from a list which didn't contain it");
    }

    return this;
  };

  thelist.error = function(msg, locator) {
    lexerOf(thelist).error(msg, locator || thelist);
  };

  /**
  * Get the simplified JSON representation of the atoms in this list.
  */
  thelist.toJSON = function() {
    return toJSON(this);
  };

  /**
  * For "object" or "attr" lists, this returns the js object with properties and
  * values equivalent to the lispy (object..) or (attr..) object.  For all other
  * lists it returns the same as toJSON (above).
  */
  thelist.toObject = function() {
    var obj;
    var jsonsexpr = toJSON(this);
    if(Array.isArray(jsonsexpr) && jsonsexpr.length > 0 &&
      (jsonsexpr[0] === 'object' || jsonsexpr[0] === 'attr'))
    {
      obj = {};
      for (var i = 1; i < jsonsexpr.length; i = i + 2) {
        // toJSON has already made keys into strings and values into primitives
        obj[jsonsexpr[i]] = jsonsexpr[i+1];
      }
    }
    else {
      // it wasn't an object/attr s-expression just give back our list json
      obj = jsonsexpr;
    }

    return obj;
  };

  /**
  * Set parents all the way down this form tree.
  */
  thelist.setParents = function(parent) {

    if(parent) {
      if(this.parent && this.parent !== parent) {
        console.log('warning:  setParents is *changing* an existing parent value??!!');
      }

      this.parent = parent;

    }

    this.forEach(function(form) {
      if(Array.isArray(form) && form.setParents) {
        form.setParents(thelist);
      }
    });
  };

  /**
  * Set the opening line/col for a list from the opening token (e.g. "(")
  * or current position in the Source
  */
  thelist.setOpening = function(tokenOrLexer) {
    this.line = tokenOrLexer.line;
    this.col = tokenOrLexer.col;

    // whitespace or comments that preceded the opening token
    // (e.g. on a () list whitespace or comments that preceded "(")
    this.prelude = tokenOrLexer.prelude;
  }

  /**
  * Set the closing line/col for a list from the closing token (e.g. ")")
  */
  thelist.setClosing = function(tokenOrLexer) {
    this.endLine = tokenOrLexer.line;
    this.endCol = tokenOrLexer.col;

    // whitespace or comments that preceded the end token
    // (e.g. on a () list whitespace or comments that preceded ")")
    this.endPrelude = tokenOrLexer.prelude;
  }

  // did they give an initial arr?
  if(arr && Array.isArray(arr) && arr.length > 0) {
    // wrap the elements and assign parents, etc.
    thelist = fromJSON(arr, thelist);
  }

/*
THIS APPEARS TO BE TRYING TO HELP SET LINE/COL POSITIONS FOR SOURCE
MAPS WHEN A LIST MIGHT HAVE SOME PROGRAM-CREATED TOKENS?  COMMENTED
FOR NOW SINCE WE'RE MOVING FROM THERE EVEN BEING ATOM.LEXER
  var atomwithsource = finddeep(thelist, function(atom) { return atom.lexer; });
  if(atomwithsource) {
    thelist.setOpening(lexerOf(atomwithsource));
  }
*/

  thelist.__islist = true; // is this is a sugarlisp list or just a js array?

  return thelist;
}

/**
* Find the first form in the forms tree where predicate returns true.
* predicatefn is a function of the form:
*  function(form, pos) {
*    return true if found otherwise false
*  }
*
* form is a single form from the forms tree
* pos is the position of that form in it's parent list
*
* note: this is a depth first tree walk - this corresponds to the natural
*   left-to-right/top-to-bottom order of the original source
*/
function finddeep(forms, predicatefn, pos) {
  pos = pos || 0;
  if(Array.isArray(forms)) {
    for (var i = 0, value; i < forms.length; i++) {
      value = finddeep(forms[i], predicatefn, i);
      if(value) {
        return value;
      }
    }
    return undefined;
  }
  else {
    if(predicatefn(forms, pos)) {
      return forms;
    }
  }
  return undefined;
}

//// javascript objects in s-expressions
//// (in addition to lists, allow js objects in s-expressions)
//// this was an experiment initially meant for use representing
//// html attributes as js objects directly in the s-expression
//// representation of html.  as it turns out we are able to 
//// provide properties directly on the (object...) or (attr...)
//// lists, and we also provide a toObject() call for converting
//// such lists to actual js objects - so this is not being used 
//// for html after all.  also note this has not been heavily 
//// tested - it might get deleted if a strong need for it isnt 
//// found (it fights against the elegant uniformity of s-exprs).

/**
* Create a sugarlisp object.
* this really is a normal js object except we've added ways to preserve
* original source line/col info for the sake of source maps.
*
* Otherwise we expect keys added to the object are normal (string) keys,
* but (as created by the reader) values for those keys are "atoms" (again
* this is mainly for the benefit of retaining the line/col "meta data").
*/
function object(baseObj) {
  baseObj = baseObj || {};
  var metaObj = baseObj.__objmeta || {};
  // we define __objmeta' with defineProperty so that for/in does not return it:
  Object.defineProperty(baseObj, '__objmeta', {value: metaObj});

  /**
  * Set the opening line/col for the object from the opening token (e.g. "(")
  * or current position in the Source
  */
  function setOpening(tokenOrLexer) {
    metaObj.line = tokenOrLexer.line;
    metaObj.col = tokenOrLexer.col;

    // whitespace or comments that preceded the opening token
    // (e.g. on a () list whitespace or comments that preceded "(")
    metaObj.prelude = tokenOrLexer.prelude;
  }
  Object.defineProperty(baseObj, 'setOpening', {value: setOpening});

  /**
  * Set the closing line/col for a list from the closing token (e.g. ")")
  */
  function setClosing(tokenOrLexer) {
    metaObj.endLine = tokenOrLexer.line;
    metaObj.endCol = tokenOrLexer.col;

    // whitespace or comments that preceded the end token
    // (e.g. on a () list whitespace or comments that preceded ")")
    metaObj.endPrelude = tokenOrLexer.prelude;
  }
  Object.defineProperty(baseObj, 'setClosing', {value: setClosing});

  return baseObj;
}

//// JSON

/**
* Convert a JSON (value, array, or tree) to a sugarlisp "form"
* (list, atom, etc).
* "into" is optional - it will be populated with the top level forms
* if given.
*/
function fromJSON(json, into) {
  var form;

  // ensure the items are wrapped as atoms (with parents) all the way down
  if(Array.isArray(json)) {
    form = into || list();
    json.forEach(function(elem) {
      form.push(fromJSON(elem));
    });
  }
  else if(isPrimitive(json) || (isToken(json) && !isAtom(json))) {
    form = atom(json);
  }
  else if(isList(json) || isAtom(json)) {
    // nothing to do:
    form = json;
  }
  else {
      throw new Error('Unsupported element type in fromJSON: ' + json +
                  ' (type is \'' + typeof json + '\')');
  }

  return form;
}

/**
* Convert a sugarlisp form to JSON (i.e. js arrays and primitives)
*/
function toJSON(form) {
    if(isList(form)) {
        var json = [];
// DELETE if(!form.formEach) { return json; }
        form.forEach(function(node) {
          var childJSON = toJSON(node);
          // scrub no-op "nop" expressions from the output
          // (nop is mainly just for "prelude" comments to hang on)
          if(!(Array.isArray(childJSON) && childJSON[0] === "nop")) {
            json.push(childJSON);
          }
        })
        return json;
    }
    else if(isAtom(form)) {
       return valueOf(form);
    }
    else {
        throw new Error('Unknown form type in toJSON for node: ' + form);
    }
}

// "pretty print" the simple json of the form tree to a string
function pprintJSON(formJson, opts, indentLevel, priorNodeStr) {
  opts = opts || {};
  opts.spaces = opts.spaces || 2;
  opts.lbracket = opts.lbracket || "[";
  opts.rbracket = opts.rbracket || "]";
  opts.separator = opts.separator || ", ";
  indentLevel = indentLevel || 0;
  var nl = opts.oneLine ? " " : "\n";
  var str = ""

  function indentToSpaces(indentLevel) {
    return(!opts.omitTop ? indentLevel * opts.spaces : (indentLevel - 1) * opts.spaces);
  }

  if(Array.isArray(formJson)) {
    var numSpaces = indentToSpaces(indentLevel);
    if(!(opts.omitTop && indentLevel === 0)) {
      // I added these last two checks below specifically for formatting html tags
      // (the length check might adversely effect formatting normal code not sure yet )
      if((priorNodeStr !== '"function"' && priorNodeStr !== 'function') &&
          formJson.length > 0 && formJson[0] !== "attr") {
        str += (priorNodeStr ? nl : "") // omit the unecessary *first* "\n"
        str += (priorNodeStr && numSpaces > 0 ? " ".repeat(numSpaces) : "")
      }
      str += opts.lbracket
    }

    if(formJson[0] === "object" || formJson[0] === "attr") {
      if(opts.attrsAsJson || opts.objectsAsJson) {
        // pretty print the key/value pairs of an object/attr as a js object:
        str += "{";
        for(var i=1; i<formJson.length;i+=2) {
          if(i === 1) { str += nl; }
          var propNameStr = pprintJSON(formJson[i], opts);
          propNameStr = ((propNameStr.indexOf("-") !== -1) ? '"' + propNameStr + '"' : propNameStr);
          str += (numSpaces+1 > 0 ? " ".repeat(indentToSpaces(indentLevel+1)) : "") +
                  propNameStr + ": " +
                  pprintJSON(formJson[i+1], opts, indentLevel + 2, formJson[i]) + (i+2 < formJson.length ? opts.separator : "") + nl;
        }
        str += "}";
      }
      else {
        // pretty print the key/value pairs of an object/attr as an s-expr list
        str += pprintJSON(formJson[0], opts) + opts.separator + nl;
        for(var i=1; i<formJson.length;i+=2) {
          str += (numSpaces+1 > 0 ? " ".repeat(indentToSpaces(indentLevel+1)) : "") +
                 pprintJSON(formJson[i], opts) + opts.separator +
                 pprintJSON(formJson[i+1], opts, indentLevel + 2, formJson[i]) + (i+2 < formJson.length ? opts.separator : "") + nl;
        }
      }
    }
    else {
      // pretty print the body of a normal list
      var priorNodeStr;
      formJson.forEach(function(node, i) {
        priorNodeStr = pprintJSON(node, opts, indentLevel + 1, priorNodeStr)
        str += priorNodeStr
        if(i < formJson.length - 1) {
          str += opts.separator
        }
      })
    }
    if(!(opts.omitTop && indentLevel === 0)) {
      str += opts.rbracket
    }
  }
  else if(formJson == null) {
    str += "null";
  }
  else if(typeof formJson === 'string' && !opts.bareSymbols) {
    // I had backslashed single quotes below -
    // but jsonlint rejected so I don't...
    str += ('"' + formJson.replace(/[\\"]/g, '\\$&') + '"')
  }
  else if(formJson.toString) {
    str += formJson.toString();
  }
  else {
    throw new Error('Unknown form type in pprintJSON: ' + formJson + ' (' + typeof formJson + ')');
  }
  return str
}

// "pretty print" lisp s-expressions from the form tree to a string
function pprintSEXP(formJson, opts, indentLevel, priorNodeStr) {
  opts = opts || {};
  opts.lbracket = "(";
  opts.rbracket = ")";
  opts.separator = " ";
  opts.bareSymbols = true;
  return pprintJSON(formJson, opts, indentLevel, priorNodeStr);
}

//// Transpiled Output
//// (represented as a tree of code snippet strings intermixed with atoms)

function generated() {
  return generatedFromArray(Array.prototype.slice.call(arguments));
}

function generatedFromArray(arr) {
  var thelist = listFromArray(arr);

  /**
  * Join a generated code list by interposing sepform between each item
  */
  thelist.join = function(sepform) {

    // we replace the list with the joined list (as does push and unshift!)
    var sepatom = atom(sepform);
    var length = thelist.length;
    for(var i = 1; i < (length * 2) - 1; i += 2) {
      thelist.splice(i, 0, sepatom);
    }

    return thelist;
  };

  function _wrap(form) {
    var wrapped;
    if(!Array.isArray(form)) {
      wrapped = atom(form);
    }
    else {
      wrapped = generatedFromArray(form);
    }
    if(!thelist.noparenting) {
      wrapped.parent = thelist;
    }
    wrapped.__isgenerated = true;
    return wrapped;
  }

  /**
  * Add the given form to the end of the generated code list.
  * note: this also wraps the form and sets the list as the parent of the item
  */
  thelist.push = function(form) {
    Array.prototype.push.call(this, _wrap(form));
    return this;
  };

  /**
  * Add the given form to the beginning of the generated code list.
  * note: this also wraps the form and sets the list as the parent of the item
  */
  thelist.unshift = function(form) {
    Array.prototype.unshift.call(this, _wrap(form));
    return this;
  };

  thelist.toString = function() {

    // Helper to flatten an array of arrays (ls.list, ls.generated, normal arrays)
    // down to a single array
    function _flatten(arr) {
      return arr.reduce(function(a, b) {
        b = Array.isArray(b) ? _flatten(b) : toString(b);
        return a.concat(b);
      }, []);
    }

    return _flatten(this).join('');
  };

  thelist.__isgenerated = true;
  return thelist;
}

/**
 * Returns if the specified form is a generated code
 */
function isGenerated(form) {
  return (form && typeof form === 'object' && form.__isgenerated);
}

//// Methods on lispy forms (apply whether arg is atom or list)

/**
 * Returns if the specified form is a list
 */
function isList(form) {
  return (form && typeof form === 'object' && form.__islist);
}

/**
* Returns if the specified value is an atom
* By default a primitive is considered an atom,
* pass true as the second arg to say it must
* be a *wrapped* primitive.
*/
function isAtom(form, wrapped) {
  // it's an atom if we've tagged it one:
  var is = (typeof form === 'object' && form.__isatom);
  // but it's not if it's a list:
  is = is && !isList(form);
  // by default allow primitives as atoms
  if(!wrapped) {
    is = is || isPrimitive(form);
  }

  return is;
}

/**
 * Returns if the specified form is an object
 */
function isObject(form) {
  return (form && typeof form === 'object' && !Array.isArray(form));
}

/**
 * Returns if the specified value is a token
 * note the we "promote" tokens to atoms, so this means
 * most tokens are also atoms.
 */
function isToken(form) {
  return form.__istoken && form.text;
}

/**
 * Returns if the specified value is a form i.e. a list or atom
 */
function isForm(form) {
  return (isAtom(form) || isList(form));
}

/**
* Return the name of the type of form, one of:
*  "list",
*  "symbol",
*  "string",
*  "number",
*  "boolean",
*  "null"
*/
function typeOf(form) {
  var typename;

  if(isList(form)) {
    typename = "list";
  }
  else if(isAtom(form)) {
    var val = valueOf(form);
    // careful with null cause typeof null === "object"
    if(val !== null) {
      var typename = typeof val;
      if(typename === "string" && !isQuotedString(val)) {
        typename = "symbol";
      }
    }
    else typename = "null";
  }
  else if(isObject(form)) {
    typename = "object";
  }
  return typename;
}

/**
* Get the parent of the form (if one is available)
*/
function parentOf(form) {
  return form.parent;
}

/**
* Get the Lexer that was used to read an atom
* Note:  this was originally a very fancy-pants affair,
*   but it's been simplified since we compile one file
*   at a time, and so there's only ever one Lexer at a
*   time.
*/
function lexerOf(form) {
  return ctx.lexer;
}

//// Assorted Utility Methods (lesser used)

/** Is the value a javascript primitive?
 *  (i.e. that we support as an "unwrapped atom"?)
 */
function isPrimitive(val) {
  return (val === null || [
    "undefined",
    "boolean",
    "number",
    "string",
    "symbol"
  ].indexOf(typeof val) !== -1);
}

/** Is the text a quoted string? */
function isQuotedString(str) {
  var is = false;
  if(typeof str === 'string') {
    var firstChar = str.charAt(0);
    is = (['"', "'", '`'].indexOf(firstChar) !== -1);
  }
  return is;
}

/**
* If atom is a string, which quote character does it use?
* Otherwise returns undefined.
* We support the same string quotes as javascript: ", ', and `
*/
function stringQuoteChar(atom) {
  var str = toString(valueOf(atom));
  var quoteChar;
  if(isQuotedString(value)) {
    quoteChar = value.charAt(0);
  }
  return quoteChar;
}

/**
* strip the quotes from around a string if there are any
* otherwise return the string as given.
* since we are removing the quotes we also unescape quotes
* within the string.
*/
function stripQuotes(text) {
  var sansquotes = text;
  if(isQuotedString(text)) {
    if(text.length === 2) {
        sanquotes = ""; // empty string
    }
    else {
      sansquotes = text.substring(1, text.length-1);
// DELETE?      sansquotes = unescapeQuotes(sansquotes);
    }
  }
  return sansquotes;
}

/**
* add quotes around a string if there aren't any
* otherwise return the string as given.
* since we're adding the quotes we also escape quotes
* within the string.
*/
function addQuotes(text, quoteChar) {
  var withquotes = text;
  if(!isQuotedString(text)) {
    var delim = quoteChar && quoteChar.length === 1 ? quoteChar : '"';
    withquotes = delim + text + delim;
  }
  return withquotes;
}

function escapeQuotes(text) {
  return text.replace(/('|"|`)/g, '\\$1');
}

function unescapeQuotes(text) {
  return text.replace(/\\('|"|`)/g, '$1');
}

function escapeNewlines(text) {
  return text.replace(/\n/g, '\\n');
}

module.exports = {
  atom: atom,
  str: str,
  valueOf: valueOf,
  valueOfStr: valueOfStr,
  toString: toString,
  list: list,
  listFromArray: listFromArray,
  object: object,
  finddeep: finddeep,
  fromJSON: fromJSON,
  toJSON: toJSON,
  pprintJSON: pprintJSON,
  pprintSEXP: pprintSEXP,
  generated: generated,
  generatedFromArray: generatedFromArray,
  isGenerated: isGenerated,
  isList: isList,
  isAtom: isAtom,
  isForm: isForm,
  typeOf: typeOf,
  parentOf: parentOf,
  lexerOf: lexerOf,
  isPrimitive: isPrimitive,
  isQuotedString: isQuotedString,
  stringQuoteChar: stringQuoteChar,
  stripQuotes: stripQuotes,
  addQuotes: addQuotes,
  escapeQuotes: escapeQuotes,
  unescapeQuotes: unescapeQuotes,
  escapeNewlines: escapeNewlines
};
