
// Exercise the SugarLisp Reader
// note: this should be changed to be a proper test with pass/fail asserts

var reader = require('sugarlisp-core/reader');
var sl = require('sugarlisp-core/types');

function testReader(msg, src) {
  console.log('* ' + msg + ' ' + src);
  // the .slisp filename pulls in the sugarlisp core dialect
  var formtree = reader.read_from_source(src, 'testReader.slisp');
  //console.log('lists:', JSON.stringify(formtree.toJSON()));
  console.log('\n' + sl.pprintSEXP(formtree.toJSON(),{omitTop: true, bareSymbols: true}) + '\n');
}

// lispyscript "core" syntax tests

testReader('a symbol:', 'sym');
testReader('a string:', '"str"');
testReader('a number:', '13');
testReader('a number:', '173.97');
testReader('a negative number:', '-13');
testReader('a negative number:', '-173.97');
testReader('nil:', 'nil');
testReader('null:', 'null');
testReader('true:', 'true');
testReader('false:', 'false');
testReader('a list of all atom types:', '(list "string1" \'string2\' 123 123.23 nil null true false)');
testReader('function:', '(var f (function (x y) (+ x y)))');
testReader('function:', '(var f (function (x y) (- x y)))');
testReader('arrow function:', '(x y) => (+ x y)');
testReader('html symbol overlap test:', '(var f (function (x y z) (if (< x y) x (if (<= x z) z))))');
testReader('lisp comment by itself:', '(\n; a comment\n)');
testReader('lisp comment in code:', '(do "hello"\n; a comment\n(+ 2 3))\n; another comment');
testReader('some javascript:', '(javascript "alert(\'hello\');")');
testReader('js comment by itself:', '(\n// a comment\n)');
testReader('js comments:', '(do "hello"\n// a comment\n(+ 2 3))\n// another comment');
testReader('js block comment one line:', '(do "hello"\n/* a comment */\n(+ 2 3))\n/* another comment */');
testReader('js block comment multi line:', '/*\n* multi line\n* comment */\n(do "hello" /* a \ncomment\n*/\n(+ 2 3))');
testReader('an array:', '(var arr [1 2 3])');
testReader('js object literal:', '{ first: "fred", last: "flintstone", age: 54, cartoon: true, toString: (function () (this.first)) }');
testReader('json with quoted keys:', '{ "first": "fred", "last": "flintstone", "age": 54, "cartoon": true }');
testReader('code block:', '{ (console.log "hello") }');

// template strings

testReader('template string one level:',
    "(function (prop val) <<`${prop}: ${val}`>>)");

testReader('template string two levels:',
    "(if (even? rest.length) <<`\n" +
    " {\n" +
    "   ${((.join\n" +
    "     (mapPairs rest\n" +
    "       (function (prop val)\n" +
    "         <<`${prop}: ${val}`>>))\n" +
    "     ',\n'))}\n" +
    " }`>>" +
    " (errors.throw 0 'malformed object literal'))");

testReader('template string with indent marks:',
"  (keyword 'if' (\n" +
"    (condition iftrue) <<`\n" +
"    .  (${condition} ?\n" +
"    .    ${iftrue} : undefined )`>>\n" +
"    (condition iftrue iffalse) <<`\n" +
"    .  (${condition} ?\n" +
"    .    ${iftrue} :\n" +
"    .    ${iffalse})`>>\n" +
"  ))");
