// which dialects should be automatically "#used"
// in a file with the given extension?
//
// note: the order is the same as #uses in an actual
//  file (i.e. later ones override the earlier ones)
module.exports = {
  // "code" formats
  score: ['core'],
  slisp: ['core', 'plus'],
  sugar: ['core', 'plus', 'sugarscript'],

  // "data" formats
  slson: ['core', 'plus'],
  slml: ['core', 'plus', 'html'],
  slss: ['core', 'plus', 'css']
};
