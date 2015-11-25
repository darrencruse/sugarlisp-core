var sl = require('sugarlisp-core/types'),
    reader = require('sugarlisp-core/reader');

/**
* read a list of atoms and/or other lists surrounded by delimiters (), [], etc.
* start is the expected opening delimiter as a string (or an existing start token
* if the opening delimiter has already been read)
* end is the expected end delimiter as a string
* initial is an optional array containing values prepopulated in the list
* separatorRE is an optional RE for "separators" to be skipped e.g. /,/
*/
// WE HAVE MOVED READ_DELIMITED_LIST INTO THE READER
// THIS IS TEMPORARILY STILL HERE...  BUT SHOULD GET REMOVED
exports.read_delimited_list = function(source, start, end, initial, separatorRE) {
    return reader.read_delimited_list(source, start, end, initial, separatorRE);
}

// read square bracketed array of data
// (square brackets are an alternative to quoting)
exports.read_array = function(source) {
  return reader.read_delimited_list(source, '[', ']', ["array"]);
}

/**
* scan some delimited text and get it as a string atom
* source.options.omitDelimiters = whether to include the include the delimiters or not
*/
exports.read_delimited_text = function(source, start, end, options) {
  options = options || {includeDelimiters: true};
  var delimited = source.next_delimited_token(start, end, options);
  return sl.atom(delimited);
}

// read object literal
exports.read_objectliteralOLDDELETE = function(source) {
  var objlist = sl.list("object");
  var token = source.next_token("{");
  objlist.setOpening(token);

  // confirm that we start with a property key i.e. "property:":
  // note: we use next_token here since it doesn't call the reader - performance
  //   would suffer otherwise.  i.e. When there's multiple nested code blocks we
  //   want to *quickly* recognize it's a code block and not an object.
  token = source.next_token(/([a-zA-Z_\$]+[a-zA-Z0-9_\$]*\s*\:|[\'\"\`][a-zA-Z_\$]+[a-zA-Z0-9_\$]*[\'\"\`]\s*\:)/g,
          "ambiguous object literal or code block does not start with a property key");
  token.text = token.text.substring(0, token.text.length-1);
  objlist.push(sl.atom(token.text, {token: token}));

  // read the rest of the property keys/values
  // note:  we cannot assume key/value pairs because infix notation is only
  //   transformed after the reader has finished - consider e.g. key: (x) => {x}
  var propertyValue = sl.list();
  while(!source.eos() && !source.on('}')) {
    var nextForm = reader.read(source);
    // if we just a read a key (or hit the end)
    if(source.on(':') || source.on('}')) {

      // the end is a special case - add the last property value:
      if(source.on('}')) {
        propertyValue.push(nextForm);
      }

      // push on the result the value for the *prior* key:
      if(propertyValue.length === 1) {
        // the property value was a single value
        objlist.push(propertyValue[0]);
      }
      else if(propertyValue.length > 1) {
        // multiple values for the key - pushing it as a list means
        // parenthesizing the expression which is important since infix
        // transforms don't occur till later i.e. key: (x) => {x} becomes
        // key: ((x) => {x}) which ensures the key/val even/odd structure
        objlist.push(propertyValue);
      }
      else {
        source.error("Syntax Error - two property keys in a row?");
      }
      propertyValue = sl.list();

      if(source.on(':')) {
        // Now we can push the key for the next value
        objlist.push(nextForm);
        source.skip_char(':');
      }
    }
    else {
      // not a property key, accumulate this for the next value.
      propertyValue.push(nextForm);
    }
    source.skip_filler();
  }
  if (source.eos()) {
    source.error("Expected '" + '}' + "', got EOF");
  }
  token = source.next_token('}');
  objlist.setClosing(token);

  // having the object properties available as actual javascript
  // properties on the (object..) list is helpful in the macros esp:
  objlist = exports.even_keys_to_list_properties(objlist);
  return objlist;
}

// read object literal
exports.read_objectliteral = function(source, separatorRE) {
  separatorRE = separatorRE || /,+/g;
  var objlist = sl.list("object");
  var token = source.next_token("{");
  objlist.setOpening(token);

  // confirm that we start with a property key i.e. "property:":
  // note: we use next_token here since it doesn't call the reader - performance
  //   would suffer otherwise.  i.e. When there's multiple nested code blocks we
  //   want to *quickly* recognize it's a code block and not an object.
  token = source.next_token(/([a-zA-Z_\$]+[a-zA-Z0-9_\$]*\s*\:|[\'\"\`][^\'\"\`]+[\'\"\`]\s*\:)/g,
          "ambiguous object literal or code block does not start with a property key");
  token.text = token.text.substring(0, token.text.length-1);
  objlist.push(sl.atom(token.text, {token: token}));

  // read the rest of the property keys/values
  while(!source.eos() && !source.on('}')) {
    // read the value for the next property
    var propertyValue = reader.read(source);
    objlist.push(propertyValue);

    // if there's a separator (e.g. commas)
    if(separatorRE && source.on(separatorRE)) {
      source.skip_text(separatorRE); // just skip them
    }

    if(!source.eos() && !source.on('}')) {

      // read the next property key i.e. "property:":
      token = source.next_token(/([a-zA-Z_\$]+[a-zA-Z0-9_\$]*\s*\:|[\'\"\`][^\'\"\`]+[\'\"\`]\s*\:)/g,
              "malformed object literal - was expecting a property key");
      token.text = token.text.substring(0, token.text.length-1);
      objlist.push(sl.atom(token.text, {token: token}));
    }
    source.skip_filler();
  }
  if (source.eos()) {
    source.error("Expected '" + '}' + "', got EOF");
  }
  token = source.next_token('}');
  objlist.setClosing(token);

  // having the object properties available as actual javascript
  // properties on the (object..) list is helpful in the macros esp:
  objlist = exports.even_keys_to_list_properties(objlist);
  return objlist;
}

/*
// read object literal
exports.read_objectliteralWIP = function(source) {
  var list = sl.list("object");
  var token = source.next_token("{");

  // confirm that we start with a property key i.e. "property:":
  // note: we use next_token here since it doesn't call the reader - performance
  //   would suffer otherwise.  i.e. When there's multiple nested code blocks we
  //   want to *quickly* recognize it's a code block and not an object.
  token = source.next_token(/(^[a-zA-Z_\$]+[a-zA-Z0-9_\$]*\:$|^[\'\"\`].*[\'\"\`]\:$)/,
          "ambiguous object literal or code block does not start with a property key");
  list.push(sl.atom(token.text, {token: token});

  // read the rest of the property keys/values
  // note:  we cannot assume key/value pairs because infix notation is only
  //   transformed after the reader has finished - consider e.g. key: (x) => {x}
  while ((token = source.peek_word_token()) && token && token.text !== '}') {
    var nextForm = reader.read(source);
    if(sl.typeOf(nextForm) === 'symbol') {
      var nextText = sl.valueOf(nextForm);
      if(nextText[nextText.length-1] === ':') {
        // we don't include the colon in the atoms
        nextForm.value = nextText.substring(0, nextText.length-1);
      }
    }
    list.push(nextForm);
    source.skip_filler();
  }
  if (!token) {
    reader.error("Expected '" + '}' + "', got EOF", source);
  }
  list.setClosing(token);
  source.next_token('}');

// DARN IT THIS CANT WORK HERE EITHER!!!
// THERE ARE NO "EVEN KEYS" UNTIL THE TRANSFORM HAS BEEN DONE!!
// DO WE/CAN WE DO THE TRANSFORMS HERE TO REARRANGE THE INFIX STUFF?
// IT WOULD DO IT ON THE FORMS THAT ARE *BETWEEN* THE KEYS??!!
// AND IF IT DID I'D ALSO WANT/NEED TO MAKE SURE THE LATER TRANSFORM
// SKIPS OVER THESE SINCE I'VE ALREADY TRANSFORMED THEM.
// OTHERWISE COULD THIS BE DONE *AFTER* THE READER HAS COMPLETED?
// IT WOULD BE A TRANSFORM FUNCTION FOR "object" GIVEN A HIGH
// PRECEDENCE LEVEL NUMBER SO IT RUNS AFTER EVERYTHING ELSE THAT
// DOES THE even_keys_to_list_properties FUNCTION.  I.E. KEYS/VALUES
// SHOULD BE EVEN/ODD AFTER THE INFIX TRANSFORMS ARE COMPLETE.
// THATS THE BEST EASY SOLUTION I HAVE RIGHT NOW - ITS HIGHLIGHTING
// THOUGH THAT THE INFIX HANDLING HAS MADE "READ" NOT FEEL VERY LISPY.
// IN LISP READ IS SUPPOSED TO RETURN THE NEXT FORM - PERIOD!!
//   IS IT POSSIBLE FOR THE READER TO STILL LOOK TO ALWAYS SEE IF IT'S
//   SITTING ON AN INFIX OPERATOR AFTER A READ AND WHENEVER IT IS, IT
//   READS AHEAD AGAIN - BUT DOESN'T LAND ME BACK ON THE "RIGHT ASSOCIATIVITY"?
// ANOTHER OPTION WOULD BE TO JUST MAKE A RULE THAT ANY INFIX KEY
// VALUES HAVE TO BE PARENTHESIZED?  key: ((x) => {x})
// THAT STINKS THOUGH?  COULD I READ THROUGH, FINDING THE KEYS, AND
// MAKING A LIST OF ANYWHERE THERE'S MORE THAN ONE FORM *BETWEEN* THE
// KEYS?  THIS IS IN EFFECT PUTTING THE PARENS IN FOR THEM.  THEN THE
// EVEN/ODD THING STILL WORKS HERE. AND THE FACT THAT THE INFIX TRANSFORM
// DOESNT HAPPEN TILL LATER DOESNT MATTER (BECAUSE THIS LIST I'VE MADE
// WILL REMAIN THE PARENT OF THE REARRANGED EXPRESSION)
  list = exports.even_keys_to_list_properties(list);
  return list;
}
*/
// read object literal
exports.read_objectliteralOldDeleteMe = function(source) {
  var list = sl.list("object");
  var token = source.next_token("{");

  var atLeastOneProperty = false;
  while ((token = source.peek_word_token()) && token && token.text !== '}') {
    // is this a valid property key? (symbol or quoted string)
    // (we don't call the reader here as a performance optimization)
    if(/^[a-zA-Z_\$]+[a-zA-Z0-9_\$]*$/.test(token.text) ||
       /^[\'\"\`].*[\'\"\`]$/.test(token.text)) {
      var key = source.next_word_token();
      list.push(key);
    }
    else if(token.text === "=>") {
      // infix here does require the reader to recover
      // and swap the infix "=>" to prefix...
      var key = reader.read(source);
      list.push(key);
      continue; // this was actually the prior key's value
    } else {
      source.error('Expected an object property but found "' + token.text +
        '" - ambiguous code block or object literal?', token);
    }

    // colons are an individual char separating the pairs:
    // we just skip the colon lispy doesn't use them
    source.next_token(":",
      (atLeastOneProperty ?
        "missing colon in object literal?" :
        "ambiguous code block or object literal?"));
    atLeastOneProperty = true;

    // read the property value:
    list.push(reader.read(source));

    source.skip_filler();
  }
  if (!token) {
    reader.error("Expected '" + '}' + "', got EOF", source);
  }
  list.setClosing(token);
  source.next_token('}');

  list = exports.even_keys_to_list_properties(list);
  return list;
}

// convert the keys of the object list to javascript properties
// the object list is the lispy (object...) list where every
// other property is a key followed by it's value.
// the second argument is optional (the properties will be
// assigned on the list itself if it's omitted)
exports.even_keys_to_list_properties = function(objectlist, object) {
  object = object || objectlist;
  for(var i=1; i < objectlist.length; i += 2) {
    if(typeof objectlist[objectlist[i]] === 'undefined') {
      objectlist[objectlist[i]] = objectlist[i+1];
    }
    else {
      console.log("warning: cannot convert key to already existing property:",
        sl.valueOf(objectlist[i]));
    }
  }
  return objectlist;
}

// read a '{' '}' delimited object literal or code block.
// it's an object literal if it's properly constructed with pairs of property keys and values
// otherwise it's a code block which desugars to a lispy (do...) expression
exports.read_objectliteral_or_codeblock = function(source) {
  var list;
  source.mark_rewind_point();
  try {
    // try and read it as an object literal
    list = exports.read_objectliteral(source);
    source.commit_rewind_point();
  }
  catch(e) {
    if(e.message.indexOf("ambiguous") !== -1) {
      // maybe this is a code block?
      source.rewind();
      list = reader.read_delimited_list(source, '{', '}', ["do"]);
//      list = reader.read_delimited_list(source, '{', '}', ["begin"]);
      if(sl.list(list) && list.length === 1) {
        // this was actually just and empty {}
        list[0].value = "object";
      }
    }
    else {
      throw e;  // it was an object literal with a typo
    }
  }
  return list;
}

/**
* Read a template string enclosed by the start/end delimiters
* start = the open quote character (or undefined to accept " and ')
* end = the closing quote character (or undefined if it should match the open character)
* returned is the LSList form optionally prepended with "initial"
*/
exports.read_template_string = function(source, start, end, initial) {
  var originalLength = initial ? initial.length : 0;
  var strlist = sl.listFromArray(initial || []);
  if(typeof start === 'undefined') {
    var firstCh = source.peek_char();
    if(firstCh === '"' || firstCh === "'") {
      start = firstCh;
    }
    else {
      source.error('Template string without opening \'\"\' or \"\'\"');
    }
  }

  var text = "";
  end = end || start; // sometimes it's the same delimiter on both ends

  // get the prelude before we skip the delimiter
  var prelude = source.get_current_prelude(true);

  // skip the initial delimiter
  source.skip_char(start);

  // mark where the first part of the string (before any "${") starts
  source.mark_token_start();

  // scan looking for the ending
  while(!source.eos() && !source.on(end)) {

    // have we hit the start of an ${} escape?
    if(source.on('${')) {
      // we hit the start of an ${} escape...
      if(text !== "") {
        // add the text preceding the "${"
        text = sl.addQuotes(text, start); // sugarlisp strings include the quotes!
        strlist.push(sl.str(text, {token: source.create_token(text)}));
        text = "";
      }
      source.skip_text("${");
      strlist.push(reader.read(source))
      source.skip_filler();
      source.assert('}',"Missing end for ${");
      source.skip_char("}");
      source.mark_token_start();
    }
    else {
      // it was normal text
      var ch = source.next_char();
      if (ch === "\n") {
        ch = "\\n"; // escape returns
      }
      else if ((ch === "'" || ch === '"') && ch === start) {
        ch = "\\" + ch; // escape quotes that are the same as the delimiter
      }
      else if (ch === "\\") {
         // escape the next character
         text += "\\";
         ch = source.next_char();
      }
      text += ch;
    }
  }

  // we should be at the end of the template string now
  source.assert(end, "Missing end of template string");

  // add any text between last ${} or html tag and the end
  // plus make sure that a simple "" creates an empty string token
  if(text !== "" || (initial && originalLength === strlist.length)) {
    text = sl.addQuotes(text, start); // sugarlisp strings include the quotes!
    strlist.push(sl.str(text, {token: source.create_token(text)}));
  }

  // now we can skip the end delimiter
  source.skip_char(end);
  source.advance_to_next_token();

  // if they're populating e.g. (str...)
  if(originalLength === 1) {
    // did we find anything more?
    if(strlist.length === 1) {
      // nope the template was empty - it's *not* a (str...)
      strlist.shift();
    }
    else if(strlist.length === 2) {
      // there was just a single string so return that not
      // (str "string") which is pointless
      strlist = strlist[1];
    }
  }

  // override the prelude omitting the opening delimiter
  strlist.prelude = prelude;

  return strlist;
}
